import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CaseActivityType,
  CaseBoardItem,
  CaseEvidence,
  CaseFinding,
  CaseFindingFilterKind,
  CaseFindingRuleAction,
  CaseStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  CaseActivityService,
  mergeDistinct,
  mergeListed,
  type ActivityPayload,
} from '../case-activity.service';
import {
  CASE_BOARD_EVENTS,
  type CaseBoardEvents,
} from '../case-board/case-board.events';
import {
  asRecord,
  isReadOnlyCase,
  unparentChildren,
} from '../case-board/board-rows';
import {
  caseFindingTombstone,
  evidenceTombstone,
} from '../case-board/tombstones';
import { CompiledMatcher } from '../matching/inquiry-matcher';
import { ensureTermSnapshotFor } from '../semantic/term-snapshot';
import { CASE_CLEANUP_ACTOR, type CaseCleanupPort } from './case-cleanup.port';
import {
  emptiedByCleanup,
  anyRule,
  assetRemoval,
  compileFindingFilters,
  filterPatternProblem,
  findingRemoval,
  firstMatchingFilter,
  type CleanupRules,
  type CompiledFindingFilter,
  type FilterableFinding,
  type FindingFilterRule,
  type FindingRemovalReason,
  type GoneState,
} from './case-cleanup.rules';
import {
  CaseCleanupItemDto,
  CaseCleanupPreviewDto,
  CaseCleanupResultDto,
  CaseFindingFiltersPreviewDto,
} from '../dto/case-cleanup.dto';

type Db = Prisma.TransactionClient;

/** Findings or assets named on one timeline row; `count` says the rest. */
const LIST_CAP = 50;
/** Matched values are clipped on the timeline and in previews. */
const VALUE_MAX = 160;
/** Rows a preview names. */
const SAMPLE_CAP = 8;
/** How often reading a case's board may re-check its rules. */
const CHECK_INTERVAL_MS = 2 * 60_000;
/** Ids per `IN (...)` list. */
const ID_CHUNK = 5_000;

/** What set a clean-up pass off, as the timeline tells it. */
export type CleanupTrigger =
  | 'RULE_ENABLED'
  | 'SCAN'
  | 'STATUS_CHANGE'
  | 'CHECK'
  | 'FILTER_ADDED'
  | 'FILTER_UPDATED';

/** A rule (filter or escalation) as a timeline row describes it. */
export interface FilterSummary {
  id: string;
  kind: CaseFindingFilterKind;
  action: CaseFindingRuleAction;
  pattern: string;
  description: string | null;
  inquiryId: string | null;
  inquiryTitle: string | null;
}

/** A filter as the removal planner reads it. */
export type FilterForPlan = FindingFilterRule & Partial<FilterSummary>;

export type CitedFinding = CaseFinding & {
  caseEvidence: { entityId: string; label: string | null };
};

export interface FindingRemovalPlan {
  cf: CitedFinding;
  reason: FindingRemovalReason;
  state?: GoneState;
  filterId?: string;
}

/**
 * Why evidence leaves by itself: its asset is gone from the source, a filter
 * just took out every finding the case held on it (and was asked to take out
 * what it empties), or the clean-up rules took out its last finding.
 */
export type EvidenceRemovalReason = 'ASSET_GONE' | 'FILTER_EMPTIED' | 'EMPTIED';

interface EvidenceRemovalPlan {
  ev: CaseEvidence & { findings: CaseFinding[] };
  reason: EvidenceRemovalReason;
  /** For a gone asset: retired by a scan, or its row deleted. */
  state?: GoneState;
}

interface Plan {
  findings: FindingRemovalPlan[];
  evidence: EvidenceRemovalPlan[];
}

interface ExecuteContext {
  /** Which trigger each rule's timeline row names. */
  triggerFor: (
    reason: FindingRemovalReason | EvidenceRemovalReason,
  ) => CleanupTrigger;
  /** Who the timeline credits: a person, the clean-up itself, or nobody named. */
  actor: string | undefined;
  run?: {
    sourceId: string;
    sourceName: string | null;
    runnerId: string | null;
  };
  filters?: FilterSummary[];
}

export interface CleanupOutcome extends CaseCleanupResultDto {
  /** Of `evidenceRemoved`: assets a filter left without findings. */
  emptiedRemoved: number;
  /** Of `evidenceRemoved`: assets the rules left without findings. */
  leftEmptyRemoved: number;
  /** The board's version after the pass, when it changed one. */
  version: number | null;
}

const NOTHING: CleanupOutcome = {
  findingsRemoved: 0,
  evidenceRemoved: 0,
  findingsWithEvidence: 0,
  emptiedRemoved: 0,
  leftEmptyRemoved: 0,
  version: null,
};

const RULE_FOR: Record<
  FindingRemovalReason | EvidenceRemovalReason,
  keyof CleanupRules | null
> = {
  FINDING_GONE: 'removeGoneFindings',
  FINDING_RESOLVED: 'removeResolvedFindings',
  ASSET_GONE: 'removeGoneAssets',
  FILTER: null,
  FILTER_EMPTIED: null,
  // Follows whichever finding rule took the last finding out.
  EMPTIED: null,
};

