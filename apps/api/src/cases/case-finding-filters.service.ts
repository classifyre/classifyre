import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CaseActivityType,
  CaseFindingFilter,
  CaseFindingFilterKind,
  CaseFindingRuleAction,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CaseActivityService } from '../case-activity.service';
import { isReadOnlyCase } from '../case-board/board-rows';
import {
  candidateWhere,
  CompiledMatcher,
  type InquiryMatchers,
} from '../matching/inquiry-matcher';
import { CaseCleanupService, type FilterSummary } from './case-cleanup.service';
import { CaseEscalationService } from './case-escalation.service';
import { filterPatternProblem } from './case-cleanup.rules';
import {
  AddCaseFindingFiltersDto,
  CaseFindingFilterDto,
  CaseFindingFilterOptionsDto,
  CaseFindingFiltersChangeResponseDto,
  CaseFindingFiltersPreviewDto,
  CaseFindingFilterRuleDto,
  CaseFindingTypeOptionDto,
  PreviewCaseFindingFiltersDto,
  UpdateCaseFindingFilterDto,
} from '../dto/case-cleanup.dto';

/** Rules one request may add. */
const RULES_PER_REQUEST = 50;
/** Filters one case may hold. */
const FILTERS_PER_CASE = 200;

const MATCHER_SELECT = {
  matchAllSources: true,
  sourceIds: true,
  detectorTypes: true,
  customDetectorKeys: true,
  findingTypes: true,
  findingTypeRegex: true,
  findingValueRegex: true,
} as const;

type FilterRow = CaseFindingFilter & {
  watch: { inquiryId: string; inquiry: { title: string } } | null;
};

const FILTER_INCLUDE = {
  watch: {
    select: { inquiryId: true, inquiry: { select: { title: true } } },
  },
} as const;

/**
 * A case's finding rules, case-wide or for one watch, with one of two
 * actions. A filter (EXCLUDE) is a kind of finding the case does not want:
 * adding or changing one takes out what it matches right away (through
 * CaseCleanupService, so it lands on the timeline like every other automatic
 * removal), and pulls from a watch skip what it matches from then on. An
 * escalation (ESCALATE) is a kind of finding that needs attention: adding one
 * marks what the case holds already (CaseEscalationService), and every later
 * arrival that matches is marked, and brought in even with auto-add off.
 */
