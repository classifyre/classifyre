import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CaseActivityType,
  CaseBoardItem,
  CaseBoardLink,
  CaseStatus,
  EvidenceStance,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { GraphService } from '../graph.service';
import { CaseActivityService } from '../case-activity.service';
import {
  BoardItemDto,
  BoardLinkDto,
  BoardSupportDto,
  BoardThreadSummaryDto,
  CaseBoardResponseDto,
  CaseBoardSnapshotDto,
  CaseBoardSnapshotSummaryDto,
} from '../dto/case-board.dto';
import { CaseEvidenceDto } from '../dto/case.dto';

type Db = Prisma.TransactionClient;

/** A closed case is a record: its board can be read, never changed. */
export const READ_ONLY_CASE_STATUSES: ReadonlySet<CaseStatus> = new Set([
  CaseStatus.CLOSED,
  CaseStatus.ARCHIVED,
]);

export function isReadOnlyCase(status: CaseStatus): boolean {
  return READ_ONLY_CASE_STATUSES.has(status);
}

export function toBoardItemDto(row: CaseBoardItem): BoardItemDto {
  const content = asRecord(row.content);
  // Tombstones are the server's undo state for removed evidence and detached
  // findings; they never leave it.
  if (content) {
    delete content.tombstone;
    delete content.detached;
  }
  return {
    id: row.id,
    kind: row.kind,
    refId: row.refId,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    z: row.z,
    parentId: row.parentId,
    collapsed: row.collapsed,
    style: asRecord(row.style),
    content: content && Object.keys(content).length > 0 ? content : null,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toBoardLinkDto(row: CaseBoardLink): BoardLinkDto {
  return {
    id: row.id,
    sourceItemId: row.sourceItemId,
    sourceFindingId: row.sourceFindingId,
    targetItemId: row.targetItemId,
    targetFindingId: row.targetFindingId,
    kind: row.kind,
    label: row.label,
    certainty: row.certainty,
    confidence: row.confidence === null ? null : Number(row.confidence),
    note: row.note,
    promotedEdgeId: row.promotedEdgeId,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : null;
}

/**
 * The read side of the case board: the lazy reconcile that keeps board items
 * in step with the case's evidence and threads, the board payload, and
 * snapshots.
 *
 * Deliberately free of CasesService/CaseThreadsService so CasesService can
 * depend on it (to snapshot a board when its case closes) without closing a
 * Nest dependency cycle — which under this runtime hangs boot silently.
 */
@Injectable()
export class CaseBoardReadService {
  private readonly logger = new Logger(CaseBoardReadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly activity: CaseActivityService,
  ) {}

  /**
   * Make sure the case has a board and that every evidence row and every
   * hypothesis thread has exactly one item on it (unplaced until a client
   * lays it out). Items whose domain row disappeared — evidence removed or a
   * thread deleted over REST/MCP — are soft-deleted with their links.
   *
   * Idempotent and cheap at case scale: the inserts are `ON CONFLICT DO
   * NOTHING` against the (board, kind, ref) unique index and the soft-delete
   * is an anti-join on primary keys.
   */
  async reconcile(caseId: string): Promise<{ boardId: string }> {
    const run = () =>
      this.prisma.$transaction(async (tx) => {
        const board = await tx.caseBoard.upsert({
          where: { caseId },
          create: { caseId },
          update: {},
          select: { id: true },
        });
        // Enum literals are cast explicitly: raw SQL types an untyped
        // placeholder as text, and a mocked PrismaService never notices.
        await tx.$executeRaw`
          INSERT INTO case_board_items (id, board_id, kind, ref_id, created_at, updated_at)
          SELECT gen_random_uuid()::text, ${board.id}, 'EVIDENCE'::"CaseBoardItemKind", e.id, now(), now()
            FROM case_evidence e
           WHERE e.case_id = ${caseId}
          ON CONFLICT (board_id, kind, ref_id) DO NOTHING`;
        await tx.$executeRaw`
          INSERT INTO case_board_items (id, board_id, kind, ref_id, created_at, updated_at)
          SELECT gen_random_uuid()::text, ${board.id}, 'HYPOTHESIS'::"CaseBoardItemKind", t.id, now(), now()
            FROM case_threads t
           WHERE t.case_id = ${caseId} AND t.kind = 'HYPOTHESIS'::"CaseThreadKind"
          ON CONFLICT (board_id, kind, ref_id) DO NOTHING`;
        const gone = await tx.$queryRaw<{ id: string }[]>`
          SELECT i.id
            FROM case_board_items i
           WHERE i.board_id = ${board.id}
             AND i.deleted_at IS NULL
             AND (
               (i.kind = 'EVIDENCE'::"CaseBoardItemKind"
                 AND NOT EXISTS (SELECT 1 FROM case_evidence e WHERE e.id = i.ref_id))
               OR (i.kind IN ('HYPOTHESIS'::"CaseBoardItemKind", 'COMMENT'::"CaseBoardItemKind")
                 AND NOT EXISTS (SELECT 1 FROM case_threads t WHERE t.id = i.ref_id))
             )`;
        if (gone.length > 0) {
          // One timestamp for the items and their links: restoring an item
          // revives exactly the links that left with it.
          const now = new Date();
          const ids = gone.map((g) => g.id);
          await unparentChildren(tx, board.id, ids);
          await tx.caseBoardItem.updateMany({
            where: { id: { in: ids } },
            data: { deletedAt: now },
          });
          await tx.caseBoardLink.updateMany({
            where: {
              boardId: board.id,
              deletedAt: null,
              OR: [
                { sourceItemId: { in: ids } },
                { targetItemId: { in: ids } },
              ],
            },
            data: { deletedAt: now },
          });
        }
        return { boardId: board.id };
      });
    try {
      return await run();
    } catch (error) {
      // Two first opens of the same case race on the board's unique case_id;
      // the loser retries and finds the winner's board.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return run();
      }
      throw error;
    }
  }

  /** The board's version without building the payload (0 before it first opens). */
  async currentVersion(caseId: string): Promise<number> {
    const board = await this.prisma.caseBoard.findUnique({
      where: { caseId },
      select: { version: true },
    });
    return board?.version ?? 0;
  }

  async getBoard(caseId: string): Promise<CaseBoardResponseDto> {
    const caseRow = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true, status: true },
    });
    if (!caseRow)
      throw new NotFoundException(`Case with ID ${caseId} not found`);
    const { boardId } = await this.reconcile(caseId);
    return this.buildPayload(caseId, caseRow.status, boardId);
  }

  private async buildPayload(
    caseId: string,
    caseStatus: CaseStatus,
    boardId: string,
  ): Promise<CaseBoardResponseDto> {
    const [board, items, threadItems, links, evidenceRows, threadRows, graph] =
      await Promise.all([
        this.prisma.caseBoard.findUniqueOrThrow({
          where: { id: boardId },
          select: { id: true, caseId: true, version: true },
        }),
        this.prisma.caseBoardItem.findMany({
          where: { boardId, deletedAt: null },
          orderBy: [{ z: 'asc' }, { createdAt: 'asc' }],
        }),
        // Thread items including removed ones, so "Place on board" can bring
        // back the card a hypothesis already had instead of adding a second.
        this.prisma.caseBoardItem.findMany({
          where: { boardId, kind: { in: ['HYPOTHESIS', 'COMMENT'] } },
          select: { id: true, refId: true, deletedAt: true, updatedAt: true },
          orderBy: { updatedAt: 'asc' },
        }),
        this.prisma.caseBoardLink.findMany({
          where: { boardId, deletedAt: null },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.caseEvidence.findMany({
          where: { caseId },
          orderBy: { createdAt: 'asc' },
          include: { findings: { orderBy: { createdAt: 'asc' } } },
        }),
        this.prisma.caseThread.findMany({
          where: { caseId },
          orderBy: { createdAt: 'asc' },
          include: {
            _count: { select: { entries: true } },
            support: true,
            entries: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { createdAt: true, author: true, body: true },
            },
          },
        }),
        this.graph.caseGraph(caseId, 1),
      ]);

    const evidence = evidenceRows.map(toEvidenceDto);

    // Resolve stance targets to board endpoints once, here, so the client
    // never has to know how case_findings ids map onto bubbles.
    const itemByEvidenceId = new Map<string, string>();
    for (const item of items) {
      if (item.kind === 'EVIDENCE' && item.refId) {
        itemByEvidenceId.set(item.refId, item.id);
      }
    }
    const caseFindingById = new Map<
      string,
      { caseEvidenceId: string; findingId: string }
    >();
    for (const e of evidenceRows) {
      for (const cf of e.findings) {
        caseFindingById.set(cf.id, {
          caseEvidenceId: cf.caseEvidenceId,
          findingId: cf.findingId,
        });
      }
    }
    const supports: BoardSupportDto[] = [];
    for (const thread of threadRows) {
      if (thread.kind !== 'HYPOTHESIS') continue;
      for (const s of thread.support) {
        let endpoint: BoardSupportDto['endpoint'] = null;
        if (s.targetType === 'evidence') {
          const itemId = itemByEvidenceId.get(s.targetId);
          if (itemId) endpoint = { itemId, findingId: null };
        } else if (s.targetType === 'finding') {
          const cf = caseFindingById.get(s.targetId);
          const itemId = cf
            ? itemByEvidenceId.get(cf.caseEvidenceId)
            : undefined;
          if (cf && itemId) endpoint = { itemId, findingId: cf.findingId };
        }
        supports.push({
          id: s.id,
          threadId: s.threadId,
          targetType: s.targetType,
          targetId: s.targetId,
          stance: s.stance,
          weight: s.weight === null ? null : Number(s.weight),
          note: s.note,
          endpoint,
          createdAt: s.createdAt,
        });
      }
    }

    // Newest item per thread wins (ordered by updatedAt ascending above).
    const itemByThread = new Map<string, { id: string; onBoard: boolean }>();
    for (const item of threadItems) {
      if (item.refId) {
        itemByThread.set(item.refId, {
          id: item.id,
          onBoard: item.deletedAt === null,
        });
      }
    }
    // …but a live item beats a removed one regardless of recency.
    for (const item of threadItems) {
      if (item.refId && item.deletedAt === null) {
        itemByThread.set(item.refId, { id: item.id, onBoard: true });
      }
    }

    const threads: BoardThreadSummaryDto[] = threadRows.map((t) => {
      const last = t.entries[0];
      const placed = itemByThread.get(t.id);
      return {
        id: t.id,
        kind: t.kind,
        title: t.title,
        status: t.status,
        confidence: t.confidence === null ? null : Number(t.confidence),
        color: t.color,
        createdBy: t.createdBy,
        entryCount: t._count.entries,
        lastEntryAt: last?.createdAt ?? null,
        lastAuthor: last?.author ?? null,
        lastExcerpt: last?.body ? last.body.slice(0, 280) : null,
        supportingCount: t.support.filter(
          (s) => s.stance === EvidenceStance.SUPPORTS,
        ).length,
        contradictingCount: t.support.filter(
          (s) => s.stance === EvidenceStance.CONTRADICTS,
        ).length,
        neutralCount: t.support.filter(
          (s) => s.stance === EvidenceStance.NEUTRAL,
        ).length,
        resolvedAt: t.resolvedAt,
        resolvedBy: t.resolvedBy,
        itemId: placed?.id ?? null,
        onBoard: placed?.onBoard ?? false,
        createdAt: t.createdAt,
      };
    });

    return {
      board: {
        id: board.id,
        caseId: board.caseId,
        version: board.version,
        readOnly: isReadOnlyCase(caseStatus),
        caseStatus,
      },
      items: items.map(toBoardItemDto),
      links: links.map(toBoardLinkDto),
      evidence,
      graph,
      supports,
      threads,
    };
  }

  // ─── Snapshots ────────────────────────────────────────────────────────────

  /**
   * Freeze the board as it is now. Taken automatically when a case closes, so
   * the arrangement a conclusion was drawn from survives later edits, and on
   * demand. Snapshots are immutable and never pruned (evidence preservation).
   */
  async takeSnapshot(
    caseId: string,
    reason: 'CASE_CLOSED' | 'MANUAL',
    actor?: string,
  ): Promise<CaseBoardSnapshotSummaryDto> {
    const payload = await this.getBoard(caseId);
    const snapshot = await this.prisma.$transaction(async (tx) => {
      const row = await tx.caseBoardSnapshot.create({
        data: {
          boardId: payload.board.id,
          reason,
          version: payload.board.version,
          payload: payload as unknown as Prisma.InputJsonValue,
          createdBy: actor ?? null,
        },
        select: {
          id: true,
          reason: true,
          version: true,
          createdBy: true,
          createdAt: true,
        },
      });
      await this.activity.record(
        caseId,
        CaseActivityType.BOARD_SNAPSHOT_TAKEN,
        { snapshotId: row.id, reason, version: row.version },
        actor,
        tx,
      );
      return row;
    });
    this.logger.log(
      `Board snapshot ${snapshot.id} taken for case ${caseId} (${reason}, v${snapshot.version})`,
    );
    return snapshot;
  }

  async listSnapshots(caseId: string): Promise<CaseBoardSnapshotSummaryDto[]> {
    await this.ensureCase(caseId);
    return this.prisma.caseBoardSnapshot.findMany({
      where: { board: { caseId } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reason: true,
        version: true,
        createdBy: true,
        createdAt: true,
      },
    });
  }

  async getSnapshot(
    caseId: string,
    snapshotId: string,
  ): Promise<CaseBoardSnapshotDto> {
    const row = await this.prisma.caseBoardSnapshot.findFirst({
      where: { id: snapshotId, board: { caseId } },
    });
    if (!row) {
      throw new NotFoundException(
        `Snapshot ${snapshotId} not found on case ${caseId}`,
      );
    }
    return {
      id: row.id,
      reason: row.reason,
      version: row.version,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      payload: row.payload as unknown as CaseBoardResponseDto,
    };
  }

  private async ensureCase(caseId: string): Promise<void> {
    const found = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${caseId} not found`);
  }
}

type EvidenceWithFindings = Prisma.CaseEvidenceGetPayload<{
  include: { findings: true };
}>;

function toEvidenceDto(r: EvidenceWithFindings): CaseEvidenceDto {
  return {
    id: r.id,
    entityType: r.entityType,
    entityId: r.entityId,
    note: r.note,
    addedBy: r.addedBy,
    createdAt: r.createdAt,
    entity: {
      id: r.entityId,
      label: r.label ?? r.entityId,
      assetType: r.assetType ?? undefined,
      sourceType: r.sourceType ?? undefined,
    },
    findings: r.findings.map((cf) => ({
      id: cf.id,
      caseEvidenceId: cf.caseEvidenceId,
      findingId: cf.findingId,
      findingLabel: cf.label,
      severity: cf.severity ?? undefined,
      detectorType: cf.detectorType ?? undefined,
      customDetectorName: cf.customDetectorName ?? null,
      matchedContent: cf.matchedContent ?? null,
      note: cf.note,
      createdAt: cf.createdAt,
    })),
  };
}

/**
 * Detach the children of items that are leaving the board (members of a
 * frame, comment pins anchored to a bubble), converting their positions from
 * parent-relative to absolute so nothing jumps.
 *
 * Soft-deleted children are converted too: no row may point at a parent that
 * is gone, or restoring the child later would place it relative to nothing.
 */
export async function unparentChildren(
  tx: Db,
  boardId: string,
  parentIds: string[],
): Promise<string[]> {
  if (parentIds.length === 0) return [];
  const rows = await tx.caseBoardItem.findMany({
    where: { boardId },
    select: { id: true, parentId: true, x: true, y: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const absolute = (
    id: string,
    seen = new Set<string>(),
  ): { x: number; y: number } => {
    const row = byId.get(id);
    if (!row || seen.has(id)) return { x: 0, y: 0 };
    seen.add(id);
    const own = { x: row.x ?? 0, y: row.y ?? 0 };
    if (!row.parentId) return own;
    const parent = absolute(row.parentId, seen);
    return { x: parent.x + own.x, y: parent.y + own.y };
  };
  const leaving = new Set(parentIds);
  const moved: string[] = [];
  for (const child of rows) {
    if (!child.parentId || !leaving.has(child.parentId)) continue;
    const pos = absolute(child.id);
    await tx.caseBoardItem.update({
      where: { id: child.id },
      data: {
        parentId: null,
        x: child.x === null ? null : pos.x,
        y: child.y === null ? null : pos.y,
      },
    });
    moved.push(child.id);
  }
  return moved;
}
