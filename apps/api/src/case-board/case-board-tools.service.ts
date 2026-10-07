import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  BOARD_MAX_OPS_PER_BATCH,
  type BoardColor,
  type BoardOp,
  type XY,
} from '@workspace/schemas/case-board';
import { PrismaService } from '../prisma.service';
import type {
  CaseBoardResponseDto,
  RejectedBoardOpDto,
} from '../dto/case-board.dto';
import type { TraceKind } from '../graph-trace';
import { CaseBoardReadService } from './case-board-read.service';
import { CaseBoardService } from './case-board.service';
import {
  buildBoardModel,
  FramePlanError,
  planArrivals,
  planFrame,
  planPlacement,
  planTidy,
  type PlannedMove,
} from './board-layout';
import { itemLabels, summarizeBoard } from './board-summary';

type ItemUpdate = Extract<BoardOp, { type: 'item.update' }>;

export interface BoardWriteOutcome {
  /** The board's version after the last batch: pass it as baseVersion next time. */
  version: number;
  applied: number;
  rejected: RejectedBoardOpDto[];
  /** True when someone else wrote to the board between our read and our write. */
  stale: boolean;
}

/** What a tool wrote; nothing but `version` (and a `note`) when it had nothing to do. */
type WriteResult = Partial<Omit<BoardWriteOutcome, 'version'>> & {
  version: number;
  note?: string;
};

export type PlaceResult = WriteResult & {
  placed: Array<{ itemId: string; label?: string; at: XY }>;
};

export type TidyResult = WriteResult & {
  dryRun?: boolean;
  moves: Array<{ itemId: string; label?: string; from: XY | null; to: XY }>;
  findingsReset: Array<{ itemId: string; label?: string; findings: number }>;
};

export type FrameResult = WriteResult & {
  frameId: string;
  frame: {
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
  };
  members: Array<{
    itemId: string;
    label?: string;
    at: XY;
    from: { x: number | null; y: number | null; parentId: string | null };
  }>;
  skipped: Array<{ itemId: string; reason: string; label?: string }>;
};

/**
 * The case board operations agents need beyond single ops (MCP, and through
 * it the in-app assistant): a labelled summary, placing new items, tidying
 * the board up, grouping items into a frame, and tracing connections.
 *
 * Every write here is a plan computed from one board read and then applied
 * as ordinary ops through {@link CaseBoardService.applyOps} — the board's only
 * write path — so the timeline, the version, the socket push and the
 * closed-case guard all behave exactly as for a person's edit.
 */
