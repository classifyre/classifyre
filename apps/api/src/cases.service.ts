import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CaseActivityType, CaseThreadKind, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { GraphService } from './graph.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';
import {
  CaseActivityService,
  mergeDistinct,
  mergeListed,
} from './case-activity.service';
import { InquiryActivityService } from './inquiry-activity.service';
import { AUTO_PULL_ACTOR } from './cases/case-pull.port';
import { AgentMemoryService } from './autopilot/memory/agent-memory.service';
// Value import, not `import type`: Nest resolves @Optional() injections from
// emitted metadata, and a type-only import silently injects undefined.
import { CaseBoardReadService } from './case-board/case-board-read.service';
// Value imports for the same reason: both are @Optional() injections.
import {
  CaseCleanupService,
  type FilterSummary,
} from './cases/case-cleanup.service';
import { toFilterDto } from './cases/case-finding-filters.service';
import {
  CaseEscalationService,
  candidateOf,
} from './cases/case-escalation.service';
import {
  anyRule,
  CLEANUP_RULE_KEYS,
  newlyEnabled,
  type CleanupRules,
} from './cases/case-cleanup.rules';
import {
  AddEvidenceDto,
  AddFindingDto,
  AttachFindingsDto,
  AttachFindingsResponseDto,
  CaseEvidenceDto,
  CaseFindingDto,
  CaseLinkedInquiryDto,
  CaseListResponseDto,
  CaseResponseDto,
  CloseCaseDto,
  CloseCaseResponseDto,
  CreateCaseDto,
  LinkInquiriesDto,
  PullFromInquiryDto,
  PullFromInquiryResponseDto,
  QueryCasesDto,
  UpdateCaseDto,
  UpdateCaseFindingNoteDto,
  UpdateEvidenceNoteDto,
} from './dto/case.dto';
import { GraphResponseDto } from './dto/graph.dto';

type CaseRow = Prisma.CaseGetPayload<{
  include: {
    _count: {
      select: {
        evidence: true;
        threads: { where: { kind: 'HYPOTHESIS' } };
        inquiryLinks: true;
        findings: { where: { escalatedAt: { not: null } } };
      };
    };
  };
}>;
type EvidenceRow = Prisma.CaseEvidenceGetPayload<{
  include: { findings: true };
}>;

/** No global ValidationPipe: a form or MCP "true" arrives as text. */
function flag(value: unknown): boolean {
  return value === true || value === 'true';
}

/** Findings a pull names on its timeline entry; `pulled` counts the rest. */
const PULL_LIST_CAP = 50;
/** Matched values are clipped on the timeline. */
const VALUE_MAX = 160;

function clipValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > VALUE_MAX ? `${value.slice(0, VALUE_MAX)}…` : value;
}

function numberOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** The case fields a PATCH edits, as the timeline compares them. */
type CaseEditable = {
  title: string;
  description: string | null;
  status: string;
  severity: string;
  assignee: string | null;
  conclusion: string | null;
  aiMode: string | null;
};

/** The case's description of itself: edits to these fold into one entry. */
const DETAIL_FIELDS = [
  'title',
  'description',
  'severity',
  'assignee',
] as const satisfies ReadonlyArray<keyof CaseEditable>;

/** What the autopilot's entity map of a case says (AgentMemoryService.syncEntityMap). */
const ENTITY_MAP_FIELDS = [
  'title',
  'description',
  'status',
  'severity',
] as const satisfies ReadonlyArray<keyof CaseEditable>;

// Hypotheses are CaseThreads of kind HYPOTHESIS; count those for the DTO.
const countSelect = {
  _count: {
    select: {
      evidence: true,
      threads: { where: { kind: CaseThreadKind.HYPOTHESIS } },
      inquiryLinks: true,
      // Escalated findings: the case list flags a case that holds any.
      findings: { where: { escalatedAt: { not: null } } },
    },
  },
} satisfies Prisma.CaseInclude;

/** The investigation workspace: owns evidence, findings, hypotheses (via services) and the graph. */
@Injectable()
export class CasesService {
  private readonly logger = new Logger(CasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly matching: InquiryMatchingService,
    private readonly activity: CaseActivityService,
    private readonly inquiryActivity: InquiryActivityService,
    private readonly agentMemory: AgentMemoryService,
    @Optional() private readonly boardRead?: CaseBoardReadService,
    @Optional() private readonly cleanup?: CaseCleanupService,
    @Optional() private readonly escalation?: CaseEscalationService,
  ) {}

