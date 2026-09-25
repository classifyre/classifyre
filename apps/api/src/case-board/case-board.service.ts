import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CaseActivityType,
  CaseBoardItem,
  CaseBoardItemKind,
  CaseBoardLink,
  CaseThreadEntryType,
  CaseThreadKind,
  Prisma,
} from '@prisma/client';
import {
  ApplyBoardOpsSchema,
  BOARD_GEOMETRY_PATCH_KEYS,
  type BoardEndpoint,
  type BoardOp,
  type BoardOpOf,
  type BoardStyle,
} from '@workspace/schemas/case-board';
import { PrismaService } from '../prisma.service';
import { CasesService } from '../cases.service';
import { CaseThreadsService } from '../case-threads.service';
import { GraphService } from '../graph.service';
import { CaseActivityService } from '../case-activity.service';
import { z } from 'zod';
import {
  ApplyBoardOpsResponseDto,
  AppliedBoardOpDto,
  BoardTraceResponseDto,
  RejectedBoardOpDto,
} from '../dto/case-board.dto';
import { TRACE_KINDS, TRACE_MAX_DEPTH } from '../graph-trace';
import { GraphResponseDto } from '../dto/graph.dto';
import { BoardOpRejected } from './board-op-rejected';
import {
  CaseBoardReadService,
  asRecord,
  isReadOnlyCase,
  toBoardItemDto,
  toBoardLinkDto,
  unparentChildren,
} from './case-board-read.service';
import {
  CASE_BOARD_EVENTS,
  type CaseBoardEvents,
  summarizeOps,
} from './case-board.events';

type Db = Prisma.TransactionClient;

const TraceRequestSchema = z.strictObject({
  assetIds: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
  direction: z.enum(['up', 'down', 'both']).optional(),
  depth: z.number().int().min(1).max(TRACE_MAX_DEPTH).optional(),
  kinds: z.array(z.enum(TRACE_KINDS)).min(1).max(4).optional(),
  limit: z.number().int().min(1).max(300).optional(),
});

/** Coalescing window for BOARD_ARRANGED timeline rows (PRD §7.4). */
const ARRANGED_WINDOW_MS = 5 * 60_000;
/** Text kept in timeline payloads; the board row keeps the rest. */
const ACTIVITY_TEXT_MAX = 500;

interface OpContext {
  tx: Db;
  caseId: string;
  boardId: string;
  actor: string | undefined;
  now: Date;
}

interface OpOutcome {
  id?: string;
  updatedAt?: Date;
  note?: string;
  /** Geometry-only change: counted into one coalesced BOARD_ARRANGED row. */
  arranged?: boolean;
}

/** Removed evidence, kept on its board item so undo can restore it exactly. */
interface EvidenceTombstone {
  evidence: {
    id: string;
    caseId: string;
    entityType: string;
    entityId: string;
    label: string | null;
    assetType: string | null;
    sourceType: string | null;
    note: string | null;
    addedBy: string | null;
    createdAt: string;
  };
  findings: CaseFindingTombstone[];
}

interface CaseFindingTombstone {
  id: string;
  caseId: string;
  caseEvidenceId: string;
  findingId: string;
  label: string;
  severity: string | null;
  detectorType: string | null;
  customDetectorName: string | null;
  matchedContent: string | null;
  note: string | null;
  createdAt: string;
  detachedAt?: string;
}

/** Item kinds a board link may attach to. Frames group; comments annotate. */
const LINKABLE_KINDS: ReadonlySet<CaseBoardItemKind> = new Set([
  CaseBoardItemKind.EVIDENCE,
  CaseBoardItemKind.NOTE,
  CaseBoardItemKind.HYPOTHESIS,
]);

/**
 * The case board's single write path (docs/architecture/CASE_BOARD_PRD.md
 * §7.3). A batch of ops is applied in one transaction; each op runs under its
 * own savepoint, so a refused op (BoardOpRejected) rolls back alone while the
 * rest of the batch lands. Anything unexpected rolls back the whole batch.
 *
 * Every op is idempotent. The client retries a batch whose response it never
 * saw, and undo/redo replays the same ops, so applying an op twice must leave
 * the board exactly as applying it once: creating ops key on the client's id
 * and bring a soft-deleted row back instead of adding a second one.
 *
 * Domain ops (evidence, findings, hypotheses, stances, comments) delegate to
 * the case services inside the same transaction, so those keep writing their
 * own timeline rows; board-native ops write the BOARD_* rows here.
 */
@Injectable()
export class CaseBoardService {
  private readonly logger = new Logger(CaseBoardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly read: CaseBoardReadService,
    private readonly cases: CasesService,
    private readonly threads: CaseThreadsService,
    private readonly graph: GraphService,
    private readonly activity: CaseActivityService,
    @Optional()
    @Inject(CASE_BOARD_EVENTS)
    private readonly events?: CaseBoardEvents,
  ) {}