const CLEANUP_SELECT = {
  status: true,
  removeGoneFindings: true,
  removeResolvedFindings: true,
  removeGoneAssets: true,
} as const;

const MATCHER_SELECT = {
  matchAllSources: true,
  sourceIds: true,
  detectorTypes: true,
  customDetectorKeys: true,
  findingTypes: true,
  findingTypeRegex: true,
  findingValueRegex: true,
  termKeys: true,
  termsIncludeNarrower: true,
} as const;

export function rulesOf(row: CleanupRules): CleanupRules {
  return {
    removeGoneFindings: row.removeGoneFindings,
    removeResolvedFindings: row.removeResolvedFindings,
    removeGoneAssets: row.removeGoneAssets,
  };
}

/**
 * Automatic case clean-up: takes out of a case what its switches and filters
 * say no longer belongs there, and writes down on the timeline what left and
 * why. docs: apps/docs/app/investigations/cases (clean-up and filters).
 *
 * Every removal goes the way a person's removal on the board goes: the case
 * rows are deleted, the board keeps a tombstone (so attaching the finding
 * again brings back its note and stances), links drawn to it are put away, and
 * open boards are told to refetch.
 *
 * Nothing here touches a closed case: it is a record.
 */
@Injectable()
export class CaseCleanupService implements CaseCleanupPort {
  private readonly logger = new Logger(CaseCleanupService.name);
  /** caseId → when a board read last checked its rules. */
  private readonly lastCheck = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: CaseActivityService,
    @Optional()
    @Inject(CASE_BOARD_EVENTS)
    private readonly events?: CaseBoardEvents,
  ) {}

  // ─── Rules ────────────────────────────────────────────────────────────────

  /**
   * Apply the case's switches now. `enabledNow` names the switches a person
   * just turned on, so their timeline rows say so. `actor` is who the
   * timeline credits: the person who switched a rule on (unnamed when they
   * gave no name), or CASE_CLEANUP_ACTOR for a pass nobody asked for.
   */
  async applyRules(
    caseId: string,
    opts: {
      trigger: CleanupTrigger;
      actor: string | undefined;
      enabledNow?: CleanupRules;
      run?: ExecuteContext['run'];
    },
  ): Promise<CleanupOutcome> {
    const actor = opts.actor;
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        const row = await this.lockCase(tx, caseId);
        if (!row || isReadOnlyCase(row.status)) return NOTHING;
        const rules = rulesOf(row);
        if (!anyRule(rules)) return NOTHING;
        const plan = await this.planRules(tx, caseId, rules);
        return this.execute(tx, caseId, plan, {
          triggerFor: (reason) => {
            const rule = RULE_FOR[reason];
            return rule && opts.enabledNow?.[rule]
              ? 'RULE_ENABLED'
              : opts.trigger;
          },
          actor,
          run: opts.run,
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    this.announce(caseId, outcome, actor);
    return outcome;
  }

  /** What the given switches would take out right now. Writes nothing. */
  async previewRules(
    caseId: string,
    rules: CleanupRules,
  ): Promise<CaseCleanupPreviewDto> {
    const empty: CaseCleanupPreviewDto = {
      goneFindings: 0,
      resolvedFindings: 0,
      goneAssets: 0,
      findingsWithAssets: 0,
      sample: [],
    };
    if (!anyRule(rules)) return empty;
    const plan = await this.planRules(this.prisma, caseId, rules);
    const sample: CaseCleanupItemDto[] = [
      ...plan.evidence.map(
        (e): CaseCleanupItemDto => ({
          reason: e.reason,
          state: e.state,
          label: e.ev.label ?? e.ev.entityId,
          value: null,
          assetLabel: e.ev.label,
        }),
      ),
      ...plan.findings.map((r) => this.sampleItem(r)),
    ].slice(0, SAMPLE_CAP);
    return {
      goneFindings: plan.findings.filter((r) => r.reason === 'FINDING_GONE')
        .length,
      resolvedFindings: plan.findings.filter(
        (r) => r.reason === 'FINDING_RESOLVED',
      ).length,
      goneAssets: plan.evidence.length,
      // An emptied asset's findings are already counted above, as findings.
      findingsWithAssets: plan.evidence.reduce(
        (sum, e) => sum + (e.reason === 'EMPTIED' ? 0 : e.ev.findings.length),
        0,
      ),
      sample,
    };
  }

  /**
   * After a scan: every open case with a switch on that cites an asset of the
   * source — or an asset whose row is gone, which can no longer say which
   * source it came from.
   */
  async sweepForSource(
    sourceId: string,
    run: { runnerId?: string | null } = {},
  ): Promise<void> {
    const cases = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT c.id
        FROM cases c
        JOIN case_evidence e ON e.case_id = c.id AND e.entity_type = 'asset'
        LEFT JOIN assets a ON a.id = e.entity_id
       WHERE c.status NOT IN ('CLOSED'::"CaseStatus", 'ARCHIVED'::"CaseStatus")
         AND (c.remove_gone_findings OR c.remove_resolved_findings OR c.remove_gone_assets)
         AND (a.id IS NULL OR a.source_id = ${sourceId})`;
    if (cases.length === 0) return;
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { name: true },
    });
    for (const { id } of cases) {
      await this.applyRules(id, {
        trigger: 'SCAN',
        actor: CASE_CLEANUP_ACTOR,
        run: {
          sourceId,
          sourceName: source?.name ?? null,
          runnerId: run.runnerId ?? null,
        },
      }).catch((error) =>
        this.logger.warn(
          `Clean-up of case ${id} after a scan of ${sourceId} failed: ${String(error)}`,
        ),
      );
    }
  }

  /**
   * After someone changed finding statuses: the open cases citing them that
   * take out resolved (or gone) findings. `null` means "too many to name" —
   * a filter-mode bulk update — and checks every such case.
   */
  async afterStatusChange(findingIds: string[] | null): Promise<void> {
    const where: Prisma.CaseWhereInput = {
      status: { notIn: [CaseStatus.CLOSED, CaseStatus.ARCHIVED] },
      OR: [{ removeResolvedFindings: true }, { removeGoneFindings: true }],
    };
    let caseIds: string[];
    if (findingIds) {
      if (findingIds.length === 0) return;
      const rows = await this.inChunks(findingIds, (ids) =>
        this.prisma.caseFinding.findMany({
          where: { findingId: { in: ids }, investigation: where },
          select: { caseId: true },
        }),
      );
      caseIds = [...new Set(rows.map((r) => r.caseId))];
    } else {
      const rows = await this.prisma.case.findMany({
        where,
        select: { id: true },
      });
      caseIds = rows.map((r) => r.id);
    }
    for (const id of caseIds) {
      await this.applyRules(id, {
        trigger: 'STATUS_CHANGE',
        actor: CASE_CLEANUP_ACTOR,
      }).catch((error) =>
        this.logger.warn(
          `Clean-up of case ${id} after a status change failed: ${String(error)}`,
        ),
      );
    }
  }

  /**
   * The safety net, run when a case's board is read: purges, source deletions
   * and anything else that never passes through a scan still get applied the
   * next time someone looks. Throttled per case; never throws.
   */
  async checkIfDue(caseId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastCheck.get(caseId);
    if (last !== undefined && now - last < CHECK_INTERVAL_MS) return;
    this.lastCheck.set(caseId, now);
    if (this.lastCheck.size > 10_000) {
      // Oldest first: a Map iterates in insertion order.
      for (const key of [...this.lastCheck.keys()].slice(0, 5_000))
        this.lastCheck.delete(key);
    }
    try {
      const row = await this.prisma.case.findUnique({
        where: { id: caseId },
        select: CLEANUP_SELECT,
      });
      if (!row || isReadOnlyCase(row.status) || !anyRule(rulesOf(row))) return;
      await this.applyRules(caseId, {
        trigger: 'CHECK',
        actor: CASE_CLEANUP_ACTOR,
      });
    } catch (error) {
      this.logger.warn(
        `Clean-up check of case ${caseId} failed: ${String(error)}`,
      );
    }
  }

  // ─── Filters ──────────────────────────────────────────────────────────────

  /**
   * Take out of the case the findings these (just saved) filters match.
   * Joins the caller's transaction, so the filter and what it removed land
   * together; call {@link announce} after it commits.
   */
  async applyFilters(
    tx: Db,
    caseId: string,
    filters: Array<FindingFilterRule & FilterSummary>,
    ctx: {
      trigger: 'FILTER_ADDED' | 'FILTER_UPDATED';
      actor?: string;
      /** Also take out the assets this leaves without a finding in the case. */
      removeEmptiedAssets?: boolean;
    },
  ): Promise<CleanupOutcome> {
    const row = await this.lockCase(tx, caseId);
    if (!row || isReadOnlyCase(row.status) || filters.length === 0)
      return NOTHING;
    const findings = await this.planFilterRemovals(tx, caseId, filters);
    const emptied = ctx.removeEmptiedAssets
      ? await this.emptiedEvidence(tx, caseId, findings)
      : [];
    return this.execute(
      tx,
      caseId,
      {
        findings,
        evidence: emptied.map((ev) => ({ ev, reason: 'FILTER_EMPTIED' })),
      },
      {
        triggerFor: () => ctx.trigger,
        actor: ctx.actor,
        filters: filters.map((f) => ({
          id: f.id,
          kind: f.kind,
          action: f.action,
          pattern: f.pattern,
          description: f.description,
          inquiryId: f.inquiryId,
          inquiryTitle: f.inquiryTitle,
        })),
      },
    );
  }

  /**
   * What unsaved rules would do now: the findings a filter would take out,
   * or the not-yet-escalated findings an escalation would mark. Writes
   * nothing.
   */
  async previewFilters(
    caseId: string,
    caseInquiryId: string | null,
    rules: Array<{ kind: CaseFindingFilterKind; pattern: string }>,
    action: CaseFindingRuleAction = CaseFindingRuleAction.EXCLUDE,
  ): Promise<CaseFindingFiltersPreviewDto> {
    const problems = rules.map(
      (r) => filterPatternProblem(r.kind, r.pattern) ?? '',
    );
    const valid = rules
      .map((r, index) => ({ r, index }))
      .filter(({ index }) => problems[index] === '');
    const perRule = rules.map(() => 0);
    if (valid.length === 0) {
      return {
        matched: 0,
        perRule,
        problems,
        sample: [],
        emptiedAssets: 0,
        emptiedSample: [],
      };
    }
    const filters: FindingFilterRule[] = valid.map(({ r, index }) => ({
      id: String(index),
      kind: r.kind,
      pattern: r.pattern,
      caseInquiryId,
    }));
    // Counted per rule as well as together: a rule that matches nothing is
    // usually a typo, and the dialog says which one.
    const matches = await this.planFilterRemovals(
      this.prisma,
      caseId,
      filters,
      {
        everyMatch: true,
      },
    );
    // An escalation marks each finding once: what is marked already stays.
    const removals =
      action === CaseFindingRuleAction.ESCALATE
        ? matches.filter((r) => !r.cf.escalatedAt)
        : matches;
    const matched = new Set<string>();
    for (const r of removals) {
      matched.add(r.cf.id);
      perRule[Number(r.filterId)] += 1;
    }
    const first = new Map<string, FindingRemovalPlan>();
    for (const r of removals) if (!first.has(r.cf.id)) first.set(r.cf.id, r);
    // What a filter would leave empty; an escalation leaves every finding in.
    const emptied =
      action === CaseFindingRuleAction.EXCLUDE
        ? await this.emptiedEvidence(this.prisma, caseId, [...first.values()])
        : [];
    return {
      matched: matched.size,
      perRule,
      problems,
      sample: [...first.values()]
        .slice(0, SAMPLE_CAP)
        .map((r) => this.sampleItem(r)),
      emptiedAssets: emptied.length,
      emptiedSample: emptied
        .slice(0, SAMPLE_CAP)
        .map((ev) => ev.label ?? ev.entityId),
    };
  }

  /**
   * The case's evidence these removals leave without a single finding: every
   * finding the case held on it is among them. Evidence that held no finding
   * to begin with (an asset added on its own) is never "emptied".
   */
  async emptiedEvidence(
    db: Db,
    caseId: string,
    removals: readonly FindingRemovalPlan[],
  ): Promise<EvidenceRemovalPlan['ev'][]> {
    if (removals.length === 0) return [];
    const leaving = new Set(removals.map((r) => r.cf.id));
    const touched = [...new Set(removals.map((r) => r.cf.caseEvidenceId))];
    const evidence = await this.inChunks(touched, (ids) =>
      db.caseEvidence.findMany({
        where: { caseId, id: { in: ids } },
        include: { findings: true },
      }),
    );
    return evidence.filter(
      (ev) =>
        ev.findings.length > 0 && ev.findings.every((f) => leaving.has(f.id)),
    );
  }

  /**
   * The filters a pull from `inquiryId` has to respect: the case-wide ones
   * and that watch's own. Returns a test that names the filter a finding
   * trips, or null.
   */
  pullGate(
    caseId: string,
    inquiryId: string | null,
  ): Promise<(f: FilterableFinding) => FilterSummary | null> {
    return this.ruleGate(caseId, inquiryId, CaseFindingRuleAction.EXCLUDE);
  }

  /**
   * The rules of one action that hold for findings arriving through
   * `inquiryId` (null: arriving any other way — only case-wide rules hold).
   * Returns a test naming the first rule a finding matches, or null.
   */
  async ruleGate(
    caseId: string,
    inquiryId: string | null,
    action: CaseFindingRuleAction,
    db: Db = this.prisma,
  ): Promise<(f: FilterableFinding) => FilterSummary | null> {
    const rows = await db.caseFindingFilter.findMany({
      where: {
        caseId,
        action,
        OR: [
          { caseInquiryId: null },
          ...(inquiryId ? [{ watch: { inquiryId } }] : []),
        ],
      },
      include: { watch: { include: { inquiry: { select: { title: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length === 0) return () => null;
    const compiled = compileFindingFilters(
      rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        pattern: r.pattern,
        caseInquiryId: r.caseInquiryId,
      })),
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return (finding) => {
      const hit = firstMatchingFilter(finding, compiled);
      if (!hit) return null;
      const row = byId.get(hit.rule.id)!;
      return {
        id: row.id,
        kind: row.kind,
        action: row.action,
        pattern: row.pattern,
        description: row.description,
        inquiryId: row.watch?.inquiryId ?? null,
        inquiryTitle: row.watch?.inquiry.title ?? null,
      };
    };
  }

  // ─── Planning ─────────────────────────────────────────────────────────────

  private async planRules(
    db: Db,
    caseId: string,
    rules: CleanupRules,
  ): Promise<Plan> {
    const plan: Plan = { findings: [], evidence: [] };
    const evidence = await db.caseEvidence.findMany({
      where: { caseId },
      include: { findings: true },
    });
    if (evidence.length === 0) return plan;

    const leaving = new Set<string>();
    if (rules.removeGoneAssets) {
      const assetIds = evidence
        .filter((e) => e.entityType === 'asset')
        .map((e) => e.entityId);
      const live = await this.inChunks(assetIds, (ids) =>
        db.asset.findMany({
          where: { id: { in: ids } },
          select: { id: true, status: true },
        }),
      );
      const byId = new Map(live.map((a) => [a.id, a]));
      for (const ev of evidence) {
        if (ev.entityType !== 'asset') continue;
        const row = byId.get(ev.entityId);
        const state = assetRemoval(
          row ? { status: String(row.status) } : null,
          rules,
        );
        if (!state) continue;
        plan.evidence.push({ ev, reason: 'ASSET_GONE', state });
        leaving.add(ev.id);
      }
    }

    if (rules.removeGoneFindings || rules.removeResolvedFindings) {
      // Findings of evidence that is leaving go with it, counted there.
      const staying = evidence.filter((ev) => !leaving.has(ev.id));
      const live = await this.inChunks(
        staying.flatMap((ev) => ev.findings.map((f) => f.findingId)),
        (ids) =>
          db.finding.findMany({
            where: { id: { in: ids } },
            select: { id: true, status: true, resolutionReason: true },
          }),
      );
      const byId = new Map(live.map((f) => [f.id, f]));
      for (const ev of staying) {
        for (const cf of ev.findings) {
          const row = byId.get(cf.findingId);
          const decision = findingRemoval(
            row
              ? {
                  status: String(row.status),
                  resolutionReason: row.resolutionReason,
                }
              : null,
            rules,
          );
          if (!decision) continue;
          plan.findings.push({
            cf: {
              ...cf,
              caseEvidence: { entityId: ev.entityId, label: ev.label },
            },
            reason: decision.reason,
            ...('state' in decision ? { state: decision.state } : {}),
          });
        }
      }
      // An asset the case held only for those findings goes with the last of
      // them — see emptiedByCleanup for what stays.
      const leavingFindings = new Set(plan.findings.map((r) => r.cf.id));
      for (const ev of staying) {
        if (emptiedByCleanup(ev, leavingFindings)) {
          plan.evidence.push({ ev, reason: 'EMPTIED' });
        }
      }
    }
    return plan;
  }

  /**
   * The case's findings the filters match. A case-wide filter reads every
   * finding; a watch's filter only the findings that watch answers, which
   * takes the live row (a deleted finding answers no watch any more).
   *
   * `everyMatch` reports one row per (finding, matching filter) — the
   * preview's per-rule counts — instead of the first filter only.
   */
  async planFilterRemovals(
    db: Db,
    caseId: string,
    filters: FilterForPlan[],
    opts: { everyMatch?: boolean } = {},
  ): Promise<FindingRemovalPlan[]> {
    if (filters.length === 0) return [];
    const compiled = compileFindingFilters(filters);
    const caseWide = compiled.filter((f) => f.rule.caseInquiryId === null);
    const scoped = new Map<string, CompiledFindingFilter[]>();
    for (const f of compiled) {
      const linkId = f.rule.caseInquiryId;
      if (!linkId) continue;
      scoped.set(linkId, [...(scoped.get(linkId) ?? []), f]);
    }

    const cited = await db.caseFinding.findMany({
      where: { caseId },
      include: { caseEvidence: { select: { entityId: true, label: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (cited.length === 0) return [];
    const live = await this.inChunks(
      cited.map((c) => c.findingId),
      (ids) =>
        db.finding.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            sourceId: true,
            detectorType: true,
            customDetectorKey: true,
            findingType: true,
            matchedContent: true,
          },
        }),
    );
    const liveById = new Map(live.map((f) => [f.id, f]));
    const matchers =
      scoped.size > 0
        ? await this.watchMatchers(db, [...scoped.keys()])
        : new Map<string, CompiledMatcher>();

    const removals: FindingRemovalPlan[] = [];
    for (const cf of cited) {
      const row = liveById.get(cf.findingId);
      const subject: FilterableFinding = {
        findingType: row?.findingType ?? cf.label,
        matchedContent: row?.matchedContent ?? cf.matchedContent,
      };
      const hits: CompiledFindingFilter[] = [];
      for (const f of caseWide) if (f.test(subject)) hits.push(f);
      if (row && (opts.everyMatch || hits.length === 0)) {
        for (const [linkId, list] of scoped) {
          if (!matchers.get(linkId)?.matches(row)) continue;
          for (const f of list) if (f.test(subject)) hits.push(f);
        }
      }
      const reported = opts.everyMatch ? hits : hits.slice(0, 1);
      for (const hit of reported) {
        removals.push({ cf, reason: 'FILTER', filterId: hit.rule.id });
      }
    }
    return removals;
  }

  private async watchMatchers(
    db: Db,
    linkIds: string[],
  ): Promise<Map<string, CompiledMatcher>> {
    const links = await db.caseInquiry.findMany({
      where: { id: { in: linkIds } },
      select: { id: true, inquiry: { select: MATCHER_SELECT } },
    });
    await ensureTermSnapshotFor(
      this.prisma,
      links.map((l) => l.inquiry),
    );
    return new Map(links.map((l) => [l.id, new CompiledMatcher(l.inquiry)]));
  }

  // ─── Execution ────────────────────────────────────────────────────────────

  private async execute(
    tx: Db,
    caseId: string,
    plan: Plan,
    ctx: ExecuteContext,
  ): Promise<CleanupOutcome> {
    if (plan.findings.length === 0 && plan.evidence.length === 0)
      return NOTHING;
    const now = new Date();
    const board = await tx.caseBoard.findUnique({
      where: { caseId },
      select: { id: true },
    });
    const evidenceIds = [
      ...new Set([
        ...plan.evidence.map((e) => e.ev.id),
        ...plan.findings.map((r) => r.cf.caseEvidenceId),
      ]),
    ];
    const itemByEvidence = board
      ? await this.itemsByEvidence(tx, board.id, evidenceIds)
      : new Map<string, CaseBoardItem>();
    // Board items as this pass leaves them: a finding's undo state and an
    // asset's tombstone can land on the same item, the one after the other.
    const contents = new Map<string, Record<string, unknown>>();
    const contentOf = (item: CaseBoardItem) =>
      contents.get(item.id) ?? asRecord(item.content) ?? {};
    const leavingEvidence = new Set(plan.evidence.map((e) => e.ev.id));
    /** The live item of evidence that stays on the board, for "Show on board". */
    const stayingItem = (evidenceId: string) =>
      leavingEvidence.has(evidenceId)
        ? undefined
        : itemByEvidence.get(evidenceId);

    // Findings first: each keeps its undo state on its asset's item, so it
    // comes back exactly (note, stances) if someone attaches it again — also
    // when the asset itself leaves right after, emptied by a filter.
    if (plan.findings.length > 0) {
      if (board) {
        const byEvidence = new Map<string, FindingRemovalPlan[]>();
        for (const r of plan.findings) {
          const list = byEvidence.get(r.cf.caseEvidenceId) ?? [];
          list.push(r);
          byEvidence.set(r.cf.caseEvidenceId, list);
        }
        for (const [evidenceId, removals] of byEvidence) {
          const item = itemByEvidence.get(evidenceId);
          if (!item || item.deletedAt) continue;
          const content = contentOf(item);
          const detached = { ...(asRecord(content.detached) ?? {}) };
          for (const r of removals) {
            detached[r.cf.findingId] = {
              ...caseFindingTombstone(r.cf),
              detachedAt: now.toISOString(),
            };
          }
          contents.set(item.id, { ...content, detached });
          await tx.caseBoardItem.update({
            where: { id: item.id },
            data: {
              content: toJson(contents.get(item.id)!),
              updatedBy: ctx.actor ?? null,
            },
          });
          // Links drawn to those rows lose their end; they come back with
          // the row if someone attaches the finding again.
          const findingIds = removals.map((r) => r.cf.findingId);
          await tx.caseBoardLink.updateMany({
            where: {
              boardId: board.id,
              deletedAt: null,
              OR: [
                { sourceItemId: item.id, sourceFindingId: { in: findingIds } },
                { targetItemId: item.id, targetFindingId: { in: findingIds } },
              ],
            },
            data: { deletedAt: now },
          });
        }
      }
      await tx.caseFinding.deleteMany({
        where: { caseId, id: { in: plan.findings.map((r) => r.cf.id) } },
      });
      for (const reason of [
        'FINDING_GONE',
        'FINDING_RESOLVED',
        'FILTER',
      ] as const) {
        const group = plan.findings.filter((r) => r.reason === reason);
        if (group.length === 0) continue;
        const items = new Set(
          group.map((r) => stayingItem(r.cf.caseEvidenceId)?.id),
        );
        const onlyItem = items.size === 1 ? [...items][0] : undefined;
        const filterIds = new Set(group.map((r) => r.filterId));
        await this.recordRemoval(
          tx,
          caseId,
          CaseActivityType.FINDINGS_AUTO_REMOVED,
          ctx,
          reason,
          {
            reason,
            ...triggerPayload(ctx.triggerFor(reason)),
            count: group.length,
            findings: group.slice(0, LIST_CAP).map((r) => ({
              caseFindingId: r.cf.id,
              findingId: r.cf.findingId,
              label: r.cf.label,
              value: clip(r.cf.matchedContent),
              severity: r.cf.severity,
              assetId: r.cf.caseEvidence.entityId,
              assetLabel: r.cf.caseEvidence.label,
              ...(stayingItem(r.cf.caseEvidenceId)
                ? { itemId: stayingItem(r.cf.caseEvidenceId)!.id }
                : {}),
              ...(r.state ? { state: r.state } : {}),
              ...(r.filterId ? { filterId: r.filterId } : {}),
            })),
            ...(group.length > LIST_CAP ? { truncated: true } : {}),
            // The asset the findings hung off stays: "Show on board" goes there.
            ...(onlyItem ? { itemId: onlyItem } : {}),
            ...(reason === 'FILTER' && ctx.filters
              ? { filters: ctx.filters.filter((f) => filterIds.has(f.id)) }
              : {}),
            ...runPayload(ctx.run),
          },
        );
      }
    }

    let findingsWithEvidence = 0;
    if (plan.evidence.length > 0) {
      if (board) {
        const leaving = plan.evidence
          .map((e) => ({ e, item: itemByEvidence.get(e.ev.id) }))
          .filter(
            (x): x is { e: EvidenceRemovalPlan; item: CaseBoardItem } =>
              !!x.item && !x.item.deletedAt,
          );
        const itemIds = leaving.map((x) => x.item.id);
        await unparentChildren(tx, board.id, itemIds);
        for (const { e, item } of leaving) {
          await tx.caseBoardItem.update({
            where: { id: item.id },
            data: {
              deletedAt: now,
              updatedBy: ctx.actor ?? null,
              content: toJson({
                ...contentOf(item),
                // An emptied asset comes back bare: its findings were filtered
                // out and stay restorable one by one (`detached`).
                tombstone: evidenceTombstone(
                  e.reason === 'FILTER_EMPTIED' || e.reason === 'EMPTIED'
                    ? { ...e.ev, findings: [] }
                    : e.ev,
                ),
              }),
            },
          });
        }
        if (itemIds.length > 0) {
          await tx.caseBoardLink.updateMany({
            where: {
              boardId: board.id,
              deletedAt: null,
              OR: [
                { sourceItemId: { in: itemIds } },
                { targetItemId: { in: itemIds } },
              ],
            },
            data: { deletedAt: now },
          });
        }
      }
      await tx.caseEvidence.deleteMany({
        where: { caseId, id: { in: plan.evidence.map((e) => e.ev.id) } },
      });
      for (const reason of [
        'ASSET_GONE',
        'FILTER_EMPTIED',
        'EMPTIED',
      ] as const) {
        const group = plan.evidence.filter((e) => e.reason === reason);
        if (group.length === 0) continue;
        // A gone asset takes its findings along; an emptied one has none left.
        const withIt =
          reason === 'ASSET_GONE'
            ? group.reduce((sum, e) => sum + e.ev.findings.length, 0)
            : 0;
        findingsWithEvidence += withIt;
        await this.recordRemoval(
          tx,
          caseId,
          CaseActivityType.EVIDENCE_AUTO_REMOVED,
          ctx,
          reason,
          {
            reason,
            ...triggerPayload(ctx.triggerFor(reason)),
            count: group.length,
            findingsRemoved: withIt,
            assets: group.slice(0, LIST_CAP).map((e) => ({
              evidenceId: e.ev.id,
              assetId: e.ev.entityId,
              label: e.ev.label ?? e.ev.entityId,
              findings: e.ev.findings.length,
              ...(e.state ? { state: e.state } : {}),
            })),
            ...(group.length > LIST_CAP ? { truncated: true } : {}),
            ...(reason === 'FILTER_EMPTIED' && ctx.filters
              ? { filters: ctx.filters }
              : {}),
            ...runPayload(ctx.run),
          },
        );
      }
    }

    let version: number | null = null;
    if (board) {
      const bumped = await tx.caseBoard.update({
        where: { id: board.id },
        data: { version: { increment: 1 } },
        select: { version: true },
      });
      version = bumped.version;
    }
    return {
      findingsRemoved: plan.findings.length,
      evidenceRemoved: plan.evidence.length,
      findingsWithEvidence,
      emptiedRemoved: plan.evidence.filter((e) => e.reason === 'FILTER_EMPTIED')
        .length,
      leftEmptyRemoved: plan.evidence.filter((e) => e.reason === 'EMPTIED')
        .length,
      version,
    };
  }

  /**
   * One removal entry. What the clean-up does by itself folds into its
   * previous entry for the same reason (CaseActivityService.recordCoalesced),
   * so a source scanning every few minutes does not write a row per scan; a
   * person's pass — a switch turned on, a filter added — is its own entry.
   */
  private async recordRemoval(
    tx: Db,
    caseId: string,
    type: CaseActivityType,
    ctx: ExecuteContext,
    reason: FindingRemovalReason | EvidenceRemovalReason,
    payload: ActivityPayload,
  ): Promise<void> {
    if (ctx.actor === CASE_CLEANUP_ACTOR) {
      await this.activity.recordCoalesced(
        caseId,
        type,
        payload,
        CASE_CLEANUP_ACTOR,
        { key: `cleanup:${reason}`, merge: mergeRemoval },
        tx,
      );
      return;
    }
    await this.activity.record(caseId, type, payload, ctx.actor, tx);
  }

  /** Tell open boards to refetch, and who took what out. */
  announce(
    caseId: string,
    outcome: CleanupOutcome,
    actor: string | undefined,
    clientId = 'case-cleanup',
  ): void {
    if (!this.events || outcome.version === null) return;
    const parts: string[] = [];
    const gone =
      outcome.evidenceRemoved -
      outcome.emptiedRemoved -
      outcome.leftEmptyRemoved;
    if (gone > 0) {
      parts.push(
        gone === 1
          ? 'took out an asset that is gone'
          : `took out ${gone} assets that are gone`,
      );
    }
    if (outcome.emptiedRemoved > 0) {
      parts.push(
        outcome.emptiedRemoved === 1
          ? 'took out an asset a filter left without findings'
          : `took out ${outcome.emptiedRemoved} assets a filter left without findings`,
      );
    }
    if (outcome.leftEmptyRemoved > 0) {
      parts.push(
        outcome.leftEmptyRemoved === 1
          ? 'took out an asset with no findings left'
          : `took out ${outcome.leftEmptyRemoved} assets with no findings left`,
      );
    }
    if (outcome.findingsRemoved > 0) {
      parts.push(
        outcome.findingsRemoved === 1
          ? 'took out a finding'
          : `took out ${outcome.findingsRemoved} findings`,
      );
    }
    if (parts.length === 0) return;
    this.events.emitChanged(caseId, {
      caseId,
      version: outcome.version,
      // Unnamed: the other boards say "Someone".
      actor:
        actor === CASE_CLEANUP_ACTOR ? 'Automatic clean-up' : (actor ?? null),
      clientId,
      summary: parts.join(' · '),
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Serialise clean-up passes on one case. NO KEY UPDATE rather than UPDATE:
   * rows that merely reference the case (activity, findings) take KEY SHARE
   * for their foreign key, and must not wait on a pass.
   */
  private async lockCase(tx: Db, caseId: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM cases WHERE id = ${caseId} FOR NO KEY UPDATE`;
    if (locked.length === 0) return null;
    return tx.case.findUnique({
      where: { id: caseId },
      select: CLEANUP_SELECT,
    });
  }

  /** The newest item per evidence row, a live one before a removed one. */
  private async itemsByEvidence(
    tx: Db,
    boardId: string,
    evidenceIds: string[],
  ): Promise<Map<string, CaseBoardItem>> {
    const items = await tx.caseBoardItem.findMany({
      where: { boardId, kind: 'EVIDENCE', refId: { in: evidenceIds } },
      orderBy: { updatedAt: 'desc' },
    });
    const map = new Map<string, CaseBoardItem>();
    for (const item of items) {
      if (!item.refId) continue;
      const current = map.get(item.refId);
      if (!current || (current.deletedAt && !item.deletedAt))
        map.set(item.refId, item);
    }
    return map;
  }

  private sampleItem(r: FindingRemovalPlan): CaseCleanupItemDto {
    return {
      reason: r.reason,
      ...(r.state ? { state: r.state } : {}),
      label: r.cf.label,
      value: clip(r.cf.matchedContent),
      assetLabel: r.cf.caseEvidence.label,
      ...(r.filterId ? { filterId: r.filterId } : {}),
    };
  }

  private async inChunks<T>(
    ids: string[],
    read: (chunk: string[]) => Promise<T[]>,
  ): Promise<T[]> {
    const unique = [...new Set(ids)];
    const out: T[] = [];
    for (let i = 0; i < unique.length; i += ID_CHUNK) {
      out.push(...(await read(unique.slice(i, i + ID_CHUNK))));
    }
    return out;
  }
}

function clip(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > VALUE_MAX ? `${value.slice(0, VALUE_MAX)}…` : value;
}

function runPayload(run: ExecuteContext['run']): Record<string, unknown> {
  if (!run) return {};
  return {
    sourceId: run.sourceId,
    ...(run.sourceName ? { sourceNames: [run.sourceName] } : {}),
    ...(run.runnerId ? { runnerId: run.runnerId } : {}),
  };
}

/** What set a pass off; `triggers` counts them once passes are merged. */
function triggerPayload(trigger: CleanupTrigger): Record<string, unknown> {
  return { trigger, triggers: { [trigger]: 1 } };
}

function numberOf(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mergeTriggers(
  previous: ActivityPayload,
  next: ActivityPayload,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of [previous, next]) {
    const counted =
      p.triggers && typeof p.triggers === 'object'
        ? (p.triggers as Record<string, unknown>)
        : typeof p.trigger === 'string'
          ? { [p.trigger]: 1 }
          : {};
    for (const [key, n] of Object.entries(counted))
      out[key] = (out[key] ?? 0) + numberOf(n);
  }
  return out;
}

/**
 * Fold one automatic pass into the entry so far: counts add up, the named
 * findings (or assets) keep the newest first, and "Show on board" survives
 * only while every pass hung off the same asset.
 */
function mergeRemoval(
  previous: ActivityPayload,
  next: ActivityPayload,
): ActivityPayload {
  const key = Array.isArray(next.assets) ? 'assets' : 'findings';
  const listed = mergeListed(previous, next, key, LIST_CAP);
  return {
    ...next,
    count: numberOf(previous.count) + numberOf(next.count),
    ...(key === 'assets'
      ? {
          findingsRemoved:
            numberOf(previous.findingsRemoved) + numberOf(next.findingsRemoved),
        }
      : {}),
    [key]: listed.list,
    truncated: listed.truncated || undefined,
    triggers: mergeTriggers(previous, next),
    sourceNames: mergeDistinct(previous, next, 'sourceNames', 10),
    itemId:
      previous.itemId && previous.itemId === next.itemId
        ? next.itemId
        : undefined,
  };
}

function toJson(
  value: Record<string, unknown> | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null
    ? Prisma.DbNull
    : (value as unknown as Prisma.InputJsonValue);
}