@Injectable()
export class CaseFindingFiltersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: CaseActivityService,
    private readonly cleanup: CaseCleanupService,
    private readonly escalation: CaseEscalationService,
  ) {}

  async list(caseId: string): Promise<CaseFindingFilterDto[]> {
    await this.ensureCase(caseId);
    const rows = await this.prisma.caseFindingFilter.findMany({
      where: { caseId },
      include: FILTER_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toFilterDto);
  }

  async add(
    caseId: string,
    dto: AddCaseFindingFiltersDto,
    actor?: string,
  ): Promise<CaseFindingFiltersChangeResponseDto> {
    await this.ensureWritable(caseId);
    const link = await this.scopeLink(caseId, dto.inquiryId);
    const rules = this.validRules(dto.rules);
    const action = asAction(dto.action);

    const existing = await this.prisma.caseFindingFilter.findMany({
      where: { caseId },
      select: { caseInquiryId: true, kind: true, action: true, pattern: true },
    });
    const key = (
      linkId: string | null,
      ruleAction: string,
      kind: string,
      pattern: string,
    ) => `${linkId ?? ''}\u0000${ruleAction}\u0000${kind}\u0000${pattern}`;
    const known = new Set(
      existing.map((f) => key(f.caseInquiryId, f.action, f.kind, f.pattern)),
    );
    const fresh = rules.filter((r) => {
      const k = key(link?.id ?? null, action, r.kind, r.pattern);
      if (known.has(k)) return false;
      known.add(k);
      return true;
    });
    if (existing.length + fresh.length > FILTERS_PER_CASE) {
      throw new BadRequestException(
        `A case holds at most ${FILTERS_PER_CASE} filters.`,
      );
    }
    if (fresh.length === 0) {
      return {
        filters: await this.list(caseId),
        detached: 0,
        escalated: 0,
        assetsRemoved: 0,
      };
    }

    let escalated = 0;
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        const created: FilterRow[] = [];
        for (const rule of fresh) {
          created.push(
            await tx.caseFindingFilter.create({
              data: {
                caseId,
                caseInquiryId: link?.id ?? null,
                kind: rule.kind,
                action,
                pattern: rule.pattern,
                description: rule.description?.trim() || null,
                createdBy: actor ?? null,
              },
              include: FILTER_INCLUDE,
            }),
          );
        }
        const summaries = created.map(summaryOf);
        await this.activity.record(
          caseId,
          CaseActivityType.FINDING_FILTER_ADDED,
          {
            action,
            filters: summaries,
            ...scopePayload(link),
          },
          actor,
          tx,
        );
        const saved = created.map((row) => ({
          ...summaryOf(row),
          caseInquiryId: row.caseInquiryId,
        }));
        if (action === CaseFindingRuleAction.ESCALATE) {
          escalated = await this.escalation.escalateExisting(
            tx,
            caseId,
            saved,
            { trigger: 'RULE_ADDED', actor },
          );
          return null;
        }
        return this.cleanup.applyFilters(tx, caseId, saved, {
          trigger: 'FILTER_ADDED',
          actor,
          removeEmptiedAssets: flag(dto.removeEmptiedAssets),
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    if (outcome) this.cleanup.announce(caseId, outcome, actor, dto.clientId);
    return {
      filters: await this.list(caseId),
      detached: outcome?.findingsRemoved ?? 0,
      escalated,
      assetsRemoved: outcome?.emptiedRemoved ?? 0,
    };
  }

  async update(
    caseId: string,
    filterId: string,
    dto: UpdateCaseFindingFilterDto,
    actor?: string,
  ): Promise<CaseFindingFiltersChangeResponseDto> {
    await this.ensureWritable(caseId);
    const current = await this.find(caseId, filterId);
    const pattern =
      dto.pattern === undefined
        ? current.pattern
        : normalizePattern(current.kind, dto.pattern);
    const problem = filterPatternProblem(current.kind, pattern);
    if (problem) throw new BadRequestException(problem);
    const description =
      dto.description === undefined
        ? current.description
        : dto.description?.trim() || null;
    if (pattern === current.pattern && description === current.description) {
      return {
        filters: await this.list(caseId),
        detached: 0,
        escalated: 0,
        assetsRemoved: 0,
      };
    }

    let escalated = 0;
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        const updated = await tx.caseFindingFilter.update({
          where: { id: filterId },
          data: { pattern, description },
          include: FILTER_INCLUDE,
        });
        await this.activity.record(
          caseId,
          CaseActivityType.FINDING_FILTER_UPDATED,
          {
            filter: summaryOf(updated),
            before: {
              pattern: current.pattern,
              description: current.description,
            },
            ...scopePayload(
              current.watch
                ? {
                    inquiryId: current.watch.inquiryId,
                    title: current.watch.inquiry.title,
                  }
                : null,
            ),
          },
          actor,
          tx,
        );
        // Only a new pattern can match something the old one did not.
        if (pattern === current.pattern) return null;
        const saved = [
          { ...summaryOf(updated), caseInquiryId: updated.caseInquiryId },
        ];
        if (updated.action === CaseFindingRuleAction.ESCALATE) {
          escalated = await this.escalation.escalateExisting(
            tx,
            caseId,
            saved,
            { trigger: 'RULE_UPDATED', actor },
          );
          return null;
        }
        return this.cleanup.applyFilters(tx, caseId, saved, {
          trigger: 'FILTER_UPDATED',
          actor,
          removeEmptiedAssets: flag(dto.removeEmptiedAssets),
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    if (outcome) this.cleanup.announce(caseId, outcome, actor, dto.clientId);
    return {
      filters: await this.list(caseId),
      detached: outcome?.findingsRemoved ?? 0,
      escalated,
      assetsRemoved: outcome?.emptiedRemoved ?? 0,
    };
  }

  /**
   * Drop a rule. What a filter took out stays out — putting findings back is
   * a person's call (pull the watch again, or attach them on the board) — and
   * what an escalation marked stays marked until someone clears it; either
   * way the watches just stop applying the rule. For a filter:
   * the watch simply stops skipping them.
   */
  async remove(
    caseId: string,
    filterId: string,
    actor?: string,
  ): Promise<CaseFindingFilterDto[]> {
    await this.ensureWritable(caseId);
    const current = await this.find(caseId, filterId);
    await this.prisma.$transaction(async (tx) => {
      await tx.caseFindingFilter.delete({ where: { id: filterId } });
      await this.activity.record(
        caseId,
        CaseActivityType.FINDING_FILTER_REMOVED,
        {
          filter: summaryOf(current),
          ...scopePayload(
            current.watch
              ? {
                  inquiryId: current.watch.inquiryId,
                  title: current.watch.inquiry.title,
                }
              : null,
          ),
        },
        actor,
        tx,
      );
    });
    return this.list(caseId);
  }

  async preview(
    caseId: string,
    dto: PreviewCaseFindingFiltersDto,
  ): Promise<CaseFindingFiltersPreviewDto> {
    await this.ensureCase(caseId);
    const link = await this.scopeLink(caseId, dto.inquiryId);
    const rules = (Array.isArray(dto.rules) ? dto.rules : [])
      .slice(0, RULES_PER_REQUEST)
      .map((r) => ({
        kind: asKind(r?.kind),
        pattern:
          typeof r?.pattern === 'string'
            ? normalizePattern(asKind(r.kind), r.pattern)
            : '',
      }));
    return this.cleanup.previewFilters(
      caseId,
      link?.id ?? null,
      rules,
      asAction(dto.action),
    );
  }

  /**
   * The finding types a filter scope can pick from: what the case holds, and
   * what its watches (or the one watch) answer — so the picker offers kinds
   * of finding that can actually arrive, not every type in the workspace.
   */
  async options(
    caseId: string,
    inquiryId?: string | null,
  ): Promise<CaseFindingFilterOptionsDto> {
    await this.ensureCase(caseId);
    const link = await this.scopeLink(caseId, inquiryId);
    const watches = await this.prisma.caseInquiry.findMany({
      where: { caseId, ...(link ? { id: link.id } : {}) },
      select: { id: true, inquiry: { select: MATCHER_SELECT } },
    });

    const options = new Map<string, CaseFindingTypeOptionDto>();
    const option = (findingType: string): CaseFindingTypeOptionDto => {
      let found = options.get(findingType);
      if (!found) {
        found = {
          findingType,
          detectorType: null,
          detectorName: null,
          inCase: 0,
          answers: 0,
        };
        options.set(findingType, found);
      }
      return found;
    };

    // What the case holds (for one watch: what that watch answers of it).
    const cited = await this.prisma.caseFinding.findMany({
      where: { caseId },
      select: {
        findingId: true,
        label: true,
        detectorType: true,
        customDetectorName: true,
      },
    });
    let counted = cited;
    if (link) {
      const matcher = watches[0]
        ? new CompiledMatcher(watches[0].inquiry)
        : null;
      const live = await this.prisma.finding.findMany({
        where: { id: { in: cited.map((c) => c.findingId) } },
        select: {
          id: true,
          sourceId: true,
          detectorType: true,
          customDetectorKey: true,
          findingType: true,
          matchedContent: true,
        },
      });
      const answered = new Set(
        live.filter((f) => matcher?.matches(f)).map((f) => f.id),
      );
      counted = cited.filter((c) => answered.has(c.findingId));
    }
    for (const c of counted) {
      const o = option(c.label);
      o.inCase += 1;
      o.detectorType ??= c.detectorType;
      o.detectorName ??= c.customDetectorName;
    }

    // What the watches answer. Grouped in SQL; the type dimensions are then
    // applied per group exactly. A value pattern cannot be applied to a group,
    // so a watch with one reports its per-type counts as an estimate.
    let approximate = false;
    for (const watch of watches) {
      const m: InquiryMatchers = watch.inquiry;
      if (m.findingValueRegex.length > 0) approximate = true;
      const groups = await this.prisma.finding.groupBy({
        by: [
          'sourceId',
          'detectorType',
          'customDetectorKey',
          'customDetectorName',
          'findingType',
        ],
        where: candidateWhere(m, 'OPEN'),
        _count: { _all: true },
      });
      const typeMatcher = new CompiledMatcher({ ...m, findingValueRegex: [] });
      for (const g of groups) {
        if (
          !typeMatcher.matches({
            sourceId: g.sourceId,
            detectorType: g.detectorType,
            customDetectorKey: g.customDetectorKey,
            findingType: g.findingType,
          })
        )
          continue;
        const o = option(g.findingType);
        o.answers += g._count._all;
        o.detectorType ??= g.detectorType;
        o.detectorName ??= g.customDetectorName;
      }
    }

    const types = [...options.values()].sort(
      (a, b) =>
        b.inCase - a.inCase ||
        b.answers - a.answers ||
        a.findingType.localeCompare(b.findingType),
    );
    return { types, approximate };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private validRules(raw: CaseFindingFilterRuleDto[] | undefined): Array<{
    kind: CaseFindingFilterKind;
    pattern: string;
    description?: string;
  }> {
    const rules = Array.isArray(raw) ? raw : [];
    if (rules.length === 0)
      throw new BadRequestException('Give at least one filter rule.');
    if (rules.length > RULES_PER_REQUEST) {
      throw new BadRequestException(
        `At most ${RULES_PER_REQUEST} rules per request.`,
      );
    }
    return rules.map((r, index) => {
      const kind = asKind(r?.kind);
      const pattern =
        typeof r?.pattern === 'string' ? normalizePattern(kind, r.pattern) : '';
      const problem = filterPatternProblem(kind, pattern);
      if (problem) {
        throw new BadRequestException(`Rule ${index + 1}: ${problem}`);
      }
      const description =
        typeof r?.description === 'string' ? r.description : undefined;
      return { kind, pattern, description };
    });
  }

  /** The link a scoped request names; null for the whole case. */
  private async scopeLink(
    caseId: string,
    inquiryId: string | null | undefined,
  ): Promise<{ id: string; inquiryId: string; title: string } | null> {
    if (!inquiryId) return null;
    const link = await this.prisma.caseInquiry.findUnique({
      where: { caseId_inquiryId: { caseId, inquiryId } },
      select: {
        id: true,
        inquiryId: true,
        inquiry: { select: { title: true } },
      },
    });
    if (!link) {
      throw new BadRequestException(
        `Inquiry ${inquiryId} does not drive case ${caseId}; link it first.`,
      );
    }
    return {
      id: link.id,
      inquiryId: link.inquiryId,
      title: link.inquiry.title,
    };
  }

  private async find(caseId: string, filterId: string): Promise<FilterRow> {
    const row = await this.prisma.caseFindingFilter.findFirst({
      where: { id: filterId, caseId },
      include: FILTER_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException(
        `Filter ${filterId} not found on case ${caseId}`,
      );
    }
    return row;
  }

  private async ensureCase(caseId: string): Promise<void> {
    const found = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${caseId} not found`);
  }

  private async ensureWritable(caseId: string): Promise<void> {
    const found = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { status: true },
    });
    if (!found) throw new NotFoundException(`Case with ID ${caseId} not found`);
    if (isReadOnlyCase(found.status)) {
      throw new ConflictException(
        `This case is ${found.status.toLowerCase()}. Reopen it to change its filters.`,
      );
    }
  }
}

/** No global ValidationPipe: a form or MCP "true" can arrive as text. */
function flag(value: unknown): boolean {
  return value === true || value === 'true';
}

/** Filter unless asked otherwise: every caller before escalation meant one. */
function asAction(value: unknown): CaseFindingRuleAction {
  if (value === undefined || value === null || value === '')
    return CaseFindingRuleAction.EXCLUDE;
  if (
    value === CaseFindingRuleAction.EXCLUDE ||
    value === CaseFindingRuleAction.ESCALATE
  ) {
    return value;
  }
  throw new BadRequestException(
    `Unknown rule action ${JSON.stringify(value)} — expected EXCLUDE or ESCALATE.`,
  );
}

function asKind(value: unknown): CaseFindingFilterKind {
  if (
    value === CaseFindingFilterKind.FINDING_TYPE ||
    value === CaseFindingFilterKind.VALUE_PATTERN
  ) {
    return value;
  }
  throw new BadRequestException(
    `Unknown filter kind ${JSON.stringify(value)} — expected FINDING_TYPE or VALUE_PATTERN.`,
  );
}

/** A type is compared exactly, so stray spaces around it are a typo; a pattern is kept as typed. */
function normalizePattern(
  kind: CaseFindingFilterKind,
  pattern: string,
): string {
  return kind === CaseFindingFilterKind.FINDING_TYPE ? pattern.trim() : pattern;
}

export function summaryOf(row: FilterRow): FilterSummary {
  return {
    id: row.id,
    kind: row.kind,
    action: row.action,
    pattern: row.pattern,
    description: row.description,
    inquiryId: row.watch?.inquiryId ?? null,
    inquiryTitle: row.watch?.inquiry.title ?? null,
  };
}

export function toFilterDto(row: FilterRow): CaseFindingFilterDto {
  return {
    ...summaryOf(row),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function scopePayload(
  link: { inquiryId: string; title: string } | null,
): Prisma.JsonObject {
  return link
    ? { scope: 'WATCH', inquiryId: link.inquiryId, inquiryTitle: link.title }
    : { scope: 'CASE' };
}