@Injectable()
export class CaseBoardToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly read: CaseBoardReadService,
    private readonly board: CaseBoardService,
  ) {}

  /** The board (or a snapshot of it) as a labelled summary, or the full payload. */
  async view(
    caseId: string,
    opts: {
      view?: 'summary' | 'full';
      includeGraph?: boolean;
      snapshotId?: string;
    } = {},
  ): Promise<Record<string, unknown>> {
    let payload: CaseBoardResponseDto;
    let snapshot: Record<string, unknown> | undefined;
    if (opts.snapshotId) {
      const found = await this.read.getSnapshot(caseId, opts.snapshotId);
      payload = found.payload;
      snapshot = {
        id: found.id,
        reason: found.reason,
        version: found.version,
        createdBy: found.createdBy,
        createdAt: found.createdAt,
      };
    } else {
      payload = await this.read.getBoard(caseId);
    }
    if (opts.view === 'full') {
      if (opts.includeGraph)
        return { ...(snapshot ? { snapshot } : {}), ...payload };
      const { graph, ...rest } = payload;
      return {
        ...(snapshot ? { snapshot } : {}),
        ...rest,
        graph: {
          omitted: true,
          nodes: graph?.nodes?.length ?? 0,
          edges: graph?.edges?.length ?? 0,
          truncated: graph?.truncated ?? false,
        },
      };
    }
    return {
      ...(snapshot ? { snapshot } : {}),
      ...summarizeBoard(payload),
    };
  }

  /**
   * Give every item without a position one, next to what it connects to —
   * what the board does by itself when someone opens it, done now so the
   * board reads well before anyone does.
   */
  async place(caseId: string, actor?: string): Promise<PlaceResult> {
    const res = await this.editableBoard(caseId);
    const labels = itemLabels(res);
    const positions = planPlacement(buildBoardModel(res));
    const placed = [...positions].map(([itemId, at]) => ({
      itemId,
      label: labels.get(itemId),
      at,
    }));
    if (placed.length === 0) {
      return {
        placed,
        version: res.board.version,
        note: 'Nothing to place: every item on the board already has a position.',
      };
    }
    const ops: BoardOp[] = placed.map((p, i) => ({
      type: 'item.update',
      opId: `place-${i + 1}`,
      id: p.itemId,
      patch: { x: p.at.x, y: p.at.y },
    }));
    const outcome = await this.applyInBatches(
      caseId,
      res.board.version,
      ops,
      actor,
    );
    return { placed, ...outcome };
  }

  /**
   * Land evidence a hypothesis rule just linked: inside the frame its
   * hypothesis sits in, or beside the hypothesis on the open canvas (see
   * planArrivals). Only items with no position yet are touched, and a folded
   * frame stays folded. Written as ordinary ops, so the board's version, its
   * socket push and the closed-case guard behave as for a person's edit.
   *
   * Never throws for "nothing to do": a case that is closed has a read-only
   * board and gets `placed: 0` — its evidence is linked all the same and the
   * board lays it out when it is next opened.
   */
  async placeArrivals(
    caseId: string,
    evidenceIds: readonly string[],
    actor?: string,
  ): Promise<{ placed: number }> {
    if (evidenceIds.length === 0) return { placed: 0 };
    let res: CaseBoardResponseDto;
    try {
      res = await this.editableBoard(caseId);
    } catch (error) {
      if (error instanceof ConflictException) return { placed: 0 };
      throw error;
    }
    const wanted = new Set(evidenceIds);
    const itemIds = new Set(
      res.items
        .filter((i) => i.kind === 'EVIDENCE' && i.refId && wanted.has(i.refId))
        .map((i) => i.id),
    );
    const plan = planArrivals(buildBoardModel(res), itemIds);
    const ops: BoardOp[] = [];
    let n = 0;
    for (const { frameId, plan: framePlan } of plan.frames) {
      if (framePlan.resize) {
        ops.push({
          type: 'item.update',
          opId: `arrival-frame-${++n}`,
          id: frameId,
          patch: {
            width: framePlan.resize.width,
            height: framePlan.resize.height,
          },
        });
      }
      for (const m of framePlan.members) {
        ops.push({
          type: 'item.update',
          opId: `arrival-${++n}`,
          id: m.itemId,
          patch: { parentId: frameId, x: m.to.x, y: m.to.y },
        });
      }
    }
    for (const [itemId, at] of plan.positions) {
      ops.push({
        type: 'item.update',
        opId: `arrival-${++n}`,
        id: itemId,
        patch: { x: at.x, y: at.y },
      });
    }
    if (ops.length === 0) return { placed: 0 };
    await this.applyInBatches(caseId, res.board.version, ops, actor);
    return {
      placed:
        plan.positions.size +
        plan.frames.reduce((sum, f) => sum + f.plan.members.length, 0),
    };
  }

  /**
   * Tidy up: lay the whole board out again (see planTidy). With `dryRun`
   * nothing is written and the planned moves are returned. Every move says
   * where the item was, so a tidy can be walked back with item.update ops.
   */
  async tidy(
    caseId: string,
    opts: { dryRun?: boolean },
    actor?: string,
  ): Promise<TidyResult> {
    const res = opts.dryRun
      ? await this.read.getBoard(caseId)
      : await this.editableBoard(caseId);
    const labels = itemLabels(res);
    const plan = planTidy(buildBoardModel(res));
    const describe = (m: PlannedMove) => ({
      itemId: m.itemId,
      label: labels.get(m.itemId),
      from: m.from,
      to: m.to,
    });
    const summary = {
      moves: plan.moves.map(describe),
      findingsReset: plan.resetFindings.map((r) => ({
        itemId: r.itemId,
        label: labels.get(r.itemId),
        findings: r.findingIds.length,
      })),
    };
    if (opts.dryRun) {
      return { dryRun: true, version: res.board.version, ...summary };
    }
    if (plan.moves.length === 0 && plan.resetFindings.length === 0) {
      return {
        ...summary,
        version: res.board.version,
        note: 'The board is already tidy: nothing moved.',
      };
    }
    const patches = new Map<string, ItemUpdate['patch']>();
    for (const m of plan.moves) patches.set(m.itemId, { x: m.to.x, y: m.to.y });
    for (const r of plan.resetFindings) {
      const findingPositions = Object.fromEntries(
        r.findingIds.map((id) => [id, null]),
      );
      patches.set(r.itemId, {
        ...(patches.get(r.itemId) ?? {}),
        style: { findingPositions },
      });
    }
    const ops: BoardOp[] = [...patches].map(([id, patch], i) => ({
      type: 'item.update',
      opId: `tidy-${i + 1}`,
      id,
      patch,
    }));
    const outcome = await this.applyInBatches(
      caseId,
      res.board.version,
      ops,
      actor,
    );
    return { ...summary, ...outcome };
  }

  /**
   * Put items in a frame: an existing one (`frameId`), or a new one titled
   * `title`. See planFrame for where things land.
   */
  async frame(
    caseId: string,
    input: {
      itemIds: string[];
      frameId?: string;
      title?: string;
      color?: BoardColor;
      arrangement?: 'compact' | 'keep';
    },
    actor?: string,
  ): Promise<FrameResult> {
    if (!input.frameId && !input.title?.trim()) {
      throw new BadRequestException(
        'Name the frame: pass `title` for a new frame, or `frameId` to use one already on the board.',
      );
    }
    const res = await this.editableBoard(caseId);
    const labels = itemLabels(res);
    const model = buildBoardModel(res);
    const frameId = input.frameId ?? randomUUID();
    let plan;
    try {
      plan = planFrame(
        model,
        input.itemIds,
        input.frameId
          ? { kind: 'existing', frameId }
          : {
              kind: 'new',
              frameId,
              title: input.title!.trim(),
              arrangement: input.arrangement ?? 'compact',
            },
      );
    } catch (error) {
      if (error instanceof FramePlanError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const ops: BoardOp[] = [];
    if (!input.frameId) {
      ops.push({
        type: 'item.create',
        opId: 'frame',
        id: frameId,
        kind: 'FRAME',
        x: plan.frame.x,
        y: plan.frame.y,
        width: plan.frame.width,
        height: plan.frame.height,
        content: { title: input.title!.trim() },
        ...(input.color ? { style: { color: input.color } } : {}),
      });
    } else {
      const patch: ItemUpdate['patch'] = {};
      if (plan.resize) {
        patch.width = plan.resize.width;
        patch.height = plan.resize.height;
        if (plan.resize.expand) patch.collapsed = false;
      }
      if (input.title?.trim()) patch.content = { title: input.title.trim() };
      if (input.color) patch.style = { color: input.color };
      if (Object.keys(patch).length > 0) {
        ops.push({ type: 'item.update', opId: 'frame', id: frameId, patch });
      }
    }
    plan.members.forEach((m, i) =>
      ops.push({
        type: 'item.update',
        opId: `member-${i + 1}`,
        id: m.itemId,
        patch: { parentId: frameId, x: m.to.x, y: m.to.y },
      }),
    );
    const members = plan.members.map((m) => ({
      itemId: m.itemId,
      label: labels.get(m.itemId),
      at: m.to,
      from: m.from,
    }));
    const skipped = plan.skipped.map((s) => ({
      ...s,
      label: labels.get(s.itemId),
    }));
    const frame = {
      x: plan.frame.x,
      y: plan.frame.y,
      width: plan.frame.width,
      height: plan.frame.height,
      title: input.title?.trim() || labels.get(frameId),
    };
    if (ops.length === 0) {
      return {
        frameId,
        frame,
        members,
        skipped,
        version: res.board.version,
        note: 'Nothing to change.',
      };
    }
    const outcome = await this.applyInBatches(
      caseId,
      res.board.version,
      ops,
      actor,
    );
    return { frameId, frame, members, skipped, ...outcome };
  }

  /**
   * Show connections: what the case's assets connect to beyond the board,
   * upstream (what feeds them), downstream (what they feed) and alongside
   * (duplicates, look-alikes). Seeds default to every asset in the case; each
   * node says whether it is in the case already, and as which board item.
   */
  async trace(
    caseId: string,
    input: {
      assetIds?: string[];
      direction?: 'up' | 'down' | 'both';
      depth?: number;
      kinds?: TraceKind[];
      limit?: number;
    },
  ) {
    const found = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${caseId} not found`);
    const evidence = await this.prisma.caseEvidence.findMany({
      where: { caseId, entityType: 'asset' },
      select: { id: true, entityId: true },
    });
    const seeds =
      input.assetIds && input.assetIds.length > 0
        ? input.assetIds
        : evidence.map((e) => e.entityId);
    if (seeds.length === 0) {
      throw new BadRequestException(
        'This case holds no assets to trace from. Pass assetIds, or add evidence to the case first.',
      );
    }
    const result = await this.board.trace(caseId, {
      assetIds: seeds.slice(0, 500),
      ...(input.direction ? { direction: input.direction } : {}),
      ...(input.depth ? { depth: input.depth } : {}),
      ...(input.kinds?.length ? { kinds: input.kinds } : {}),
      ...(input.limit ? { limit: input.limit } : {}),
    });
    const items = await this.prisma.caseBoardItem.findMany({
      where: { board: { caseId }, kind: 'EVIDENCE', deletedAt: null },
      select: { id: true, refId: true },
    });
    const itemByEvidence = new Map(items.map((i) => [i.refId, i.id]));
    const itemByAsset = new Map(
      evidence.map((e) => [e.entityId, itemByEvidence.get(e.id) ?? null]),
    );
    const nodes = result.nodes.map((n) => {
      const inCase = n.type === 'asset' && itemByAsset.has(n.id);
      return compact({
        id: n.id,
        type: n.type,
        label: n.label,
        assetType: n.assetType,
        source: n.sourceName ?? n.sourceType,
        status: n.status,
        missing: n.missing || undefined,
        side: n.side,
        depth: n.depth,
        via: n.via,
        viaKind: n.viaKind,
        inCase: inCase || undefined,
        itemId: inCase ? itemByAsset.get(n.id) : undefined,
      });
    });
    return {
      seeds: seeds.length,
      truncated: result.truncated,
      counts: {
        nodes: result.nodes.length,
        edges: result.edges.length,
        notInCase: result.nodes.filter(
          (n) => n.type === 'asset' && !itemByAsset.has(n.id),
        ).length,
      },
      nodes,
      edges: result.edges.map((e) =>
        compact({
          from: e.fromId,
          to: e.toId,
          relationType: e.relationType,
          kind: e.kind,
          confidence: e.confidence,
        }),
      ),
    };
  }

  /** Apply ops in batches the ops endpoint accepts, carrying the version along. */
  async applyInBatches(
    caseId: string,
    baseVersion: number,
    ops: BoardOp[],
    actor?: string,
  ): Promise<BoardWriteOutcome> {
    const outcome: BoardWriteOutcome = {
      version: baseVersion,
      applied: 0,
      rejected: [],
      stale: false,
    };
    for (let i = 0; i < ops.length; i += BOARD_MAX_OPS_PER_BATCH) {
      const result = await this.board.applyOps(
        caseId,
        {
          clientId: `mcp:${randomUUID()}`,
          baseVersion: outcome.version,
          ops: ops.slice(i, i + BOARD_MAX_OPS_PER_BATCH),
        },
        actor,
      );
      outcome.version = result.version;
      outcome.applied += result.applied.length;
      outcome.rejected.push(...result.rejected);
      outcome.stale = outcome.stale || result.stale;
    }
    return outcome;
  }

  /** The board, refusing early (before any planning) when the case is closed. */
  private async editableBoard(caseId: string): Promise<CaseBoardResponseDto> {
    const res = await this.read.getBoard(caseId);
    if (res.board.readOnly) {
      throw new ConflictException(
        `This case is ${res.board.caseStatus.toLowerCase()}, so its board is read-only. Reopen the case (reopen_case) to change it.`,
      );
    }
    return res;
  }
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<T>;
}