  async applyOps(
    caseId: string,
    body: unknown,
    actor?: string,
  ): Promise<ApplyBoardOpsResponseDto> {
    const parsed = ApplyBoardOpsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid board ops',
        issues: parsed.error.issues.slice(0, 20).map((i) => ({
          path: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      });
    }
    const input = parsed.data;

    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { status: true },
    });
    if (!caseRow)
      throw new NotFoundException(`Case with ID ${caseId} not found`);
    if (isReadOnlyCase(caseRow.status)) {
      throw new ConflictException(
        `This case is ${caseRow.status.toLowerCase()}. Reopen it to change its board.`,
      );
    }
    const { boardId } = await this.read.reconcile(caseId);

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Serialises concurrent batches on one board, so `version` counts
        // batches exactly and `stale` is decided against a stable value.
        const [locked] = await tx.$queryRaw<{ version: number }[]>`
          SELECT version FROM case_boards WHERE id = ${boardId} FOR UPDATE`;
        const ctx: OpContext = { tx, caseId, boardId, actor, now: new Date() };
        const applied: AppliedBoardOpDto[] = [];
        const rejected: RejectedBoardOpDto[] = [];
        let arranged = 0;

        for (const op of input.ops) {
          await tx.$executeRawUnsafe('SAVEPOINT board_op');
          try {
            const outcome = await this.applyOne(ctx, op);
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT board_op');
            if (outcome.arranged) arranged += 1;
            applied.push({
              opId: op.opId,
              ...(outcome.id ? { id: outcome.id } : {}),
              ...(outcome.updatedAt ? { updatedAt: outcome.updatedAt } : {}),
              ...(outcome.note ? { note: outcome.note } : {}),
            });
          } catch (error) {
            const rejection = asRejection(error);
            if (!rejection) throw error;
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT board_op');
            rejected.push({ opId: op.opId, ...rejection });
          }
        }

        let version = locked?.version ?? 0;
        if (applied.length > 0) {
          await this.recordArranged(ctx, arranged);
          const bumped = await tx.caseBoard.update({
            where: { id: boardId },
            data: { version: { increment: 1 } },
            select: { version: true },
          });
          version = bumped.version;
        }
        return {
          version,
          applied,
          rejected,
          stale: (locked?.version ?? 0) > input.baseVersion,
        };
      },
      // Batches are capped at 200 ops; the domain ops go through indexed
      // paths. Past this, P2028 is a signal to split, not to wait longer.
      { timeout: 15_000, maxWait: 5_000 },
    );

    if (result.applied.length > 0) {
      const appliedIds = new Set(result.applied.map((a) => a.opId));
      this.events?.emitChanged(caseId, {
        caseId,
        version: result.version,
        actor: actor ?? null,
        clientId: input.clientId,
        summary: summarizeOps(input.ops.filter((o) => appliedIds.has(o.opId))),
      });
    }
    return result;
  }

  /**
   * The connections of assets (Show connections, multi-hop neighbours):
   * upstream, downstream and sideways through lineage, links, duplicates and
   * similarity, as far as asked. See GraphService.trace for the bounds.
   */
  async trace(caseId: string, body: unknown): Promise<BoardTraceResponseDto> {
    const parsed = TraceRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid trace request',
        issues: parsed.error.issues.slice(0, 10).map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    const exists = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Case with ID ${caseId} not found`);
    const input = parsed.data;
    const result = await this.graph.trace({
      seeds: [...new Set(input.assetIds)].map((id) => ({ type: 'asset', id })),
      depth: input.depth ?? 2,
      direction: input.direction ?? 'both',
      kinds: input.kinds ?? [...TRACE_KINDS],
      limit: input.limit ?? 150,
    });
    return result as BoardTraceResponseDto;
  }

  /** Suggested ghosts: the live neighbourhood of one evidence bubble. */
  async neighbours(caseId: string, itemId: unknown): Promise<GraphResponseDto> {
    if (typeof itemId !== 'string' || itemId.length === 0) {
      throw new BadRequestException('itemId is required');
    }
    const item = await this.prisma.caseBoardItem.findFirst({
      where: { id: itemId, deletedAt: null, board: { caseId } },
    });
    if (!item || item.kind !== CaseBoardItemKind.EVIDENCE || !item.refId) {
      throw new NotFoundException(
        `Evidence item ${itemId} is not on this board`,
      );
    }
    const evidence = await this.prisma.caseEvidence.findUnique({
      where: { id: item.refId },
      select: { entityType: true, entityId: true },
    });
    if (!evidence) {
      throw new NotFoundException(
        `Evidence item ${itemId} is not on this board`,
      );
    }
    return this.graph.expand({
      entityType: evidence.entityType,
      entityId: evidence.entityId,
      depth: 1,
      direction: 'both',
    });
  }

  // ─── Dispatch ─────────────────────────────────────────────────────────────

  private applyOne(ctx: OpContext, op: BoardOp): Promise<OpOutcome> {
    switch (op.type) {
      case 'item.create':
        return this.itemCreate(ctx, op);
      case 'item.update':
        return this.itemUpdate(ctx, op);
      case 'item.delete':
        return this.itemDelete(ctx, op);
      case 'item.restore':
        return this.itemRestore(ctx, op);
      case 'link.create':
        return this.linkCreate(ctx, op);
      case 'link.update':
        return this.linkUpdate(ctx, op);
      case 'link.delete':
        return this.linkDelete(ctx, op);
      case 'link.restore':
        return this.linkRestore(ctx, op);
      case 'link.promote':
        return this.linkPromote(ctx, op);
      case 'evidence.add':
        return this.evidenceAdd(ctx, op);
      case 'evidence.remove':
        return this.evidenceRemove(ctx, op);
      case 'finding.attach':
        return this.findingAttach(ctx, op);
      case 'finding.detach':
        return this.findingDetach(ctx, op);
      case 'hypothesis.create':
        return this.hypothesisCreate(ctx, op);
      case 'stance.set':
        return this.stanceSet(ctx, op);
      case 'stance.remove':
        return this.stanceRemove(ctx, op);
      case 'comment.create':
        return this.commentCreate(ctx, op);
      case 'comment.resolve':
        return this.commentResolve(ctx, op);
      case 'thread.place':
        return this.threadPlace(ctx, op);
    }
  }

  // ─── Board-native items ───────────────────────────────────────────────────

  private async itemCreate(
    ctx: OpContext,
    op: BoardOpOf<'item.create'>,
  ): Promise<OpOutcome> {
    const existing = await this.findItem(ctx, op.id);
    if (existing) {
      if (existing.kind !== op.kind) {
        throw new BoardOpRejected(
          `Item ${op.id} already exists as ${existing.kind}`,
        );
      }
      if (!existing.deletedAt)
        return { id: existing.id, updatedAt: existing.updatedAt };
      // Redo of a create that was undone: the same row comes back.
      const revived = await this.reviveItem(ctx, existing);
      await this.recordNative(ctx, op.kind, 'ADDED', revived, {
        restored: true,
      });
      return { id: revived.id, updatedAt: revived.updatedAt };
    }
    if (op.parentId) await this.assertParent(ctx, op.id, op.kind, op.parentId);
    const created = await ctx.tx.caseBoardItem.create({
      data: {
        id: op.id,
        boardId: ctx.boardId,
        kind: op.kind,
        x: op.x,
        y: op.y,
        width: op.width ?? null,
        height: op.height ?? null,
        z: op.z ?? 0,
        parentId: op.parentId ?? null,
        style: toJson(mergeStyle(null, op.style)),
        content: toJson(cleanContent(op.kind, op.content)),
        createdBy: ctx.actor ?? null,
        updatedBy: ctx.actor ?? null,
      },
    });
    await this.recordNative(ctx, op.kind, 'ADDED', created);
    return { id: created.id, updatedAt: created.updatedAt };
  }

  private async itemUpdate(
    ctx: OpContext,
    op: BoardOpOf<'item.update'>,
  ): Promise<OpOutcome> {
    const item = await this.liveItem(ctx, op.id);
    if (
      op.expectedUpdatedAt &&
      item.updatedAt.getTime() !== new Date(op.expectedUpdatedAt).getTime()
    ) {
      throw new BoardOpRejected(
        `Changed by ${item.updatedBy ?? 'someone else'} meanwhile`,
        'STALE',
        { item: toBoardItemDto(item) },
      );
    }
    const patch = op.patch;
    const data: Prisma.CaseBoardItemUncheckedUpdateInput = {};
    let geometryOnly = true;

    if (patch.x !== undefined) data.x = patch.x;
    if (patch.y !== undefined) data.y = patch.y;
    if (patch.width !== undefined) data.width = patch.width;
    if (patch.height !== undefined) data.height = patch.height;
    if (patch.z !== undefined) data.z = patch.z;
    if (patch.collapsed !== undefined) data.collapsed = patch.collapsed;
    if (patch.parentId !== undefined) {
      if (patch.parentId !== null) {
        await this.assertParent(ctx, item.id, item.kind, patch.parentId);
      }
      data.parentId = patch.parentId;
    }
    let contentChange: { before: string; after: string } | null = null;
    if (patch.content !== undefined) {
      if (item.kind !== 'NOTE' && item.kind !== 'FRAME') {
        throw new BoardOpRejected(
          'Only notes and frames have editable text on the board',
          'READ_ONLY_KIND',
        );
      }
      const before = asRecord(item.content) ?? {};
      const next = { ...before, ...cleanContent(item.kind, patch.content) };
      const field = item.kind === 'NOTE' ? 'text' : 'title';
      contentChange = {
        before: textOf(before[field]),
        after: textOf(next[field]),
      };
      data.content = toJson(next);
      geometryOnly = false;
    }
    let highlight: Record<string, unknown> | null = null;
    if (patch.style !== undefined) {
      data.style = toJson(mergeStyle(asRecord(item.style), patch.style));
      if (patch.style.highlight !== undefined || patch.style.rowHighlights) {
        highlight = {
          color: patch.style.highlight ?? null,
          ...(patch.style.rowHighlights
            ? { rows: patch.style.rowHighlights }
            : {}),
        };
      }
      geometryOnly = false;
    }
    if (Object.keys(data).length === 0) {
      return { id: item.id, updatedAt: item.updatedAt };
    }
    data.updatedBy = ctx.actor ?? null;
    const updated = await ctx.tx.caseBoardItem.update({
      where: { id: item.id },
      data,
    });

    if (contentChange && contentChange.before !== contentChange.after) {
      await this.record(
        ctx,
        item.kind === 'NOTE'
          ? CaseActivityType.BOARD_NOTE_UPDATED
          : CaseActivityType.BOARD_FRAME_UPDATED,
        {
          itemId: item.id,
          before: truncate(contentChange.before),
          after: truncate(contentChange.after),
        },
      );
    }
    if (highlight) {
      await this.record(ctx, CaseActivityType.BOARD_ITEM_HIGHLIGHTED, {
        itemId: item.id,
        kind: item.kind,
        ...highlight,
      });
    }
    const touchedGeometry = BOARD_GEOMETRY_PATCH_KEYS.some(
      (k) => patch[k] !== undefined,
    );
    // First placement of an item the server created unplaced is the client
    // laying the board out, not a person rearranging it: no timeline row.
    const firstPlacement = item.x === null || item.y === null;
    return {
      id: updated.id,
      updatedAt: updated.updatedAt,
      arranged: geometryOnly && touchedGeometry && !firstPlacement,
    };
  }

  private async itemDelete(
    ctx: OpContext,
    op: BoardOpOf<'item.delete'>,
  ): Promise<OpOutcome> {
    const item = await this.findItem(ctx, op.id);
    if (!item)
      throw new BoardOpRejected(
        `Item ${op.id} is not on this board`,
        'NOT_FOUND',
      );
    if (item.kind === CaseBoardItemKind.EVIDENCE) {
      throw new BoardOpRejected(
        'Evidence leaves the board only by being removed from the case (evidence.remove).',
        'READ_ONLY_KIND',
      );
    }
    if (item.deletedAt) return { id: item.id };
    await this.softDeleteItem(ctx, item);
    if (item.kind === 'NOTE' || item.kind === 'FRAME') {
      await this.recordNative(ctx, item.kind, 'REMOVED', item);
      return { id: item.id };
    }
    // A hypothesis card or comment pin leaves the board; its thread stays.
    return { id: item.id, arranged: true };
  }

  private async itemRestore(
    ctx: OpContext,
    op: BoardOpOf<'item.restore'>,
  ): Promise<OpOutcome> {
    const item = await this.findItem(ctx, op.id);
    if (!item)
      throw new BoardOpRejected(
        `Item ${op.id} is not on this board`,
        'NOT_FOUND',
      );
    if (!item.deletedAt) return { id: item.id, updatedAt: item.updatedAt };
    if (item.kind === CaseBoardItemKind.EVIDENCE) {
      return this.restoreEvidence(ctx, item);
    }
    if (item.refId && (item.kind === 'HYPOTHESIS' || item.kind === 'COMMENT')) {
      const thread = await ctx.tx.caseThread.findFirst({
        where: { id: item.refId, caseId: ctx.caseId },
        select: { id: true },
      });
      if (!thread) {
        throw new BoardOpRejected('Its thread was deleted', 'NOT_FOUND');
      }
    }
    const revived = await this.reviveItem(ctx, item);
    if (item.kind === 'NOTE' || item.kind === 'FRAME') {
      await this.recordNative(ctx, item.kind, 'ADDED', revived, {
        restored: true,
      });
      return { id: revived.id, updatedAt: revived.updatedAt };
    }
    return { id: revived.id, updatedAt: revived.updatedAt, arranged: true };
  }

  // ─── Links ────────────────────────────────────────────────────────────────

  private async linkCreate(
    ctx: OpContext,
    op: BoardOpOf<'link.create'>,
  ): Promise<OpOutcome> {
    const existing = await ctx.tx.caseBoardLink.findUnique({
      where: { id: op.id },
    });
    if (existing) {
      if (existing.boardId !== ctx.boardId) {
        throw new BoardOpRejected(`Link ${op.id} belongs to another board`);
      }
      if (!existing.deletedAt)
        return { id: existing.id, updatedAt: existing.updatedAt };
      return this.reviveLink(ctx, existing);
    }
    await this.assertLinkEndpoint(ctx, op.source);
    await this.assertLinkEndpoint(ctx, op.target);
    if (
      op.source.itemId === op.target.itemId &&
      (op.source.findingId ?? null) === (op.target.findingId ?? null)
    ) {
      throw new BoardOpRejected('A link needs two different ends');
    }
    const link = await ctx.tx.caseBoardLink.create({
      data: {
        id: op.id,
        boardId: ctx.boardId,
        sourceItemId: op.source.itemId,
        sourceFindingId: op.source.findingId ?? null,
        targetItemId: op.target.itemId,
        targetFindingId: op.target.findingId ?? null,
        kind: op.kind,
        label: op.label ?? null,
        certainty: op.certainty ?? 'CONFIRMED',
        confidence: op.confidence ?? null,
        note: op.note ?? null,
        createdBy: ctx.actor ?? null,
        updatedBy: ctx.actor ?? null,
      },
    });
    await this.record(ctx, CaseActivityType.BOARD_LINK_ADDED, {
      linkId: link.id,
      kind: link.kind,
      label: link.label,
      certainty: link.certainty,
      source: op.source,
      target: op.target,
      itemId: link.sourceItemId,
    });
    return { id: link.id, updatedAt: link.updatedAt };
  }

  private async linkUpdate(
    ctx: OpContext,
    op: BoardOpOf<'link.update'>,
  ): Promise<OpOutcome> {
    const link = await this.liveLink(ctx, op.id);
    if (
      op.expectedUpdatedAt &&
      link.updatedAt.getTime() !== new Date(op.expectedUpdatedAt).getTime()
    ) {
      throw new BoardOpRejected(
        `Changed by ${link.updatedBy ?? 'someone else'} meanwhile`,
        'STALE',
        { link: toBoardLinkDto(link) },
      );
    }
    const data: Prisma.CaseBoardLinkUncheckedUpdateInput = {};
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    const p = op.patch;
    const set = <K extends 'kind' | 'label' | 'certainty' | 'note'>(key: K) => {
      if (p[key] === undefined || p[key] === link[key]) return;
      changes[key] = {
        before:
          typeof link[key] === 'string'
            ? truncate(String(link[key]))
            : link[key],
        after: typeof p[key] === 'string' ? truncate(String(p[key])) : p[key],
      };
      data[key] = p[key] as never;
    };
    set('kind');
    set('label');
    set('certainty');
    set('note');
    if (p.confidence !== undefined) {
      const before = link.confidence === null ? null : Number(link.confidence);
      if (before !== p.confidence) {
        changes.confidence = { before, after: p.confidence };
        data.confidence = p.confidence;
      }
    }
    if (Object.keys(data).length === 0)
      return { id: link.id, updatedAt: link.updatedAt };
    data.updatedBy = ctx.actor ?? null;
    const updated = await ctx.tx.caseBoardLink.update({
      where: { id: link.id },
      data,
    });
    await this.record(ctx, CaseActivityType.BOARD_LINK_UPDATED, {
      linkId: link.id,
      itemId: link.sourceItemId,
      changes,
    });
    return { id: updated.id, updatedAt: updated.updatedAt };
  }

  private async linkDelete(
    ctx: OpContext,
    op: BoardOpOf<'link.delete'>,
  ): Promise<OpOutcome> {
    const link = await ctx.tx.caseBoardLink.findUnique({
      where: { id: op.id },
    });
    if (!link || link.boardId !== ctx.boardId) {
      throw new BoardOpRejected(
        `Link ${op.id} is not on this board`,
        'NOT_FOUND',
      );
    }
    if (link.deletedAt) return { id: link.id };
    await ctx.tx.caseBoardLink.update({
      where: { id: link.id },
      data: { deletedAt: ctx.now, updatedBy: ctx.actor ?? null },
    });
    await this.record(ctx, CaseActivityType.BOARD_LINK_REMOVED, {
      linkId: link.id,
      kind: link.kind,
      label: link.label,
      itemId: link.sourceItemId,
    });
    return { id: link.id };
  }

  private async linkRestore(
    ctx: OpContext,
    op: BoardOpOf<'link.restore'>,
  ): Promise<OpOutcome> {
    const link = await ctx.tx.caseBoardLink.findUnique({
      where: { id: op.id },
    });
    if (!link || link.boardId !== ctx.boardId) {
      throw new BoardOpRejected(
        `Link ${op.id} is not on this board`,
        'NOT_FOUND',
      );
    }
    if (!link.deletedAt) return { id: link.id, updatedAt: link.updatedAt };
    return this.reviveLink(ctx, link);
  }

  /**
   * Copy a board link into the global graph. Idempotent: a link already
   * promoted is left alone. An edge the platform produced between the same
   * ends is reused as is — promotion never rewrites a system edge's origin.
   */
  private async linkPromote(
    ctx: OpContext,
    op: BoardOpOf<'link.promote'>,
  ): Promise<OpOutcome> {
    const link = await this.liveLink(ctx, op.id);
    if (link.promotedEdgeId) {
      const edge = await ctx.tx.edge.findUnique({
        where: { id: link.promotedEdgeId },
        select: { id: true },
      });
      if (edge)
        return {
          id: link.id,
          updatedAt: link.updatedAt,
          note: 'Already global',
        };
    }
    const from = await this.entityOf(
      ctx,
      link.sourceItemId,
      link.sourceFindingId,
    );
    const to = await this.entityOf(
      ctx,
      link.targetItemId,
      link.targetFindingId,
    );
    const relationType = toRelationType(link.kind);
    const existing = await ctx.tx.edge.findUnique({
      where: {
        fromType_fromId_toType_toId_relationType: {
          fromType: from.type,
          fromId: from.id,
          toType: to.type,
          toId: to.id,
          relationType,
        },
      },
      select: { id: true },
    });
    const edgeId =
      existing?.id ??
      (
        await this.graph.createManualEdge(
          {
            fromType: from.type,
            fromId: from.id,
            toType: to.type,
            toId: to.id,
            relationType,
            confidence: link.confidence === null ? 1 : Number(link.confidence),
          },
          ctx.tx,
        )
      ).id;
    const updated = await ctx.tx.caseBoardLink.update({
      where: { id: link.id },
      data: { promotedEdgeId: edgeId, updatedBy: ctx.actor ?? null },
    });
    await this.record(ctx, CaseActivityType.BOARD_LINK_PROMOTED, {
      linkId: link.id,
      edgeId,
      relationType,
      itemId: link.sourceItemId,
    });
    return { id: updated.id, updatedAt: updated.updatedAt };
  }

  // ─── Evidence & findings ──────────────────────────────────────────────────

  private async evidenceAdd(
    ctx: OpContext,
    op: BoardOpOf<'evidence.add'>,
  ): Promise<OpOutcome> {
    const existingItem = await this.findItem(ctx, op.itemId);
    if (existingItem) {
      if (existingItem.kind !== CaseBoardItemKind.EVIDENCE) {
        throw new BoardOpRejected(`Item ${op.itemId} is not evidence`);
      }
      if (existingItem.deletedAt) {
        return this.restoreEvidence(ctx, existingItem, op);
      }
      return { id: existingItem.id, updatedAt: existingItem.updatedAt };
    }

    let assetId: string;
    let findingId: string | undefined;
    if (op.entityType === 'asset') {
      const asset = await ctx.tx.asset.findUnique({
        where: { id: op.entityId },
        select: { id: true },
      });
      if (!asset) throw new BoardOpRejected('Asset not found', 'NOT_FOUND');
      assetId = asset.id;
    } else {
      const finding = await ctx.tx.finding.findUnique({
        where: { id: op.entityId },
        select: { id: true, assetId: true },
      });
      if (!finding) throw new BoardOpRejected('Finding not found', 'NOT_FOUND');
      assetId = finding.assetId;
      findingId = finding.id;
    }

    const evidenceKey = {
      caseId_entityType_entityId: {
        caseId: ctx.caseId,
        entityType: 'asset',
        entityId: assetId,
      },
    };
    const existingEvidence = await ctx.tx.caseEvidence.findUnique({
      where: evidenceKey,
      select: { id: true },
    });
    if (existingEvidence) {
      const bubble = await ctx.tx.caseBoardItem.findFirst({
        where: {
          boardId: ctx.boardId,
          kind: CaseBoardItemKind.EVIDENCE,
          refId: existingEvidence.id,
          deletedAt: null,
        },
      });
      if (findingId) {
        const attached = await ctx.tx.caseFinding.findUnique({
          where: { caseId_findingId: { caseId: ctx.caseId, findingId } },
          select: { id: true },
        });
        if (!attached) {
          await this.cases.attachFindings(
            ctx.caseId,
            { findingIds: [findingId], addedBy: ctx.actor },
            ctx.tx,
          );
          return {
            id: bubble?.id,
            note: 'Attached to evidence already on the board',
          };
        }
      }
      throw new BoardOpRejected('Already on the board', 'ALREADY_ON_BOARD', {
        itemId: bubble?.id ?? null,
      });
    }

    if (findingId) {
      await this.cases.attachFindings(
        ctx.caseId,
        { findingIds: [findingId], addedBy: ctx.actor },
        ctx.tx,
      );
    } else {
      await this.cases.addEvidence(
        ctx.caseId,
        { entityType: 'asset', entityId: assetId, addedBy: ctx.actor },
        ctx.tx,
      );
    }
    const evidence = await ctx.tx.caseEvidence.findUniqueOrThrow({
      where: evidenceKey,
      select: { id: true },
    });
    const item = await ctx.tx.caseBoardItem.create({
      data: {
        id: op.itemId,
        boardId: ctx.boardId,
        kind: CaseBoardItemKind.EVIDENCE,
        refId: evidence.id,
        x: op.x ?? null,
        y: op.y ?? null,
        createdBy: ctx.actor ?? null,
        updatedBy: ctx.actor ?? null,
      },
    });
    return { id: item.id, updatedAt: item.updatedAt };
  }

  /**
   * Remove evidence from the case. The case_evidence row (and, by cascade,
   * its attached findings) is deleted like any other removal, but the rows are
   * kept on the soft-deleted board item so undo can put them back with their
   * original ids — which is what reconnects hypothesis stances and notes.
   */
  private async evidenceRemove(
    ctx: OpContext,
    op: BoardOpOf<'evidence.remove'>,
  ): Promise<OpOutcome> {
    const item = await this.findItem(ctx, op.itemId);
    if (!item) {
      throw new BoardOpRejected(
        `Item ${op.itemId} is not on this board`,
        'NOT_FOUND',
      );
    }
    if (item.kind !== CaseBoardItemKind.EVIDENCE) {
      throw new BoardOpRejected('Only evidence can be removed from the case');
    }
    if (item.deletedAt) return { id: item.id };
    const evidence = item.refId
      ? await ctx.tx.caseEvidence.findUnique({
          where: { id: item.refId },
          include: { findings: true },
        })
      : null;
    let tombstone: EvidenceTombstone | null = null;
    if (evidence && evidence.caseId === ctx.caseId) {
      tombstone = {
        evidence: {
          id: evidence.id,
          caseId: evidence.caseId,
          entityType: evidence.entityType,
          entityId: evidence.entityId,
          label: evidence.label,
          assetType: evidence.assetType,
          sourceType: evidence.sourceType,
          note: evidence.note,
          addedBy: evidence.addedBy,
          createdAt: evidence.createdAt.toISOString(),
        },
        findings: evidence.findings.map(caseFindingTombstone),
      };
      await this.cases.removeEvidence(
        ctx.caseId,
        evidence.id,
        ctx.actor,
        ctx.tx,
      );
    }
    await this.softDeleteItem(ctx, item, (content) => ({
      ...content,
      ...(tombstone ? { tombstone } : {}),
    }));
    return { id: item.id };
  }

  private async restoreEvidence(
    ctx: OpContext,
    item: CaseBoardItem,
    at?: { x?: number; y?: number },
  ): Promise<OpOutcome> {
    const content = asRecord(item.content) ?? {};
    const tombstone = content.tombstone as EvidenceTombstone | undefined;
    if (!tombstone?.evidence) {
      throw new BoardOpRejected(
        'This evidence was removed outside the board and cannot be restored here. Add it again.',
        'NOT_FOUND',
      );
    }
    const back = await ctx.tx.caseEvidence.findUnique({
      where: {
        caseId_entityType_entityId: {
          caseId: ctx.caseId,
          entityType: tombstone.evidence.entityType,
          entityId: tombstone.evidence.entityId,
        },
      },
      select: { id: true },
    });
    if (back) {
      const bubble = await ctx.tx.caseBoardItem.findFirst({
        where: {
          boardId: ctx.boardId,
          kind: 'EVIDENCE',
          refId: back.id,
          deletedAt: null,
        },
        select: { id: true },
      });
      throw new BoardOpRejected(
        'This evidence was added back to the case meanwhile',
        'ALREADY_ON_BOARD',
        { itemId: bubble?.id ?? null },
      );
    }
    await ctx.tx.caseEvidence.create({
      data: {
        ...tombstone.evidence,
        createdAt: new Date(tombstone.evidence.createdAt),
      },
    });
    if (tombstone.findings.length > 0) {
      await ctx.tx.caseFinding.createMany({
        data: tombstone.findings.map(fromCaseFindingTombstone),
        skipDuplicates: true,
      });
    }
    await this.activity.record(
      ctx.caseId,
      CaseActivityType.EVIDENCE_ADDED,
      {
        evidenceId: tombstone.evidence.id,
        entityId: tombstone.evidence.entityId,
        label: tombstone.evidence.label,
        restored: true,
        findings: tombstone.findings.length,
        itemId: item.id,
      },
      ctx.actor,
      ctx.tx,
    );
    const revived = await this.reviveItem(
      ctx,
      item,
      (c) => {
        const next = { ...c };
        delete next.tombstone;
        return next;
      },
      at,
    );
    return { id: revived.id, updatedAt: revived.updatedAt };
  }

  private async findingAttach(
    ctx: OpContext,
    op: BoardOpOf<'finding.attach'>,
  ): Promise<OpOutcome> {
    const item = await this.liveItem(ctx, op.itemId);
    const evidence = await this.evidenceOf(ctx, item);
    const attached = await ctx.tx.caseFinding.findUnique({
      where: {
        caseId_findingId: { caseId: ctx.caseId, findingId: op.findingId },
      },
      select: { caseEvidenceId: true },
    });
    if (attached) {
      if (attached.caseEvidenceId === evidence.id) return { id: item.id };
      throw new BoardOpRejected('That finding is attached to other evidence');
    }

    const content = asRecord(item.content) ?? {};
    const detached = (asRecord(content.detached) ?? {}) as Record<
      string,
      CaseFindingTombstone
    >;
    const tombstone = detached[op.findingId];
    if (tombstone && tombstone.caseEvidenceId === evidence.id) {
      // Undo of a detach: the same case_findings row comes back, so stances
      // and notes that pointed at it reconnect.
      await ctx.tx.caseFinding.create({
        data: fromCaseFindingTombstone(tombstone),
      });
      delete detached[op.findingId];
      await ctx.tx.caseBoardItem.update({
        where: { id: item.id },
        data: {
          content: toJson({ ...content, detached }),
          updatedBy: ctx.actor ?? null,
        },
      });
      if (tombstone.detachedAt) {
        await ctx.tx.caseBoardLink.updateMany({
          where: {
            boardId: ctx.boardId,
            deletedAt: new Date(tombstone.detachedAt),
            OR: [
              { sourceItemId: item.id, sourceFindingId: op.findingId },
              { targetItemId: item.id, targetFindingId: op.findingId },
            ],
          },
          data: { deletedAt: null },
        });
      }
      await this.activity.record(
        ctx.caseId,
        CaseActivityType.FINDING_ADDED,
        {
          caseFindingId: tombstone.id,
          findingId: op.findingId,
          label: tombstone.label,
          restored: true,
          itemId: item.id,
        },
        ctx.actor,
        ctx.tx,
      );
      return { id: item.id };
    }

    const finding = await ctx.tx.finding.findUnique({
      where: { id: op.findingId },
      select: { assetId: true },
    });
    if (!finding) throw new BoardOpRejected('Finding not found', 'NOT_FOUND');
    if (finding.assetId !== evidence.entityId) {
      throw new BoardOpRejected('That finding belongs to a different asset');
    }
    await this.cases.attachFindings(
      ctx.caseId,
      { findingIds: [op.findingId], addedBy: ctx.actor },
      ctx.tx,
    );
    return { id: item.id };
  }

  private async findingDetach(
    ctx: OpContext,
    op: BoardOpOf<'finding.detach'>,
  ): Promise<OpOutcome> {
    const item = await this.liveItem(ctx, op.itemId);
    const evidence = await this.evidenceOf(ctx, item);
    const cf = await ctx.tx.caseFinding.findUnique({
      where: {
        caseId_findingId: { caseId: ctx.caseId, findingId: op.findingId },
      },
    });
    if (!cf) return { id: item.id };
    if (cf.caseEvidenceId !== evidence.id) {
      throw new BoardOpRejected('That finding is attached to other evidence');
    }
    await this.cases.removeFinding(ctx.caseId, cf.id, ctx.actor, ctx.tx);
    const content = asRecord(item.content) ?? {};
    const detached = asRecord(content.detached) ?? {};
    detached[op.findingId] = {
      ...caseFindingTombstone(cf),
      detachedAt: ctx.now.toISOString(),
    };
    await ctx.tx.caseBoardItem.update({
      where: { id: item.id },
      data: {
        content: toJson({ ...content, detached }),
        updatedBy: ctx.actor ?? null,
      },
    });
    // Links drawn to that row lose their end; they come back with the row.
    await ctx.tx.caseBoardLink.updateMany({
      where: {
        boardId: ctx.boardId,
        deletedAt: null,
        OR: [
          { sourceItemId: item.id, sourceFindingId: op.findingId },
          { targetItemId: item.id, targetFindingId: op.findingId },
        ],
      },
      data: { deletedAt: ctx.now },
    });
    return { id: item.id };
  }

  // ─── Hypotheses & stances ─────────────────────────────────────────────────

  private async hypothesisCreate(
    ctx: OpContext,
    op: BoardOpOf<'hypothesis.create'>,
  ): Promise<OpOutcome> {
    const existing = await this.findItem(ctx, op.itemId);
    if (existing) {
      if (existing.kind !== CaseBoardItemKind.HYPOTHESIS) {
        throw new BoardOpRejected(`Item ${op.itemId} is not a hypothesis`);
      }
      if (!existing.deletedAt)
        return { id: existing.id, updatedAt: existing.updatedAt };
      const revived = await this.reviveItem(ctx, existing, undefined, op);
      return { id: revived.id, updatedAt: revived.updatedAt, arranged: true };
    }
    const thread = await this.threads.create(
      ctx.caseId,
      {
        kind: CaseThreadKind.HYPOTHESIS,
        title: op.title.slice(0, 200),
        statement: op.title,
        color: op.color,
        createdBy: ctx.actor,
      },
      ctx.tx,
    );
    const item = await ctx.tx.caseBoardItem.create({
      data: {
        id: op.itemId,
        boardId: ctx.boardId,
        kind: CaseBoardItemKind.HYPOTHESIS,
        refId: thread.id,
        x: op.x ?? null,
        y: op.y ?? null,
        createdBy: ctx.actor ?? null,
        updatedBy: ctx.actor ?? null,
      },
    });
    for (const target of op.supports ?? []) {
      await this.setStance(ctx, thread.id, target, 'SUPPORTS');
    }
    return { id: item.id, updatedAt: item.updatedAt };
  }

  private async stanceSet(
    ctx: OpContext,
    op: BoardOpOf<'stance.set'>,
  ): Promise<OpOutcome> {
    const hypothesis = await this.liveItem(ctx, op.hypothesisItemId);
    if (hypothesis.kind !== CaseBoardItemKind.HYPOTHESIS || !hypothesis.refId) {
      throw new BoardOpRejected('A stance starts at a hypothesis');
    }
    const supportId = await this.setStance(
      ctx,
      hypothesis.refId,
      op.target,
      op.stance,
      op.weight,
      op.note,
    );
    return { id: supportId };
  }

  /**
   * Upsert the support row between a hypothesis thread and an endpoint. A
   * finding row that is not attached yet is attached first — this used to be
   * a client-side attach-then-refetch dance (`resolveTarget`).
   */
  private async setStance(
    ctx: OpContext,
    threadId: string,
    target: BoardEndpoint,
    stance: 'SUPPORTS' | 'CONTRADICTS' | 'NEUTRAL',
    weight?: number,
    note?: string,
  ): Promise<string> {
    const { targetType, targetId } = await this.resolveStanceTarget(
      ctx,
      target,
      true,
    );
    await this.threads.linkSupport(
      threadId,
      { targetType, targetId, stance, weight, note },
      ctx.actor,
      ctx.tx,
    );
    const row = await ctx.tx.caseThreadSupport.findUniqueOrThrow({
      where: {
        threadId_targetType_targetId: { threadId, targetType, targetId },
      },
      select: { id: true },
    });
    return row.id;
  }

  private async stanceRemove(
    ctx: OpContext,
    op: BoardOpOf<'stance.remove'>,
  ): Promise<OpOutcome> {
    // The card may already be off the board when an undo removes its stance.
    const hypothesis = await this.findItem(ctx, op.hypothesisItemId);
    if (!hypothesis || hypothesis.kind !== 'HYPOTHESIS' || !hypothesis.refId) {
      throw new BoardOpRejected(
        'Hypothesis not found on this board',
        'NOT_FOUND',
      );
    }
    let resolved: { targetType: 'evidence' | 'finding'; targetId: string };
    try {
      resolved = await this.resolveStanceTarget(ctx, op.target, false);
    } catch (error) {
      if (error instanceof BoardOpRejected && error.code === 'NOT_FOUND') {
        return {};
      }
      throw error;
    }
    const support = await ctx.tx.caseThreadSupport.findUnique({
      where: {
        threadId_targetType_targetId: {
          threadId: hypothesis.refId,
          targetType: resolved.targetType,
          targetId: resolved.targetId,
        },
      },
      select: { id: true },
    });
    if (!support) return {};
    await this.threads.unlinkSupport(
      hypothesis.refId,
      support.id,
      ctx.actor,
      ctx.tx,
    );
    return { id: support.id };
  }

  private async resolveStanceTarget(
    ctx: OpContext,
    target: BoardEndpoint,
    attachIfNeeded: boolean,
  ): Promise<{ targetType: 'evidence' | 'finding'; targetId: string }> {
    const item = attachIfNeeded
      ? await this.liveItem(ctx, target.itemId)
      : await this.findItem(ctx, target.itemId);
    if (!item)
      throw new BoardOpRejected('Target is not on this board', 'NOT_FOUND');
    if (item.kind !== CaseBoardItemKind.EVIDENCE) {
      throw new BoardOpRejected(
        'A hypothesis takes a stance on evidence or a finding',
      );
    }
    const evidence = item.refId
      ? await ctx.tx.caseEvidence.findUnique({
          where: { id: item.refId },
          select: { id: true, entityId: true, caseId: true },
        })
      : null;
    if (!evidence || evidence.caseId !== ctx.caseId) {
      throw new BoardOpRejected(
        'That evidence is no longer on the case',
        'NOT_FOUND',
      );
    }
    if (!target.findingId)
      return { targetType: 'evidence', targetId: evidence.id };
    let cf = await ctx.tx.caseFinding.findUnique({
      where: {
        caseId_findingId: { caseId: ctx.caseId, findingId: target.findingId },
      },
      select: { id: true, caseEvidenceId: true },
    });
    if (!cf) {
      if (!attachIfNeeded)
        throw new BoardOpRejected('Finding not attached', 'NOT_FOUND');
      const finding = await ctx.tx.finding.findUnique({
        where: { id: target.findingId },
        select: { assetId: true },
      });
      if (!finding) throw new BoardOpRejected('Finding not found', 'NOT_FOUND');
      if (finding.assetId !== evidence.entityId) {
        throw new BoardOpRejected('That finding belongs to a different asset');
      }
      await this.cases.attachFindings(
        ctx.caseId,
        { findingIds: [target.findingId], addedBy: ctx.actor },
        ctx.tx,
      );
      cf = await ctx.tx.caseFinding.findUniqueOrThrow({
        where: {
          caseId_findingId: { caseId: ctx.caseId, findingId: target.findingId },
        },
        select: { id: true, caseEvidenceId: true },
      });
    }
    if (cf.caseEvidenceId !== evidence.id) {
      throw new BoardOpRejected('That finding is attached to other evidence');
    }
    return { targetType: 'finding', targetId: cf.id };
  }

  // ─── Comments & threads ───────────────────────────────────────────────────

  private async commentCreate(
    ctx: OpContext,
    op: BoardOpOf<'comment.create'>,
  ): Promise<OpOutcome> {
    const existing = await this.findItem(ctx, op.itemId);
    if (existing) {
      if (existing.kind !== CaseBoardItemKind.COMMENT) {
        throw new BoardOpRejected(`Item ${op.itemId} is not a comment`);
      }
      if (!existing.deletedAt)
        return { id: existing.id, updatedAt: existing.updatedAt };
      const revived = await this.reviveItem(ctx, existing);
      return { id: revived.id, updatedAt: revived.updatedAt, arranged: true };
    }
    const anchor = op.anchor ? await this.assertAnchor(ctx, op.anchor) : null;
    const thread = await this.threads.create(
      ctx.caseId,
      {
        kind: CaseThreadKind.DISCUSSION,
        title: excerpt(op.body, 80),
        createdBy: ctx.actor,
      },
      ctx.tx,
    );
    await this.threads.addEntry(
      thread.id,
      { entryType: CaseThreadEntryType.NOTE, body: op.body, author: ctx.actor },
      ctx.tx,
    );
    const item = await ctx.tx.caseBoardItem.create({
      data: {
        id: op.itemId,
        boardId: ctx.boardId,
        kind: CaseBoardItemKind.COMMENT,
        refId: thread.id,
        x: op.x ?? null,
        y: op.y ?? null,
        parentId: anchor?.itemId ?? null,
        style: anchor?.findingId
          ? { anchorFindingId: anchor.findingId }
          : undefined,
        createdBy: ctx.actor ?? null,
        updatedBy: ctx.actor ?? null,
      },
    });
    return { id: item.id, updatedAt: item.updatedAt };
  }

  private async commentResolve(
    ctx: OpContext,
    op: BoardOpOf<'comment.resolve'>,
  ): Promise<OpOutcome> {
    const item = await this.liveItem(ctx, op.itemId);
    if (item.kind !== CaseBoardItemKind.COMMENT || !item.refId) {
      throw new BoardOpRejected('Only comments can be resolved');
    }
    const result = await this.threads.setResolved(
      item.refId,
      op.resolved,
      ctx.actor,
      ctx.tx,
    );
    if (result.changed) {
      await this.record(ctx, CaseActivityType.COMMENT_RESOLVED, {
        itemId: item.id,
        threadId: item.refId,
        threadTitle: result.title,
        resolved: op.resolved,
      });
    }
    return { id: item.id };
  }

  private async threadPlace(
    ctx: OpContext,
    op: BoardOpOf<'thread.place'>,
  ): Promise<OpOutcome> {
    const thread = await ctx.tx.caseThread.findFirst({
      where: { id: op.threadId, caseId: ctx.caseId },
      select: { id: true, kind: true },
    });
    if (!thread)
      throw new BoardOpRejected('Thread not found on this case', 'NOT_FOUND');
    const kind =
      thread.kind === CaseThreadKind.HYPOTHESIS
        ? CaseBoardItemKind.HYPOTHESIS
        : CaseBoardItemKind.COMMENT;
    const anchor =
      kind === CaseBoardItemKind.COMMENT && op.anchor
        ? await this.assertAnchor(ctx, op.anchor)
        : null;
    const existing = await ctx.tx.caseBoardItem.findFirst({
      where: { boardId: ctx.boardId, kind, refId: thread.id },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) {
      const placed = existing.deletedAt
        ? await this.reviveItem(ctx, existing)
        : existing;
      const updated = await ctx.tx.caseBoardItem.update({
        where: { id: placed.id },
        data: {
          ...(op.x !== undefined ? { x: op.x } : {}),
          ...(op.y !== undefined ? { y: op.y } : {}),
          ...(kind === CaseBoardItemKind.COMMENT && op.anchor !== undefined
            ? {
                parentId: anchor?.itemId ?? null,
                style: toJson(
                  mergeStyle(asRecord(placed.style), {
                    anchorFindingId: anchor?.findingId ?? null,
                  }),
                ),
              }
            : {}),
          updatedBy: ctx.actor ?? null,
        },
      });
      return { id: updated.id, updatedAt: updated.updatedAt, arranged: true };
    }
    const item = await ctx.tx.caseBoardItem.create({
      data: {
        id: op.itemId,
        boardId: ctx.boardId,
        kind,
        refId: thread.id,
        x: op.x ?? null,
        y: op.y ?? null,
        parentId: anchor?.itemId ?? null,
        style: anchor?.findingId
          ? { anchorFindingId: anchor.findingId }
          : undefined,
        createdBy: ctx.actor ?? null,
        updatedBy: ctx.actor ?? null,
      },
    });
    return { id: item.id, updatedAt: item.updatedAt, arranged: true };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Any item of this board by id, soft-deleted or not. */
  private async findItem(
    ctx: OpContext,
    id: string,
  ): Promise<CaseBoardItem | null> {
    const item = await ctx.tx.caseBoardItem.findUnique({ where: { id } });
    if (item && item.boardId !== ctx.boardId) {
      throw new BoardOpRejected(
        `Item ${id} belongs to another board`,
        'NOT_FOUND',
      );
    }
    return item;
  }

  private async liveItem(ctx: OpContext, id: string): Promise<CaseBoardItem> {
    const item = await this.findItem(ctx, id);
    if (!item || item.deletedAt) {
      throw new BoardOpRejected(`Item ${id} is not on this board`, 'NOT_FOUND');
    }
    return item;
  }

  private async liveLink(ctx: OpContext, id: string): Promise<CaseBoardLink> {
    const link = await ctx.tx.caseBoardLink.findUnique({ where: { id } });
    if (!link || link.boardId !== ctx.boardId || link.deletedAt) {
      throw new BoardOpRejected(`Link ${id} is not on this board`, 'NOT_FOUND');
    }
    return link;
  }

  private async evidenceOf(ctx: OpContext, item: CaseBoardItem) {
    if (item.kind !== CaseBoardItemKind.EVIDENCE || !item.refId) {
      throw new BoardOpRejected('Findings live inside evidence bubbles');
    }
    const evidence = await ctx.tx.caseEvidence.findUnique({
      where: { id: item.refId },
      select: { id: true, entityId: true, caseId: true },
    });
    if (!evidence || evidence.caseId !== ctx.caseId) {
      throw new BoardOpRejected(
        'That evidence is no longer on the case',
        'NOT_FOUND',
      );
    }
    return evidence;
  }

  /**
   * A link end must be a live item on this board that can carry links, and a
   * finding end must be a row attached to that very bubble.
   */
  private async assertLinkEndpoint(
    ctx: OpContext,
    end: BoardEndpoint,
  ): Promise<void> {
    const item = await this.liveItem(ctx, end.itemId);
    if (!LINKABLE_KINDS.has(item.kind)) {
      throw new BoardOpRejected(
        item.kind === 'FRAME'
          ? 'Frames group items; link the items inside instead'
          : 'Comments cannot be linked',
      );
    }
    if (!end.findingId) return;
    const evidence = await this.evidenceOf(ctx, item);
    const cf = await ctx.tx.caseFinding.findUnique({
      where: {
        caseId_findingId: { caseId: ctx.caseId, findingId: end.findingId },
      },
      select: { caseEvidenceId: true },
    });
    if (!cf || cf.caseEvidenceId !== evidence.id) {
      throw new BoardOpRejected(
        'Link ends on a finding must be findings attached to that evidence. Attach it first.',
      );
    }
  }

  private async assertAnchor(
    ctx: OpContext,
    anchor: BoardEndpoint,
  ): Promise<BoardEndpoint> {
    const item = await this.liveItem(ctx, anchor.itemId);
    if (item.kind === CaseBoardItemKind.COMMENT) {
      throw new BoardOpRejected(
        'A comment cannot be pinned to another comment',
      );
    }
    if (anchor.findingId && item.kind !== CaseBoardItemKind.EVIDENCE) {
      throw new BoardOpRejected('Only evidence bubbles have finding rows');
    }
    return anchor;
  }

  /**
   * Frames hold regular items; a comment pin hangs off the item it annotates.
   * Parents must be live items of this board, and nesting must not loop.
   */
  private async assertParent(
    ctx: OpContext,
    childId: string,
    childKind: CaseBoardItemKind,
    parentId: string,
  ): Promise<void> {
    if (parentId === childId)
      throw new BoardOpRejected('An item cannot contain itself');
    const parent = await this.liveItem(ctx, parentId);
    if (childKind === CaseBoardItemKind.COMMENT) {
      if (parent.kind === CaseBoardItemKind.COMMENT) {
        throw new BoardOpRejected(
          'A comment cannot be pinned to another comment',
        );
      }
    } else if (parent.kind !== CaseBoardItemKind.FRAME) {
      throw new BoardOpRejected('Items can only be placed inside frames');
    }
    // Walk up from the parent; meeting the child means a cycle.
    let cursor: string | null = parent.parentId;
    const seen = new Set<string>([parent.id]);
    while (cursor) {
      if (cursor === childId || seen.has(cursor)) {
        throw new BoardOpRejected('Frames cannot contain each other');
      }
      seen.add(cursor);
      const next: { parentId: string | null } | null =
        await ctx.tx.caseBoardItem.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = next?.parentId ?? null;
    }
  }

  /** The graph entity behind a link end, for promotion into `edges`. */
  private async entityOf(
    ctx: OpContext,
    itemId: string,
    findingId: string | null,
  ): Promise<{ type: string; id: string }> {
    const item = await this.liveItem(ctx, itemId);
    if (item.kind !== CaseBoardItemKind.EVIDENCE) {
      throw new BoardOpRejected(
        'Only links between evidence can become global relationships',
      );
    }
    if (findingId) return { type: 'finding', id: findingId };
    const evidence = await this.evidenceOf(ctx, item);
    return { type: 'asset', id: evidence.entityId };
  }

  /**
   * Soft-delete an item with the links touching it (one shared timestamp, so
   * a restore revives exactly those) and free its children.
   */
  private async softDeleteItem(
    ctx: OpContext,
    item: CaseBoardItem,
    content?: (current: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    await unparentChildren(ctx.tx, ctx.boardId, [item.id]);
    await ctx.tx.caseBoardItem.update({
      where: { id: item.id },
      data: {
        deletedAt: ctx.now,
        updatedBy: ctx.actor ?? null,
        ...(content
          ? { content: toJson(content(asRecord(item.content) ?? {})) }
          : {}),
      },
    });
    await ctx.tx.caseBoardLink.updateMany({
      where: {
        boardId: ctx.boardId,
        deletedAt: null,
        OR: [{ sourceItemId: item.id }, { targetItemId: item.id }],
      },
      data: { deletedAt: ctx.now },
    });
  }

  private async reviveItem(
    ctx: OpContext,
    item: CaseBoardItem,
    content?: (current: Record<string, unknown>) => Record<string, unknown>,
    at?: { x?: number; y?: number },
  ): Promise<CaseBoardItem> {
    // A parent that has since gone cannot hold the item again.
    let parentId = item.parentId;
    if (parentId) {
      const parent = await ctx.tx.caseBoardItem.findUnique({
        where: { id: parentId },
        select: { deletedAt: true },
      });
      if (!parent || parent.deletedAt) parentId = null;
    }
    const revived = await ctx.tx.caseBoardItem.update({
      where: { id: item.id },
      data: {
        deletedAt: null,
        parentId,
        updatedBy: ctx.actor ?? null,
        ...(at?.x !== undefined ? { x: at.x } : {}),
        ...(at?.y !== undefined ? { y: at.y } : {}),
        ...(content
          ? { content: toJson(content(asRecord(item.content) ?? {})) }
          : {}),
      },
    });
    if (item.deletedAt) {
      // Links that left with the item come back with it — when their other
      // end is still on the board.
      const links = await ctx.tx.caseBoardLink.findMany({
        where: {
          boardId: ctx.boardId,
          deletedAt: item.deletedAt,
          OR: [{ sourceItemId: item.id }, { targetItemId: item.id }],
        },
        select: { id: true, sourceItemId: true, targetItemId: true },
      });
      const others = [
        ...new Set(
          links.map((l) =>
            l.sourceItemId === item.id ? l.targetItemId : l.sourceItemId,
          ),
        ),
      ];
      const live = new Set(
        (
          await ctx.tx.caseBoardItem.findMany({
            where: { id: { in: others }, deletedAt: null },
            select: { id: true },
          })
        ).map((r) => r.id),
      );
      const revive = links
        .filter((l) =>
          live.has(
            l.sourceItemId === item.id ? l.targetItemId : l.sourceItemId,
          ),
        )
        .map((l) => l.id);
      if (revive.length > 0) {
        await ctx.tx.caseBoardLink.updateMany({
          where: { id: { in: revive } },
          data: { deletedAt: null },
        });
      }
    }
    return revived;
  }

  private async reviveLink(
    ctx: OpContext,
    link: CaseBoardLink,
  ): Promise<OpOutcome> {
    await this.assertLinkEndpoint(ctx, {
      itemId: link.sourceItemId,
      findingId: link.sourceFindingId ?? undefined,
    });
    await this.assertLinkEndpoint(ctx, {
      itemId: link.targetItemId,
      findingId: link.targetFindingId ?? undefined,
    });
    const revived = await ctx.tx.caseBoardLink.update({
      where: { id: link.id },
      data: { deletedAt: null, updatedBy: ctx.actor ?? null },
    });
    await this.record(ctx, CaseActivityType.BOARD_LINK_ADDED, {
      linkId: link.id,
      kind: link.kind,
      label: link.label,
      restored: true,
      itemId: link.sourceItemId,
    });
    return { id: revived.id, updatedAt: revived.updatedAt };
  }

  private record(
    ctx: OpContext,
    type: CaseActivityType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return this.activity.record(ctx.caseId, type, payload, ctx.actor, ctx.tx);
  }

  private recordNative(
    ctx: OpContext,
    kind: CaseBoardItemKind,
    what: 'ADDED' | 'REMOVED',
    item: CaseBoardItem,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const type =
      kind === 'NOTE'
        ? what === 'ADDED'
          ? CaseActivityType.BOARD_NOTE_ADDED
          : CaseActivityType.BOARD_NOTE_REMOVED
        : what === 'ADDED'
          ? CaseActivityType.BOARD_FRAME_ADDED
          : CaseActivityType.BOARD_FRAME_REMOVED;
    const content = asRecord(item.content) ?? {};
    const text = textOf(content[kind === 'NOTE' ? 'text' : 'title']);
    return this.record(ctx, type, {
      itemId: item.id,
      excerpt: truncate(text),
      ...extra,
    });
  }

  /**
   * Moves and resizes are the bulk of board traffic and mean little one by
   * one: they become at most one BOARD_ARRANGED row per actor per five
   * minutes. The log stays append-only — a row already in the window simply
   * absorbs later moves.
   */
  private async recordArranged(ctx: OpContext, count: number): Promise<void> {
    if (count === 0) return;
    const recent = await ctx.tx.caseActivity.findFirst({
      where: {
        caseId: ctx.caseId,
        activityType: CaseActivityType.BOARD_ARRANGED,
        actor: ctx.actor ?? null,
        createdAt: { gte: new Date(ctx.now.getTime() - ARRANGED_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (recent) return;
    await this.record(ctx, CaseActivityType.BOARD_ARRANGED, { count });
  }
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

/** Map an expected failure to a per-op rejection; null means "rethrow". */
function asRejection(error: unknown): Omit<RejectedBoardOpDto, 'opId'> | null {
  if (error instanceof BoardOpRejected) {
    return {
      reason: error.message,
      code: error.code,
      ...(error.current ? { current: error.current } : {}),
    };
  }
  // The delegated case services speak HTTP: a 4xx from them is a refusal of
  // this op, not a failure of the batch.
  if (error instanceof HttpException && error.getStatus() < 500) {
    return {
      reason: error.message,
      code: error.getStatus() === 404 ? 'NOT_FOUND' : 'INVALID',
    };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002')
      return { reason: 'That already exists', code: 'CONFLICT' };
    if (error.code === 'P2003' || error.code === 'P2025') {
      return {
        reason: 'Something it refers to no longer exists',
        code: 'NOT_FOUND',
      };
    }
  }
  return null;
}

/**
 * Merge a style patch key by key. `null` removes a key; `rowHighlights` is
 * merged per finding the same way, so highlighting one row leaves the others.
 */
/** Style keys holding one entry per finding, merged entry by entry. */
const PER_FINDING_STYLE_KEYS = new Set(['rowHighlights', 'findingPositions']);

export function mergeStyle(
  current: Record<string, unknown> | null,
  patch: BoardStyle | undefined,
): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  if (!patch) return Object.keys(next).length > 0 ? next : null;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (PER_FINDING_STYLE_KEYS.has(key)) {
      const rows: Record<string, unknown> = { ...(asRecord(next[key]) ?? {}) };
      for (const [findingId, entry] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (entry === null) delete rows[findingId];
        else rows[findingId] = entry;
      }
      if (Object.keys(rows).length > 0) next[key] = rows;
      else delete next[key];
      continue;
    }
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return Object.keys(next).length > 0 ? next : null;
}

function cleanContent(
  kind: CaseBoardItemKind,
  content: { text?: string; title?: string } | undefined,
): Record<string, unknown> {
  if (!content)
    return kind === 'NOTE'
      ? { text: '' }
      : kind === 'FRAME'
        ? { title: '' }
        : {};
  if (kind === 'NOTE')
    return content.text !== undefined ? { text: content.text } : {};
  if (kind === 'FRAME')
    return content.title !== undefined ? { title: content.title } : {};
  return {};
}

function toJson(
  value: Record<string, unknown> | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function truncate(text: string, max = ACTIVITY_TEXT_MAX): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function excerpt(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Board link kinds are snake_case words; global relation types are UPPER_SNAKE. */
export function toRelationType(kind: string): string {
  const normalized = kind
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  if (normalized === 'SAME_ENTITY') return 'SAME_AS';
  return normalized || 'RELATED_TO';
}

function caseFindingTombstone(cf: {
  id: string;
  caseId: string;
  caseEvidenceId: string;
  findingId: string;
  label: string;
  severity: string | null;
  detectorType: string | null;
  customDetectorName: string | null;
  matchedContent: string | null;
  note: string | null;
  createdAt: Date;
}): CaseFindingTombstone {
  return {
    id: cf.id,
    caseId: cf.caseId,
    caseEvidenceId: cf.caseEvidenceId,
    findingId: cf.findingId,
    label: cf.label,
    severity: cf.severity,
    detectorType: cf.detectorType,
    customDetectorName: cf.customDetectorName,
    matchedContent: cf.matchedContent,
    note: cf.note,
    createdAt: cf.createdAt.toISOString(),
  };
}

function fromCaseFindingTombstone(
  t: CaseFindingTombstone,
): Prisma.CaseFindingCreateManyInput {
  return {
    id: t.id,
    caseId: t.caseId,
    caseEvidenceId: t.caseEvidenceId,
    findingId: t.findingId,
    label: t.label,
    severity: t.severity,
    detectorType: t.detectorType,
    customDetectorName: t.customDetectorName,
    matchedContent: t.matchedContent,
    note: t.note,
    createdAt: new Date(t.createdAt),
  };
}