  async create(dto: CreateCaseDto): Promise<CaseResponseDto> {
    const inquiryIds = [...new Set(dto.inquiryIds ?? [])];
    let inquiries: Array<{ id: string; title: string }> = [];
    if (inquiryIds.length > 0) {
      inquiries = await this.prisma.inquiry.findMany({
        where: { id: { in: inquiryIds } },
        select: { id: true, title: true },
      });
      if (inquiries.length !== inquiryIds.length) {
        throw new BadRequestException('One or more inquiries do not exist.');
      }
    }
    const rules: CleanupRules = {
      removeGoneFindings: flag(dto.removeGoneFindings),
      removeResolvedFindings: flag(dto.removeResolvedFindings),
      removeGoneAssets: flag(dto.removeGoneAssets),
    };
    const created = await this.prisma.case.create({
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        severity: dto.severity,
        assignee: dto.assignee,
        createdBy: dto.createdBy,
        ...rules,
      },
      include: countSelect,
    });
    await this.activity.record(
      created.id,
      CaseActivityType.CASE_CREATED,
      { title: dto.title },
      dto.createdBy,
    );
    // Said once at the start, so the timeline explains every later removal.
    if (anyRule(rules)) {
      await this.activity.record(
        created.id,
        CaseActivityType.CLEANUP_SETTINGS_UPDATED,
        {
          changes: CLEANUP_RULE_KEYS.filter((key) => rules[key]).map(
            (rule) => ({ rule, enabled: true }),
          ),
          rules,
        },
        dto.createdBy,
      );
    }
    if (inquiryIds.length > 0) {
      const autoPullIds = new Set(dto.autoPullInquiryIds ?? []);
      await this.prisma.caseInquiry.createMany({
        data: inquiryIds.map((inquiryId) => ({
          caseId: created.id,
          inquiryId,
          autoPull: autoPullIds.has(inquiryId),
        })),
        skipDuplicates: true,
      });
      for (const q of inquiries) {
        await this.activity.record(
          created.id,
          CaseActivityType.INQUIRY_LINKED,
          {
            inquiryId: q.id,
            inquiryTitle: q.title,
            autoPull: autoPullIds.has(q.id),
          },
          dto.createdBy,
        );
      }
      await this.syncEntityMaps(created.id, inquiryIds);
      return (await this.findOne(created.id))!;
    }
    await this.syncEntityMaps(created.id);
    return this.mapCase(created);
  }

  /** Link additional inquiries to a case. Already-linked ones are ignored. */
  async linkInquiries(
    caseId: string,
    dto: LinkInquiriesDto,
    actor?: string,
  ): Promise<CaseResponseDto> {
    await this.ensureExists(caseId);
    const inquiryIds = [...new Set(dto.inquiryIds ?? [])];
    if (inquiryIds.length === 0) return (await this.findOne(caseId))!;
    const inquiries = await this.prisma.inquiry.findMany({
      where: { id: { in: inquiryIds } },
      select: { id: true, title: true },
    });
    if (inquiries.length !== inquiryIds.length) {
      throw new BadRequestException('One or more inquiries do not exist.');
    }
    const existing = await this.prisma.caseInquiry.findMany({
      where: { caseId, inquiryId: { in: inquiryIds } },
      select: { inquiryId: true },
    });
    const existingIds = new Set(existing.map((l) => l.inquiryId));
    const autoPullIds = new Set(dto.autoPullInquiryIds ?? []);
    await this.prisma.caseInquiry.createMany({
      data: inquiryIds.map((inquiryId) => ({
        caseId,
        inquiryId,
        autoPull: autoPullIds.has(inquiryId),
      })),
      skipDuplicates: true,
    });
    for (const q of inquiries) {
      if (existingIds.has(q.id)) continue;
      await this.activity.record(
        caseId,
        CaseActivityType.INQUIRY_LINKED,
        {
          inquiryId: q.id,
          inquiryTitle: q.title,
          autoPull: autoPullIds.has(q.id),
        },
        actor,
      );
      await this.inquiryActivity.tryRecord(q.id, 'CASE_LINKED', {
        caseId,
        autoPull: autoPullIds.has(q.id),
      });
    }
    await this.syncEntityMaps(caseId, inquiryIds);
    return (await this.findOne(caseId))!;
  }

  /**
   * Turn automatic pulling on or off for one linked inquiry.
   *
   * Per link rather than per inquiry: the same standing question can drive
   * several cases, and only one of them may want its answers to arrive by
   * themselves.
   */
  async setInquiryAutoPull(
    caseId: string,
    inquiryId: string,
    autoPull: boolean,
    actor?: string,
  ): Promise<CaseResponseDto> {
    await this.ensureExists(caseId);
    const link = await this.prisma.caseInquiry.findUnique({
      where: { caseId_inquiryId: { caseId, inquiryId } },
      select: {
        id: true,
        autoPull: true,
        inquiry: { select: { title: true } },
      },
    });
    if (!link) {
      throw new NotFoundException(
        `Inquiry ${inquiryId} is not linked to case ${caseId}`,
      );
    }
    // Setting it to what it already is changes nothing, so it says nothing.
    if (link.autoPull === autoPull) return (await this.findOne(caseId))!;
    await this.prisma.caseInquiry.update({
      where: { id: link.id },
      data: { autoPull },
    });
    await this.activity.record(
      caseId,
      CaseActivityType.INQUIRY_SETTINGS_UPDATED,
      {
        inquiryId,
        inquiryTitle: link.inquiry.title,
        changes: [{ setting: 'autoPull', from: link.autoPull, to: autoPull }],
      },
      actor,
    );
    return (await this.findOne(caseId))!;
  }

  /** Unlink an inquiry from a case. The inquiry itself is untouched. */
  async unlinkInquiry(
    caseId: string,
    inquiryId: string,
    actor?: string,
  ): Promise<CaseResponseDto> {
    await this.ensureExists(caseId);
    const link = await this.prisma.caseInquiry.findUnique({
      where: { caseId_inquiryId: { caseId, inquiryId } },
      include: { inquiry: { select: { title: true } } },
    });
    if (!link)
      throw new NotFoundException(
        `Inquiry ${inquiryId} is not linked to case ${caseId}`,
      );
    // The watch's own filters leave with the link (ON DELETE CASCADE).
    const filtersDropped = await this.prisma.caseFindingFilter.count({
      where: { caseInquiryId: link.id },
    });
    await this.prisma.caseInquiry.delete({ where: { id: link.id } });
    await this.activity.record(
      caseId,
      CaseActivityType.INQUIRY_UNLINKED,
      {
        inquiryId,
        inquiryTitle: link.inquiry.title,
        ...(filtersDropped > 0 ? { filtersDropped } : {}),
      },
      actor,
    );
    await this.inquiryActivity.tryRecord(inquiryId, 'CASE_UNLINKED', {
      caseId,
    });
    await this.syncEntityMaps(caseId, [inquiryId]);
    return (await this.findOne(caseId))!;
  }

  /** Close the case with a conclusion and archive its linked inquiries (unless `keepInquiries`). */
  async close(id: string, dto: CloseCaseDto): Promise<CloseCaseResponseDto> {
    await this.ensureExists(id);
    const conclusion = (dto.conclusion ?? '').trim();
    if (conclusion.length === 0) {
      throw new BadRequestException(
        'A conclusion is required to close a case.',
      );
    }
    await this.prisma.case.update({
      where: { id },
      data: { status: 'CLOSED', conclusion },
    });
    // Archive linked inquiries — but only those not driving another open case,
    // and not at all when the caller keeps them: an answered case can have
    // standing checks behind it (GENESIS field report P14).
    // No global ValidationPipe: a query-string or form "true" arrives as text.
    const keepInquiries =
      (dto.keepInquiries as unknown) === true ||
      (dto.keepInquiries as unknown) === 'true';
    const linked = keepInquiries
      ? []
      : await this.prisma.inquiry.findMany({
          where: { status: 'ACTIVE', caseLinks: { some: { caseId: id } } },
          select: {
            id: true,
            caseLinks: {
              select: { case: { select: { id: true, status: true } } },
            },
          },
        });
    const archivable = linked
      .filter((q) =>
        q.caseLinks.every(
          (l) =>
            l.case.id === id ||
            l.case.status === 'CLOSED' ||
            l.case.status === 'ARCHIVED',
        ),
      )
      .map((q) => q.id);
    const archived =
      archivable.length > 0
        ? await this.prisma.inquiry.updateMany({
            where: { id: { in: archivable } },
            data: { status: 'ARCHIVED' },
          })
        : { count: 0 };
    const linkedInquiryIds = await this.prisma.caseInquiry.findMany({
      where: { caseId: id },
      select: { inquiryId: true },
    });
    await this.activity.record(
      id,
      CaseActivityType.CONCLUSION_UPDATED,
      { closed: true, archivedInquiries: archived.count },
      dto.closedBy,
    );
    await this.syncEntityMaps(
      id,
      linkedInquiryIds.map((link) => link.inquiryId),
    );
    await this.snapshotBoardOnClose(id, dto.closedBy);
    return {
      case: (await this.findOne(id))!,
      archivedInquiries: archived.count,
    };
  }

  /**
   * Freeze the case board as it stood when the case closed, so the
   * arrangement a conclusion was drawn from survives later edits (evidence
   * preservation). A failed snapshot is logged, never allowed to undo the
   * close: an unclosable case is the worse outcome.
   */
  private async snapshotBoardOnClose(
    caseId: string,
    actor?: string,
  ): Promise<void> {
    if (!this.boardRead) return;
    try {
      await this.boardRead.takeSnapshot(caseId, 'CASE_CLOSED', actor);
    } catch (error) {
      this.logger.warn(
        `Board snapshot on close failed for case ${caseId}: ${String(error)}`,
      );
    }
  }

  /**
   * Reopen a closed/archived case and reactivate the inquiries that were
   * archived alongside it, so monitoring resumes. Symmetric with close().
   */
  async reopen(
    id: string,
    dto: { note?: string; reopenedBy?: string },
  ): Promise<{ case: CaseResponseDto; reactivatedInquiries: number }> {
    await this.ensureExists(id);
    await this.prisma.case.update({
      where: { id },
      data: { status: 'OPEN' },
    });
    // Bring back the inquiries that were archived when this case closed.
    const reactivated = await this.prisma.inquiry.updateMany({
      where: { status: 'ARCHIVED', caseLinks: { some: { caseId: id } } },
      data: { status: 'ACTIVE' },
    });
    const linkedInquiryIds = await this.prisma.caseInquiry.findMany({
      where: { caseId: id },
      select: { inquiryId: true },
    });
    await this.activity.record(
      id,
      CaseActivityType.CASE_UPDATED,
      {
        reopened: true,
        reactivatedInquiries: reactivated.count,
        note: dto.note,
      },
      dto.reopenedBy,
    );
    await this.syncEntityMaps(
      id,
      linkedInquiryIds.map((link) => link.inquiryId),
    );
    return {
      case: (await this.findOne(id))!,
      reactivatedInquiries: reactivated.count,
    };
  }

  async list(query: QueryCasesDto): Promise<CaseListResponseDto> {
    const skip = Math.max(0, Number(query.skip ?? 0) || 0);
    const limit = Math.min(Math.max(1, Number(query.limit ?? 50) || 50), 200);

    const where: Prisma.CaseWhereInput = {};
    const statusFilter = this.toArray(query.status);
    const severityFilter = this.toArray(query.severity);
    if (statusFilter.length > 0) where.status = { in: statusFilter };
    if (severityFilter.length > 0) where.severity = { in: severityFilter };
    if (flag(query.escalated)) {
      where.findings = { some: { escalatedAt: { not: null } } };
    }
    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.case.findMany({
        where,
        include: countSelect,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.case.count({ where }),
    ]);
    return { items: rows.map((r) => this.mapCase(r)), total, skip, limit };
  }

  async findOne(id: string): Promise<CaseResponseDto | null> {
    const row = await this.prisma.case.findUnique({
      where: { id },
      include: {
        ...countSelect,
        evidence: {
          orderBy: { createdAt: 'asc' },
          include: { findings: true },
        },
        inquiryLinks: {
          orderBy: { createdAt: 'asc' },
          include: { inquiry: true },
        },
        findingFilters: {
          orderBy: { createdAt: 'asc' },
          include: {
            watch: {
              select: {
                inquiryId: true,
                inquiry: { select: { title: true } },
              },
            },
          },
        },
      },
    });
    if (!row) return null;
    const evidence = this.hydrateEvidence(row.evidence);
    const inquiries: CaseLinkedInquiryDto[] = row.inquiryLinks.map((l) => ({
      id: l.inquiry.id,
      title: l.inquiry.title,
      status: l.inquiry.status,
      matchCount: l.inquiry.matchCount,
      newMatchCount: l.inquiry.newMatchCount,
      goneMatchCount: l.inquiry.goneMatchCount,
      autoPull: l.autoPull,
    }));
    return {
      ...this.mapCase(row),
      evidence,
      inquiries,
      findingFilters: row.findingFilters.map(toFilterDto),
    };
  }

  async update(
    id: string,
    dto: UpdateCaseDto,
    actor?: string,
  ): Promise<CaseResponseDto> {
    const before = await this.prisma.case.findUnique({
      where: { id },
      select: {
        title: true,
        description: true,
        status: true,
        severity: true,
        assignee: true,
        conclusion: true,
        aiMode: true,
        removeGoneFindings: true,
        removeResolvedFindings: true,
        removeGoneAssets: true,
      },
    });
    if (!before) throw new NotFoundException(`Case with ID ${id} not found`);
    const rules: CleanupRules = {
      removeGoneFindings:
        dto.removeGoneFindings === undefined
          ? before.removeGoneFindings
          : flag(dto.removeGoneFindings),
      removeResolvedFindings:
        dto.removeResolvedFindings === undefined
          ? before.removeResolvedFindings
          : flag(dto.removeResolvedFindings),
      removeGoneAssets:
        dto.removeGoneAssets === undefined
          ? before.removeGoneAssets
          : flag(dto.removeGoneAssets),
    };
    const updated = await this.prisma.case.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        status: dto.status,
        severity: dto.severity,
        assignee: dto.assignee,
        conclusion: dto.conclusion,
        aiMode: dto.aiMode,
        ...rules,
      },
      include: countSelect,
    });
    await this.recordCaseEdits(id, before, updated, actor);
    const changes = CLEANUP_RULE_KEYS.filter(
      (key) => rules[key] !== before[key],
    ).map((rule) => ({ rule, enabled: rules[rule] }));
    if (changes.length > 0) {
      await this.activity.record(
        id,
        CaseActivityType.CLEANUP_SETTINGS_UPDATED,
        { changes, rules },
        actor,
      );
    }
    // The autopilot's map of the case names its title, description, status
    // and severity; an autosaved assignee or conclusion leaves it as it is.
    if (
      ENTITY_MAP_FIELDS.some(
        (key) => (before[key] ?? '') !== (updated[key] ?? ''),
      )
    ) {
      await this.syncEntityMaps(id);
    }
    // A switch turned on applies at once — what "remove resolved findings"
    // promises includes the ones resolved last week.
    const enabledNow = newlyEnabled(before, rules);
    if (anyRule(enabledNow) && this.cleanup) {
      const outcome = await this.cleanup.applyRules(id, {
        trigger: 'RULE_ENABLED',
        actor,
        enabledNow,
      });
      const fresh = await this.prisma.case.findUniqueOrThrow({
        where: { id },
        include: countSelect,
      });
      return {
        ...this.mapCase(fresh),
        cleanup: {
          findingsRemoved: outcome.findingsRemoved,
          evidenceRemoved: outcome.evidenceRemoved,
          findingsWithEvidence: outcome.findingsWithEvidence,
        },
      };
    }
    return this.mapCase(updated);
  }

  /**
   * What a PATCH changed, on the timeline. The case file saves as someone
   * types and may send a field back unchanged, so only real changes count.
   * Edits to the case's description of itself (title, description, severity,
   * assignee) and to the conclusion draft fold into one entry per stretch of
   * editing; a status or Autopilot-mode change is a decision, its own entry.
   */
  private async recordCaseEdits(
    id: string,
    before: CaseEditable,
    after: CaseEditable,
    actor: string | undefined,
  ): Promise<void> {
    const changed = (key: keyof CaseEditable) =>
      (before[key] ?? '') !== (after[key] ?? '');
    const edited = DETAIL_FIELDS.filter(changed);
    if (edited.length > 0) {
      await this.activity.recordEdit(
        id,
        CaseActivityType.CASE_UPDATED,
        {
          fields: edited,
          title: after.title,
          severity: after.severity,
          ...(edited.includes('title') ? { previousTitle: before.title } : {}),
        },
        actor,
        'details',
        (previous, next) => ({
          ...next,
          fields: [
            ...new Set([
              ...(Array.isArray(previous.fields) ? previous.fields : []),
              ...(Array.isArray(next.fields) ? next.fields : []),
            ]),
          ],
          // The title the stretch of editing started from.
          ...(previous.previousTitle !== undefined
            ? { previousTitle: previous.previousTitle }
            : {}),
        }),
      );
    }
    if (changed('status')) {
      await this.activity.record(
        id,
        CaseActivityType.CASE_UPDATED,
        { status: after.status, previousStatus: before.status },
        actor,
      );
    }
    if (changed('aiMode')) {
      await this.activity.record(
        id,
        CaseActivityType.CASE_UPDATED,
        { aiMode: after.aiMode, previousAiMode: before.aiMode },
        actor,
      );
    }
    if (changed('conclusion')) {
      await this.activity.recordEdit(
        id,
        CaseActivityType.CONCLUSION_UPDATED,
        { draft: true, length: (after.conclusion ?? '').length },
        actor,
        'conclusion',
        (_previous, next) => next,
      );
    }
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.case.findUnique({
      where: { id },
      select: { title: true },
    });
    if (!existing) throw new NotFoundException(`Case with ID ${id} not found`);
    await this.prisma.case.delete({ where: { id } });
    // Keep the autopilot's memory consistent: drop memories referencing the
    // dead case and remember that the operator deleted it on purpose.
    await this.agentMemory.recordEntityDeletion('case', id, existing.title);
  }

  /** Keep case and linked-inquiry maps coherent after a relationship change. */
  private async syncEntityMaps(
    caseId: string,
    inquiryIds: string[] = [],
  ): Promise<void> {
    await this.agentMemory.syncEntityMap('case', caseId);
    await Promise.all(
      [...new Set(inquiryIds)].map((inquiryId) =>
        this.agentMemory.syncEntityMap('inquiry', inquiryId),
      ),
    );
  }

  /**
   * Put an asset on the case as evidence.
   *
   * With `tx` the whole write joins the caller's transaction (the case board
   * applies a batch of ops atomically). The inferred-edge refresh is then left
   * to the caller: it writes `edges` through the pool, and holding the
   * transaction's connection while waiting for a second one is how a small
   * pool deadlocks. The board reads the graph through `caseGraph`, which
   * refreshes those edges anyway.
   */
  async addEvidence(
    caseId: string,
    dto: AddEvidenceDto,
    tx?: Prisma.TransactionClient,
  ): Promise<CaseEvidenceDto> {
    const db = tx ?? this.prisma;
    await this.ensureExists(caseId, db);
    if (dto.entityType !== 'asset') {
      throw new BadRequestException(
        'Evidence must be an asset. Use POST /cases/:id/evidence/:evidenceId/findings to attach findings.',
      );
    }
    const asset = await db.asset.findUnique({
      where: { id: dto.entityId },
      select: { name: true, assetType: true, sourceType: true },
    });
    const snapshot = {
      label: asset?.name ?? null,
      assetType: asset?.assetType ?? null,
      sourceType: asset ? String(asset.sourceType) : null,
    };
    const evidence = await db.caseEvidence.upsert({
      where: {
        caseId_entityType_entityId: {
          caseId,
          entityType: 'asset',
          entityId: dto.entityId,
        },
      },
      create: {
        caseId,
        entityType: 'asset',
        entityId: dto.entityId,
        note: dto.note,
        addedBy: dto.addedBy,
        ...snapshot,
      },
      update: { note: dto.note ?? undefined, ...snapshot },
      include: { findings: true },
    });
    if (!tx) await this.graph.inferEdgesForAsset(dto.entityId);
    await this.activity.record(
      caseId,
      CaseActivityType.EVIDENCE_ADDED,
      {
        evidenceId: evidence.id,
        entityId: dto.entityId,
        label: snapshot.label,
      },
      dto.addedBy,
      tx,
    );

    const updated = await db.caseEvidence.findUniqueOrThrow({
      where: { id: evidence.id },
      include: { findings: true },
    });
    return this.hydrateEvidence([updated])[0];
  }

  async addFinding(
    caseId: string,
    evidenceId: string,
    dto: AddFindingDto,
  ): Promise<CaseFindingDto> {
    await this.ensureExists(caseId);
    const evidence = await this.prisma.caseEvidence.findUnique({
      where: { id: evidenceId },
    });
    if (!evidence || evidence.caseId !== caseId) {
      throw new NotFoundException(
        `Evidence ${evidenceId} not found in case ${caseId}`,
      );
    }
    const finding = await this.prisma.finding.findUnique({
      where: { id: dto.findingId },
      select: {
        assetId: true,
        findingType: true,
        severity: true,
        detectorType: true,
        customDetectorName: true,
        matchedContent: true,
        asset: { select: { name: true, assetType: true, sourceType: true } },
      },
    });
    if (!finding)
      throw new NotFoundException(`Finding ${dto.findingId} not found`);

    const assetEv = await this.ensureAssetEvidence(
      caseId,
      finding.assetId,
      finding.asset,
    );
    const held = await this.heldFindingIds(this.prisma, caseId, [
      dto.findingId,
    ]);
    const cf = await this.prisma.caseFinding.upsert({
      where: { caseId_findingId: { caseId, findingId: dto.findingId } },
      create: {
        caseId,
        caseEvidenceId: assetEv,
        findingId: dto.findingId,
        label: finding.findingType,
        severity: String(finding.severity),
        detectorType: String(finding.detectorType),
        customDetectorName: finding.customDetectorName ?? null,
        matchedContent: finding.matchedContent,
        note: dto.note,
      },
      update: { note: dto.note ?? undefined },
    });
    await this.graph.inferEdgesForAsset(finding.assetId);
    await this.activity.record(caseId, CaseActivityType.FINDING_ADDED, {
      caseFindingId: cf.id,
      findingId: dto.findingId,
      label: finding.findingType,
    });
    if (!held.has(dto.findingId)) {
      await this.escalateArrived(this.prisma, caseId, null, [dto.findingId], {
        trigger: 'ATTACHED',
        actor: undefined,
      });
    }
    return this.mapCaseFinding(cf);
  }

  /**
   * Batch-attach findings; asset evidence rows are created automatically.
   * `tx` joins the caller's transaction (see {@link addEvidence}).
   */
  async attachFindings(
    caseId: string,
    dto: AttachFindingsDto,
    tx?: Prisma.TransactionClient,
  ): Promise<AttachFindingsResponseDto> {
    const db = tx ?? this.prisma;
    await this.ensureExists(caseId, db);
    const findingIds = [...new Set(dto.findingIds ?? [])];
    if (findingIds.length === 0) return { attached: 0 };

    const findings = await db.finding.findMany({
      where: { id: { in: findingIds } },
      select: {
        id: true,
        assetId: true,
        findingType: true,
        severity: true,
        detectorType: true,
        customDetectorName: true,
        matchedContent: true,
        asset: { select: { name: true, assetType: true, sourceType: true } },
      },
    });
    if (findings.length === 0) return { attached: 0 };
    const held = await this.heldFindingIds(
      db,
      caseId,
      findings.map((f) => f.id),
    );

    const evidenceByAsset = new Map<string, string>();
    for (const f of findings) {
      if (!evidenceByAsset.has(f.assetId)) {
        evidenceByAsset.set(
          f.assetId,
          await this.ensureAssetEvidence(
            caseId,
            f.assetId,
            f.asset,
            dto.addedBy,
            db,
          ),
        );
      }
    }
    const created = await db.caseFinding.createMany({
      data: findings.map((f) => ({
        caseId,
        caseEvidenceId: evidenceByAsset.get(f.assetId)!,
        findingId: f.id,
        label: f.findingType,
        severity: String(f.severity),
        detectorType: String(f.detectorType),
        customDetectorName: f.customDetectorName ?? null,
        matchedContent: f.matchedContent,
      })),
      skipDuplicates: true,
    });
    if (!tx) {
      for (const assetId of evidenceByAsset.keys())
        await this.graph.inferEdgesForAsset(assetId);
    }
    await this.activity.record(
      caseId,
      CaseActivityType.FINDING_ADDED,
      {
        count: created.count,
        label: `${created.count} finding${created.count === 1 ? '' : 's'} attached`,
        findingLabels: findings.slice(0, 10).map((f) => f.findingType),
        assetLabels: [
          ...new Set(findings.map((f) => f.asset?.name).filter(Boolean)),
        ].slice(0, 10),
      },
      dto.addedBy,
      tx,
    );
    // A case-wide escalation rule holds however a finding came in.
    await this.escalateArrived(
      db,
      caseId,
      null,
      findings.filter((f) => !held.has(f.id)).map((f) => f.id),
      { trigger: 'ATTACHED', actor: dto.addedBy },
    );
    return { attached: created.count };
  }

  async removeFinding(
    caseId: string,
    caseFindingId: string,
    actor?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const cf = await db.caseFinding.findUnique({
      where: { id: caseFindingId },
    });
    if (!cf || cf.caseId !== caseId) {
      throw new NotFoundException(
        `Finding ${caseFindingId} not found in case ${caseId}`,
      );
    }
    await db.caseFinding.delete({ where: { id: caseFindingId } });
    await this.activity.record(
      caseId,
      CaseActivityType.FINDING_REMOVED,
      {
        caseFindingId,
        findingId: cf.findingId,
        label: cf.label,
      },
      actor,
      tx,
    );
  }

  async patchEvidenceNote(
    caseId: string,
    evidenceId: string,
    dto: UpdateEvidenceNoteDto,
  ): Promise<CaseEvidenceDto> {
    const evidence = await this.prisma.caseEvidence.findUnique({
      where: { id: evidenceId },
    });
    if (!evidence || evidence.caseId !== caseId) {
      throw new NotFoundException(
        `Evidence ${evidenceId} not found in case ${caseId}`,
      );
    }
    const updated = await this.prisma.caseEvidence.update({
      where: { id: evidenceId },
      data: { note: dto.note ?? null },
      include: { findings: true },
    });
    await this.activity.record(caseId, CaseActivityType.EVIDENCE_NOTE_UPDATED, {
      evidenceId,
      label: updated.label ?? updated.entityId,
      note: (dto.note ?? '').slice(0, 300) || null,
    });
    return this.hydrateEvidence([updated])[0];
  }

  async patchFindingNote(
    caseId: string,
    caseFindingId: string,
    dto: UpdateCaseFindingNoteDto,
  ): Promise<CaseFindingDto> {
    const cf = await this.prisma.caseFinding.findUnique({
      where: { id: caseFindingId },
    });
    if (!cf || cf.caseId !== caseId) {
      throw new NotFoundException(
        `Finding ${caseFindingId} not found in case ${caseId}`,
      );
    }
    const updated = await this.prisma.caseFinding.update({
      where: { id: caseFindingId },
      data: { note: dto.note ?? null },
    });
    await this.activity.record(caseId, CaseActivityType.FINDING_NOTE_UPDATED, {
      caseFindingId,
      label: updated.label,
      note: (dto.note ?? '').slice(0, 300) || null,
    });
    return this.mapCaseFinding(updated);
  }

  async removeEvidence(
    caseId: string,
    evidenceId: string,
    actor?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const evidence = await db.caseEvidence.findUnique({
      where: { id: evidenceId },
    });
    if (!evidence || evidence.caseId !== caseId) {
      throw new NotFoundException(
        `Evidence ${evidenceId} not found in case ${caseId}`,
      );
    }
    await db.caseEvidence.delete({ where: { id: evidenceId } });
    await this.activity.record(
      caseId,
      CaseActivityType.EVIDENCE_REMOVED,
      {
        evidenceId,
        entityId: evidence.entityId,
        label: evidence.label,
      },
      actor,
      tx,
    );
  }

  /** Pull a linked question's current matches into the case as evidence + findings. */
  async pullFromInquiry(
    caseId: string,
    dto: PullFromInquiryDto,
    actor?: string,
    run?: {
      sourceId?: string | null;
      runnerId?: string | null;
      available?: number;
      /**
       * Only the answers that meet an escalation rule: the watch's auto-add is
       * off, but an escalation brings its matches in anyway.
       */
      onlyEscalating?: boolean;
    },
  ): Promise<PullFromInquiryResponseDto> {
    await this.ensureExists(caseId);
    const inquiry = await this.prisma.inquiry.findUnique({
      where: { id: dto.inquiryId },
      select: { id: true, title: true },
    });
    if (!inquiry)
      throw new NotFoundException(`Inquiry ${dto.inquiryId} not found`);

    const automatic = actor === AUTO_PULL_ACTOR;
    // Matches a person picked one by one are their choice; "everything" and
    // what a watch adds by itself go through the case's filters.
    const picked = (dto.findingIds?.length ?? 0) > 0 && !automatic;
    let findingIds = dto.findingIds;
    if (!findingIds || findingIds.length === 0) {
      findingIds = await this.matching.getMatchingFindingIds(dto.inquiryId);
    }
    if (findingIds.length === 0) return { pulled: 0 };

    const matches = await this.prisma.finding.findMany({
      where: { id: { in: findingIds } },
      select: {
        id: true,
        assetId: true,
        findingType: true,
        severity: true,
        detectorType: true,
        customDetectorName: true,
        matchedContent: true,
        asset: { select: { name: true, assetType: true, sourceType: true } },
      },
    });
    if (matches.length === 0) return { pulled: 0 };

    let findings = matches;
    const kept: Array<{ findingType: string; filter: FilterSummary }> = [];
    if (!picked && this.cleanup) {
      const gate = await this.cleanup.pullGate(caseId, dto.inquiryId);
      findings = matches.filter((f) => {
        const filter = gate(f);
        if (filter) kept.push({ findingType: f.findingType, filter });
        return !filter;
      });
    }
    if (run?.onlyEscalating) {
      // Filters still win: a finding someone filtered out never comes in.
      const escalates = this.escalation
        ? await this.escalation.gate(caseId, dto.inquiryId)
        : () => null;
      findings = findings.filter((f) => escalates(f) !== null);
      if (findings.length === 0) return { pulled: 0 };
    }
    if (findings.length === 0 && kept.length === 0) return { pulled: 0 };
    // Which of them the case does not hold yet: those are what the timeline
    // names as added (createMany skips the rest silently).
    const held = await this.heldFindingIds(
      this.prisma,
      caseId,
      findings.map((f) => f.id),
    );

    // One evidence row per asset, then the finding rows.
    const evidenceByAsset = new Map<string, string>();
    for (const f of findings) {
      if (!evidenceByAsset.has(f.assetId)) {
        evidenceByAsset.set(
          f.assetId,
          await this.ensureAssetEvidence(caseId, f.assetId, f.asset),
        );
      }
    }
    const created = await this.prisma.caseFinding.createMany({
      data: findings.map((f) => ({
        caseId,
        caseEvidenceId: evidenceByAsset.get(f.assetId)!,
        findingId: f.id,
        label: f.findingType,
        severity: String(f.severity),
        detectorType: String(f.detectorType),
        customDetectorName: f.customDetectorName ?? null,
        matchedContent: f.matchedContent,
      })),
      skipDuplicates: true,
    });
    for (const assetId of evidenceByAsset.keys())
      await this.graph.inferEdgesForAsset(assetId);
    const added = findings.filter((f) => !held.has(f.id));
    // An escalation-only pull is told by its escalation entry alone: it
    // happened because they escalate, which that entry says.
    if (!run?.onlyEscalating) {
      await this.recordPull(caseId, {
        inquiry,
        added,
        pulled: created.count,
        kept,
        evidenceByAsset,
        automatic,
        actor,
        run,
      });
    }
    await this.escalateArrived(
      this.prisma,
      caseId,
      inquiry,
      added.map((f) => f.id),
      {
        trigger: 'ARRIVAL',
        actor,
        added: run?.onlyEscalating === true,
        run,
      },
    );
    // The same event on the other timeline — but only for a deliberate pull.
    // An automatic one is recorded by the matching pass instead, as AUTO_PULLED
    // and with the run that caused it, so a person reading the inquiry can tell
    // which of its answers walked into a case by themselves.
    if (!automatic) {
      await this.inquiryActivity.tryRecord(dto.inquiryId, 'PULLED_TO_CASE', {
        caseId,
        pulled: created.count,
        ...(kept.length > 0 ? { filtered: kept.length } : {}),
      });
    }
    return {
      pulled: created.count,
      ...(kept.length > 0 ? { filtered: kept.length } : {}),
    };
  }

  /**
   * The timeline entry for a pull: which findings came in (named, capped),
   * what the filters kept out, and for a watch's own auto-add which scan
   * brought them. An automatic pull folds into the watch's previous auto-add
   * entry (CaseActivityService.recordCoalesced): a source that scans every few
   * minutes reads as one growing entry, not one per scan. A pull that changed
   * nothing writes nothing.
   */
  private async recordPull(
    caseId: string,
    pull: {
      inquiry: { id: string; title: string };
      added: Array<{
        id: string;
        assetId: string;
        findingType: string;
        severity: { toString(): string };
        matchedContent: string | null;
        asset: { name: string } | null;
      }>;
      pulled: number;
      kept: Array<{ findingType: string; filter: FilterSummary }>;
      evidenceByAsset: Map<string, string>;
      automatic: boolean;
      actor?: string;
      run?: {
        sourceId?: string | null;
        runnerId?: string | null;
        available?: number;
      };
    },
  ): Promise<void> {
    if (pull.pulled === 0 && pull.kept.length === 0) return;
    const listed = pull.added.slice(0, PULL_LIST_CAP);
    const items = await this.boardItemsFor(caseId, [
      ...new Set(
        listed
          .map((f) => pull.evidenceByAsset.get(f.assetId))
          .filter((id): id is string => !!id),
      ),
    ]);
    const sourceId = pull.run?.sourceId ?? null;
    const source = sourceId
      ? await this.prisma.source.findUnique({
          where: { id: sourceId },
          select: { name: true },
        })
      : null;
    const filters = new Map(pull.kept.map((k) => [k.filter.id, k.filter]));
    const payload: Record<string, unknown> = {
      inquiryId: pull.inquiry.id,
      inquiryTitle: pull.inquiry.title,
      pulled: pull.pulled,
      automatic: pull.automatic,
      findings: listed.map((f) => {
        const evidenceId = pull.evidenceByAsset.get(f.assetId);
        const itemId = evidenceId ? items.get(evidenceId) : undefined;
        return {
          findingId: f.id,
          label: f.findingType,
          value: clipValue(f.matchedContent),
          severity: String(f.severity),
          assetId: f.assetId,
          assetLabel: f.asset?.name ?? null,
          ...(itemId ? { itemId } : {}),
        };
      }),
      ...(pull.added.length > PULL_LIST_CAP ? { truncated: true } : {}),
      findingLabels: [...new Set(pull.added.map((f) => f.findingType))].slice(
        0,
        10,
      ),
      assetLabels: [
        ...new Set(pull.added.map((f) => f.asset?.name).filter(Boolean)),
      ].slice(0, 10),
      // What the case's filters kept out, so a quiet auto-add explains itself.
      ...(pull.kept.length > 0
        ? {
            filtered: pull.kept.length,
            filteredLabels: [
              ...new Set(pull.kept.map((k) => k.findingType)),
            ].slice(0, 10),
            filters: [...filters.values()].slice(0, 10),
          }
        : {}),
      ...(sourceId
        ? {
            sourceId,
            ...(source ? { sourceNames: [source.name] } : {}),
            ...(pull.run?.runnerId ? { runnerId: pull.run.runnerId } : {}),
          }
        : {}),
      // A capped auto-add says how many new answers it left for a person.
      ...(pull.run?.available ? { available: pull.run.available } : {}),
    };
    if (!pull.automatic) {
      await this.activity.record(
        caseId,
        CaseActivityType.INQUIRY_PULLED,
        payload,
        pull.actor,
      );
      return;
    }
    await this.activity.recordCoalesced(
      caseId,
      CaseActivityType.INQUIRY_PULLED,
      payload,
      AUTO_PULL_ACTOR,
      {
        key: `auto-pull:${pull.inquiry.id}`,
        merge: (previous, next) => {
          const listedMerged = mergeListed(
            previous,
            next,
            'findings',
            PULL_LIST_CAP,
          );
          const filtered =
            numberOf(previous.filtered) + numberOf(next.filtered);
          const filterList = new Map<string, unknown>();
          for (const f of [
            ...(Array.isArray(next.filters) ? next.filters : []),
            ...(Array.isArray(previous.filters) ? previous.filters : []),
          ] as Array<{ id?: string }>) {
            if (f?.id && !filterList.has(f.id)) filterList.set(f.id, f);
          }
          return {
            ...next,
            pulled: numberOf(previous.pulled) + numberOf(next.pulled),
            findings: listedMerged.list,
            truncated: listedMerged.truncated || undefined,
            findingLabels: mergeDistinct(previous, next, 'findingLabels', 10),
            assetLabels: mergeDistinct(previous, next, 'assetLabels', 10),
            ...(filtered > 0
              ? {
                  filtered,
                  filteredLabels: mergeDistinct(
                    previous,
                    next,
                    'filteredLabels',
                    10,
                  ),
                  filters: [...filterList.values()].slice(0, 10),
                }
              : {}),
            sourceNames: mergeDistinct(previous, next, 'sourceNames', 10),
            available:
              numberOf(previous.available) + numberOf(next.available) ||
              undefined,
          };
        },
      },
    );
  }

  /** Which of these findings the case holds already. */
  private async heldFindingIds(
    db: Prisma.TransactionClient,
    caseId: string,
    findingIds: string[],
  ): Promise<Set<string>> {
    if (findingIds.length === 0) return new Set();
    const rows = await db.caseFinding.findMany({
      where: { caseId, findingId: { in: findingIds } },
      select: { findingId: true },
    });
    return new Set(rows.map((row) => row.findingId));
  }

  /**
   * Run the escalation rules over findings that just joined the case: the
   * case-wide ones always, and `inquiry`'s own when they came through it.
   */
  private async escalateArrived(
    db: Prisma.TransactionClient,
    caseId: string,
    inquiry: { id: string; title: string } | null,
    findingIds: string[],
    ctx: {
      trigger: 'ARRIVAL' | 'ATTACHED';
      actor: string | undefined;
      added?: boolean;
      run?: { sourceId?: string | null; runnerId?: string | null };
    },
  ): Promise<void> {
    if (!this.escalation || findingIds.length === 0) return;
    const rows = await db.caseFinding.findMany({
      where: { caseId, findingId: { in: findingIds } },
      include: { caseEvidence: { select: { entityId: true, label: true } } },
    });
    await this.escalation.escalateArrivals(
      caseId,
      inquiry,
      rows.map(candidateOf),
      { ...ctx, db },
    );
  }

  /** The live board item of each evidence row, where the case has a board. */
  private async boardItemsFor(
    caseId: string,
    evidenceIds: string[],
  ): Promise<Map<string, string>> {
    if (evidenceIds.length === 0) return new Map();
    const rows = await this.prisma.caseBoardItem.findMany({
      where: {
        board: { caseId },
        kind: 'EVIDENCE',
        refId: { in: evidenceIds },
        deletedAt: null,
      },
      select: { id: true, refId: true },
    });
    return new Map(
      rows
        .filter((r): r is { id: string; refId: string } => !!r.refId)
        .map((r) => [r.refId, r.id]),
    );
  }

  /**
   * Which of these findings the case's case-wide filters keep out. For
   * callers that attach on nobody's explicit say-so — the autopilot — so an
   * investigator's "never this kind of finding" holds against it too.
   */
  async caseWideExclusions(
    caseId: string,
    findingIds: string[],
  ): Promise<Map<string, FilterSummary>> {
    const excluded = new Map<string, FilterSummary>();
    if (!this.cleanup || findingIds.length === 0) return excluded;
    const gate = await this.cleanup.pullGate(caseId, null);
    const rows = await this.prisma.finding.findMany({
      where: { id: { in: findingIds } },
      select: { id: true, findingType: true, matchedContent: true },
    });
    for (const row of rows) {
      const filter = gate(row);
      if (filter) excluded.set(row.id, filter);
    }
    return excluded;
  }

  async getGraph(caseId: string, depth = 1): Promise<GraphResponseDto> {
    await this.ensureExists(caseId);
    return this.graph.caseGraph(caseId, depth);
  }

  // ─── Private ─────────────────────────────────────────────────────

  private toArray<T extends string>(value: T | T[] | undefined): T[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.length > 0) return [value];
    return [];
  }

  private async ensureExists(
    id: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const found = await db.case.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${id} not found`);
  }

  /** Upsert asset evidence (snapshotting display metadata) and return its id. */
  private async ensureAssetEvidence(
    caseId: string,
    assetId: string,
    asset: {
      name: string;
      assetType: string;
      sourceType: { toString(): string };
    } | null,
    addedBy?: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<string> {
    const ev = await db.caseEvidence.upsert({
      where: {
        caseId_entityType_entityId: {
          caseId,
          entityType: 'asset',
          entityId: assetId,
        },
      },
      create: {
        caseId,
        entityType: 'asset',
        entityId: assetId,
        label: asset?.name ?? null,
        assetType: asset?.assetType ?? null,
        sourceType: asset ? String(asset.sourceType) : null,
        // Recorded on the evidence the attach creates; it used to be dropped,
        // leaving addedBy null on every evidence row (field report P14).
        addedBy: addedBy ?? null,
      },
      update: {},
      select: { id: true },
    });
    return ev.id;
  }

  private mapCase(row: CaseRow): CaseResponseDto {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      severity: row.severity,
      aiMode: row.aiMode,
      assignee: row.assignee,
      createdBy: row.createdBy,
      conclusion: row.conclusion,
      evidenceCount: row._count.evidence,
      hypothesisCount: row._count.threads,
      inquiryCount: row._count.inquiryLinks,
      removeGoneFindings: row.removeGoneFindings,
      removeResolvedFindings: row.removeResolvedFindings,
      removeGoneAssets: row.removeGoneAssets,
      escalatedCount: row._count.findings,
      lastEscalatedAt: row.lastEscalatedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapCaseFinding(cf: {
    id: string;
    caseEvidenceId: string;
    findingId: string;
    label: string;
    severity: string | null;
    detectorType: string | null;
    customDetectorName?: string | null;
    matchedContent?: string | null;
    note: string | null;
    createdAt: Date;
    escalatedAt?: Date | null;
    escalationRuleId?: string | null;
    escalationLabel?: string | null;
  }): CaseFindingDto {
    return {
      escalatedAt: cf.escalatedAt ?? null,
      escalationRuleId: cf.escalationRuleId ?? null,
      escalationLabel: cf.escalationLabel ?? null,
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
    };
  }

  private hydrateEvidence(rows: EvidenceRow[]): CaseEvidenceDto[] {
    return rows.map((r) => ({
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
      findings: r.findings.map((cf) => this.mapCaseFinding(cf)),
    }));
  }
}
