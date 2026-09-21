import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Job } from 'pg-boss';
import { DetectorType, Prisma, Severity } from '@prisma/client';
import { NotificationsService } from '../notifications.service';
import {
  NotificationEvent,
  NotificationType,
} from '../types/notification.types';
import { PrismaService } from '../prisma.service';
import { renderReasons } from '../embedding/reason-labels';
import { PgBossService } from '../scheduler/pg-boss.service';
import {
  candidateWhere,
  CompiledMatcher,
  FindingCandidate,
  InquiryMatchers,
} from './inquiry-matcher';
import {
  classifyMatch,
  InquiryMatchState,
  retiredCandidateWhere,
  RunAnchor,
  RunAnchors,
} from './match-state';
import { INQUIRY_MATCH_QUEUE } from './matching.constants';
import { AI_ACTOR, OPERATOR_CREATED } from '../autopilot/autopilot.constants';
import {
  AUTO_PULL_ACTOR,
  CASE_PULL,
  CasePullPort,
} from '../cases/case-pull.port';
import { InquiryActivityService } from '../inquiry-activity.service';
import {
  PreviewDiagnosticDto,
  PreviewResponseDto,
  InquiryMatchDto,
  InquiryMatchListResponseDto,
  QueryInquiryMatchesDto,
} from '../dto/inquiry.dto';

interface FindingRow {
  id: string;
  assetId: string;
  sourceId: string;
  detectorType: DetectorType;
  customDetectorKey: string | null;
  findingType: string;
  severity: { toString(): string };
  matchedContent: string | null;
  createdAt?: Date;
  // Present only on the retired walk — the OPEN walk knows its own status and
  // would pay for three more columns on every row of the corpus to learn it.
  status?: { toString(): string };
  resolvedAt?: Date | null;
  resolutionReason?: string | null;
  asset?: { name: string; sourceType: { toString(): string } } | null;
  evidenceAnalysis?: {
    importanceScore: number;
    qualityScore: number;
    similarCount: number;
    duplicateGroupHash: string | null;
    reasons: unknown;
  } | null;
}

const FINDING_SELECT = {
  id: true,
  assetId: true,
  sourceId: true,
  detectorType: true,
  customDetectorKey: true,
  findingType: true,
  severity: true,
  matchedContent: true,
  // Newness is decided by createdAt vs the source's latest run, so every path
  // that counts matches needs it — not just the one that renders them.
  createdAt: true,
} as const;

/**
 * The retired walk's extra columns.
 *
 * Deliberately not folded into FINDING_SELECT: that one is walked across the
 * whole corpus by every counter, id-collector and probe, and `resolution_reason`
 * is a TEXT column none of them read.
 */
const RETIRED_FINDING_SELECT = {
  ...FINDING_SELECT,
  status: true,
  resolvedAt: true,
  resolutionReason: true,
} as const;

/**
 * Rows held in memory at once while walking candidates.
 *
 * Large enough that the walk is not query-bound on a corpus with millions of
 * findings, small enough that one page plus its DTOs is a rounding error
 * against the heap ceiling.
 */
const CANDIDATE_PAGE_SIZE = 2000;

const PREVIEW_CAP = 50;

/**
 * Rows per batch when a preview has to scan because regexes cannot be pushed
 * into SQL. Large enough that a big match set costs few round trips, small
 * enough that no single batch is a heap risk.
 */
const PREVIEW_SCAN_BATCH = 5000;

/**
 * Rows a leave-one-out diagnostic will scan before answering.
 *
 * The claim a diagnostic makes is "findings survive without this dimension",
 * not "exactly N do", so a full scan past this point would cost a lot to say
 * something the caller cannot act on differently.
 */
const DIAGNOSTIC_SCAN_CAP = 5000;

/**
 * Candidate rows a bounded probe will pull before giving up. Sized so the
 * autopilot's evidence floor stays cheap enough to run inside a tool call while
 * still being decisive for any matcher narrow enough to be worth monitoring.
 */
const PROBE_SCAN_LIMIT = 2000;

/**
 * Ceilings on one run's automatic pull into a linked case.
 *
 * The asset cap is the binding one: `pullFromInquiry` rebuilds lineage edges
 * once per distinct asset, so a pull is priced in assets, not findings, and it
 * runs inside the matching worker at localConcurrency 1. A run that lands more
 * than this is reported on the timeline and left for a person to pull.
 */
const AUTO_PULL_FINDING_CAP = 500;
const AUTO_PULL_ASSET_CAP = 100;

/** Labels carried on a timeline entry, so the row reads without a join. */
const TIMELINE_SAMPLES = 10;

/** Sample finding ids/values per unmonitored group. */
const UNMONITORED_SAMPLES = 5;
/** Distinct unmonitored groups reported. */
const UNMONITORED_GROUPS = 15;

/**
 * Background engine: an Inquiry is a saved query. After a source finishes
 * ingesting, the run's new findings are matched against every ACTIVE inquiry for
 * that source. Counts are stored on the Inquiry row (matchCount + newMatchCount)
 * instead of persisting individual match rows.
 */
@Injectable()
export class InquiryMatchingService {
  private readonly logger = new Logger(InquiryMatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly activity?: InquiryActivityService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  /**
   * CasesService, resolved from the whole application graph at call time rather
   * than injected — see {@link CASE_PULL} for why injecting it would hang the
   * process on boot with no error. Returns null when the token is absent, which
   * is the case in every unit test that constructs this service by hand.
   */
  private get casePull(): CasePullPort | null {
    try {
      return (
        this.moduleRef?.get<CasePullPort>(CASE_PULL, { strict: false }) ?? null
      );
    } catch {
      return null;
    }
  }

  /**
   * Registers this worker on the CURRENT namespace's pg-boss (invoked by the
   * NamespaceWorkerManager inside the namespace's CLS context).
   */
  async registerForNamespace(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(INQUIRY_MATCH_QUEUE);
    await this.pgBoss.work(
      INQUIRY_MATCH_QUEUE,
      { localConcurrency: 1 },
      (jobs) => this.handle(jobs as Job[]),
    );
    this.logger.log(`Registered worker for queue ${INQUIRY_MATCH_QUEUE}`);
  }

  private async handle(jobs: Job[]): Promise<void> {
    for (const job of jobs) {
      const data = job.data as Record<string, unknown>;
      const sourceId =
        typeof data?.sourceId === 'string' ? data.sourceId : null;
      const runnerId =
        typeof data?.runnerId === 'string' ? data.runnerId : null;
      if (!sourceId) continue;
      try {
        await this.processSourceCompletion(sourceId, runnerId);
      } catch (error) {
        this.logger.error(
          `Matching failed for source ${sourceId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    }
  }

  /**
   * The latest run per source that actually finished observing the corpus.
   *
   * This is the anchor every NEW/GONE answer is measured against, so it is
   * built ONCE per public entry point and threaded down — never per inquiry,
   * and certainly never per finding.
   *
   * STOPPED and ERROR runs are excluded deliberately. A run that did not finish
   * did not re-observe the source, so letting it move the anchor would retire
   * the newness of everything the last real scan found.
   *
   * Read from the database rather than from the job payload. The matching queue
   * coalesces on `singletonKey: sourceId` with `singletonNextSlot`, so the
   * runnerId a job carries can already be stale by the time it runs; deriving
   * the anchor here is what makes that self-healing.
   */
  private async runAnchors(sourceIds: string[]): Promise<RunAnchors> {
    const anchors = new Map<string, RunAnchor>();
    if (sourceIds.length === 0) return anchors;

    // DISTINCT ON, not Prisma `distinct`: Prisma applies distinct in the query
    // engine AFTER the rows arrive, which on this shape means every run every
    // source ever had is fetched to yield one row apiece.
    const rows = await this.prisma.$queryRaw<
      Array<{ sourceId: string; runnerId: string; startedAt: Date }>
    >(Prisma.sql`
      SELECT DISTINCT ON (source_id)
             source_id AS "sourceId",
             id        AS "runnerId",
             COALESCE(started_at, triggered_at) AS "startedAt"
      FROM runners
      WHERE source_id = ANY(${sourceIds}::text[])
        AND status IN ('COMPLETED'::"RunnerStatus", 'WARNING'::"RunnerStatus")
      ORDER BY source_id, COALESCE(started_at, triggered_at) DESC, id DESC
    `);
    for (const row of rows) {
      anchors.set(row.sourceId, {
        runnerId: row.runnerId,
        startedAt: row.startedAt,
      });
    }
    return anchors;
  }

  /** Every source an inquiry's matchers can reach, for the anchor lookup. */
  private async anchorsFor(m: InquiryMatchers): Promise<RunAnchors> {
    if (!m.matchAllSources) return this.runAnchors(m.sourceIds);
    const sources = await this.prisma.source.findMany({ select: { id: true } });
    return this.runAnchors(sources.map((source) => source.id));
  }

  /**
   * Count an inquiry's matches the same way `getLiveMatches` does.
   *
   * Both the stored counters and the /matches endpoint go through here, so they
   * cannot disagree about what a match is or what makes one new. They used to
   * apply different rules: newMatchCount incremented by every finding *this run
   * touched* — including ones merely re-detected, whose createdAt is old — while
   * /matches counted only findings created since matchesSeenAt. A re-scan that
   * re-detected 15 existing findings reported "15 new" next to "0 new".
   *
   * `total` stays OPEN-only. A retired match is reported separately rather than
   * inflating the size of the set an investigator is working through.
   */
  private async computeMatchCounts(
    m: InquiryMatchers,
    anchors: RunAnchors,
    options: { collectNewIds?: boolean } = {},
  ): Promise<{
    total: number;
    newCount: number;
    goneCount: number;
    newIds: string[];
  }> {
    // Counters only: there is no reason to hold a single row past the moment
    // it has been counted, and holding them all is what killed the process.
    let total = 0;
    let newCount = 0;
    const newIds: string[] = [];
    for await (const page of this.candidateFindingPages(m, false)) {
      total += page.rows.length;
      for (const f of page.rows) {
        if (classifyMatch(f as never, anchors) !== 'NEW') continue;
        newCount += 1;
        if (options.collectNewIds && newIds.length < AUTO_PULL_FINDING_CAP)
          newIds.push(f.id);
      }
    }

    let goneCount = 0;
    for await (const page of this.retiredFindingPages(m, anchors, false))
      goneCount += page.rows.length;

    return { total, newCount, goneCount, newIds };
  }

  /**
   * After a source run finishes, refresh each ACTIVE inquiry's counters from
   * the live match set.
   */
  async processSourceCompletion(
    sourceId: string,
    runnerId: string | null,
  ): Promise<{ landed: number }> {
    const inquiries = await this.prisma.inquiry.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ matchAllSources: true }, { sourceIds: { has: sourceId } }],
      },
      select: {
        ...this.matcherSelect,
        title: true,
        createdBy: true,
        matchCount: true,
        newMatchCount: true,
        goneMatchCount: true,
      },
    });
    if (inquiries.length === 0) return { landed: 0 };

    // One anchor build for the whole job, covering every source any matched
    // inquiry can reach — not one per inquiry, and never one per finding.
    const anchors = await this.anchorsForAll(inquiries);

    // Findings this run created, for the notification. Deliberately narrower
    // than the NEW count, which is corpus-wide: a person should be told about
    // answers THIS scan produced, not re-told about every answer still fresh.
    const created = await this.findingsCreatedByRun(sourceId, runnerId);

    let landed = 0;
    for (const q of inquiries) {
      const { total, newCount, goneCount, newIds } =
        await this.computeMatchCounts(q, anchors, {
          // A retire-driven recompute passes no runnerId. It is a bookkeeping
          // refresh, not a scan, so it must not pull anything into a case.
          collectNewIds: runnerId != null,
        });

      // Assigned, never incremented: an accumulator drifts permanently once any
      // run miscounts, and cannot be reconciled against the live set.
      if (
        total !== q.matchCount ||
        newCount !== q.newMatchCount ||
        goneCount !== q.goneMatchCount
      ) {
        await this.prisma.inquiry.update({
          where: { id: q.id },
          data: {
            matchCount: total,
            newMatchCount: newCount,
            goneMatchCount: goneCount,
          },
        });
      }

      // Only questions a person asked: the autopilot's own inquiries are its
      // working set and would turn every run into a notification.
      if (created.length > 0 && q.createdBy !== AI_ACTOR) {
        const matcher = new CompiledMatcher(q);
        const added = created.filter((f) => matcher.matches(f)).length;
        if (added > 0) {
          await this.notifyNewMatches(q, added, { newCount, total, sourceId });
        }
      }

      if (runnerId) {
        await this.recordRunDeltas(q, {
          sourceId,
          runnerId,
          newIds,
          goneCount,
        });
        await this.autoPullToCases(q, newIds, { sourceId, runnerId });
      }
      landed += newCount;
    }

    if (landed > 0)
      this.logger.log(
        `Recorded ${landed} new match(es) for source ${sourceId}`,
      );
    return { landed };
  }

  /** The union of every source the given inquiries' matchers can reach. */
  private async anchorsForAll(
    inquiries: Array<Pick<InquiryMatchers, 'matchAllSources' | 'sourceIds'>>,
  ): Promise<RunAnchors> {
    if (inquiries.some((q) => q.matchAllSources)) {
      const sources = await this.prisma.source.findMany({
        select: { id: true },
      });
      return this.runAnchors(sources.map((source) => source.id));
    }
    const ids = new Set<string>();
    for (const q of inquiries) for (const id of q.sourceIds) ids.add(id);
    return this.runAnchors(Array.from(ids));
  }

  /**
   * Write this run's deltas to the inquiry's timeline.
   *
   * The live NEW/GONE state expires the next time the source runs, so without
   * this a scan's effect on a standing question leaves no trace at all once the
   * next one lands. Labels are denormalised onto the row so the timeline reads
   * without joining back to findings that may since have been retired.
   */
  private async recordRunDeltas(
    q: { id: string; title: string },
    run: {
      sourceId: string;
      runnerId: string;
      newIds: string[];
      goneCount: number;
    },
  ): Promise<void> {
    if (!this.activity) return;
    if (run.newIds.length > 0) {
      const labels = await this.prisma.finding.findMany({
        where: { id: { in: run.newIds.slice(0, TIMELINE_SAMPLES) } },
        select: { findingType: true },
      });
      await this.activity.tryRecord(q.id, 'MATCHES_LANDED', {
        sourceId: run.sourceId,
        runnerId: run.runnerId,
        count: run.newIds.length,
        sampleLabels: labels.map((l) => l.findingType),
      });
    }
    if (run.goneCount > 0) {
      await this.activity.tryRecord(q.id, 'MATCHES_RETIRED', {
        sourceId: run.sourceId,
        runnerId: run.runnerId,
        count: run.goneCount,
      });
    }
  }

  /**
   * Copy this run's new matches into every linked case that asked for them.
   *
   * Bounded by ASSETS, not findings: `pullFromInquiry` rebuilds lineage edges
   * once per distinct asset, and this runs inside the matching worker at
   * localConcurrency 1, so an unbounded pull would stall matching for every
   * other inquiry in the workspace. A run that exceeds the cap says so on the
   * timeline and leaves the remainder for a person.
   *
   * Every failure is swallowed: the counters are already committed, and a case
   * that could not be topped up must not fail the run or have it retried.
   */
  private async autoPullToCases(
    q: { id: string; title: string },
    newIds: string[],
    run: { sourceId: string; runnerId: string },
  ): Promise<void> {
    if (newIds.length === 0) return;
    const pull = this.casePull;
    if (!pull) return;

    const links = await this.prisma.caseInquiry.findMany({
      where: {
        inquiryId: q.id,
        autoPull: true,
        case: { status: { notIn: ['CLOSED', 'ARCHIVED'] } },
      },
      select: { caseId: true, case: { select: { title: true } } },
    });
    if (links.length === 0) return;

    // Price the pull in assets before committing to it.
    const assets = await this.prisma.finding.findMany({
      where: { id: { in: newIds } },
      select: { id: true, assetId: true },
    });
    const seen = new Set<string>();
    const admitted: string[] = [];
    for (const f of assets) {
      if (!seen.has(f.assetId)) {
        if (seen.size >= AUTO_PULL_ASSET_CAP) continue;
        seen.add(f.assetId);
      }
      admitted.push(f.id);
    }
    const capped = admitted.length < newIds.length;

    for (const link of links) {
      try {
        const res = await pull.pullFromInquiry(
          link.caseId,
          { inquiryId: q.id, findingIds: admitted },
          AUTO_PULL_ACTOR,
        );
        if (res.pulled === 0) continue;
        await this.activity?.tryRecord(
          q.id,
          'AUTO_PULLED',
          {
            caseId: link.caseId,
            caseTitle: link.case.title,
            pulled: res.pulled,
            sourceId: run.sourceId,
            runnerId: run.runnerId,
            ...(capped ? { capped: true, available: newIds.length } : {}),
          },
          AUTO_PULL_ACTOR,
        );
      } catch (error) {
        this.logger.warn(
          `Auto-pull into case ${link.caseId} from inquiry ${q.id} failed: ${String(error)}`,
        );
      }
    }
  }

  /** OPEN findings first created by this run (re-detections keep their createdAt). */
  private async findingsCreatedByRun(
    sourceId: string,
    runnerId: string | null,
  ) {
    if (!runnerId) return [];
    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: { startedAt: true, triggeredAt: true },
    });
    const since = runner?.startedAt ?? runner?.triggeredAt;
    if (!since) return [];
    return this.prisma.finding.findMany({
      where: { sourceId, runnerId, status: 'OPEN', createdAt: { gte: since } },
      select: FINDING_SELECT,
    });
  }

  /**
   * Tell someone a standing question has new answers. Matching used to update
   * the counters silently, so an early-warning inquiry ("insolvencies +30 %
   * year on year") warned no one until an operator happened to open it
   * (GENESIS journal §13). Raised only for findings the run created, so a
   * run that merely re-detects stays quiet.
   */
  private async notifyNewMatches(
    inquiry: { id: string; title: string },
    added: number,
    counts: { newCount: number; total: number; sourceId: string },
  ): Promise<void> {
    if (!this.notifications) return;
    try {
      await this.notifications.create({
        type: NotificationType.FINDING,
        event: NotificationEvent.INQUIRY_NEW_MATCHES,
        severity: Severity.MEDIUM,
        title: `New matches: ${inquiry.title}`,
        message:
          `${added} new finding(s) answer "${inquiry.title}" ` +
          `(${counts.newCount} from the latest run, ${counts.total} in total).`,
        sourceId: counts.sourceId,
        actionUrl: `/investigations/inquiries/${inquiry.id}`,
        isImportant: true,
        metadata: {
          inquiryId: inquiry.id,
          added,
          newCount: counts.newCount,
          total: counts.total,
        },
      });
    } catch (error) {
      // Counters are already stored; a failed notification must not fail matching.
      this.logger.warn(
        `Failed to notify new matches for inquiry ${inquiry.id}: ${String(error)}`,
      );
    }
  }

  /**
   * Find an inquiry with a genuinely new match in one completed runner.
   *
   * Stored `newMatchCount` is corpus-wide and stays positive for as long as the
   * latest run's answers are fresh, so it cannot decide whether THIS particular
   * scan should bypass corpus coalescing. This live check applies the canonical
   * matcher to only this runner's findings, against the same run anchor the
   * counters and the API use — one definition of new in one service, which is
   * exactly what this file lost the last time it had two.
   */
  async findNewInquiryMatchForRunner(args: {
    sourceId: string;
    runnerId: string;
    createdByNot: string;
  }): Promise<{ id: string; title: string } | null> {
    const inquiries = await this.prisma.inquiry.findMany({
      where: {
        status: 'ACTIVE',
        AND: [
          { OR: [...OPERATOR_CREATED.OR] },
          {
            OR: [
              { matchAllSources: true },
              { sourceIds: { has: args.sourceId } },
            ],
          },
        ],
      },
      select: {
        ...this.matcherSelect,
        title: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (inquiries.length === 0) return null;

    const findings = await this.prisma.finding.findMany({
      where: {
        sourceId: args.sourceId,
        runnerId: args.runnerId,
        status: 'OPEN',
      },
      select: FINDING_SELECT,
    });
    if (findings.length === 0) return null;

    // Only this one source is in play, so the anchor lookup is a single row.
    const anchors = await this.runAnchors([args.sourceId]);

    for (const inquiry of inquiries) {
      const matcher = new CompiledMatcher(inquiry);
      if (
        findings.some(
          (finding) =>
            matcher.matches(finding) &&
            classifyMatch(
              { ...finding, sourceId: args.sourceId, status: 'OPEN' },
              anchors,
            ) === 'NEW',
        )
      ) {
        return { id: inquiry.id, title: inquiry.title };
      }
    }
    return null;
  }

  /**
   * Re-evaluate every current finding against a single inquiry. Seeds a newly
   * created inquiry with existing findings and refreshes all three counters.
   *
   * This used to write `newMatchCount: 0`, on the reasoning that a rematch is
   * "the fresh baseline". Under the run-anchored definition there is no
   * baseline to reset: NEW is a pure function of the corpus and the latest run.
   * Zeroing it here would make every inquiry report no new matches at the
   * moment of its creation — which is precisely when its answers are freshest —
   * because create and every matcher edit both come through here.
   */
  async rematchInquiry(inquiryId: string): Promise<{ landed: number }> {
    const q = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: this.matcherSelect,
    });
    if (!q) return { landed: 0 };
    const anchors = await this.anchorsFor(q);
    const { total, newCount, goneCount } = await this.computeMatchCounts(
      q,
      anchors,
    );
    await this.prisma.inquiry.update({
      where: { id: inquiryId },
      data: {
        matchCount: total,
        newMatchCount: newCount,
        goneMatchCount: goneCount,
      },
    });
    return { landed: total };
  }

  /**
   * Return live matching findings for an inquiry (used by listMatches endpoint).
   * Matching is computed in-app (regex matchers), so filters and pagination are
   * applied after the match pass — the page envelope keeps responses bounded.
   */
  async getLiveMatches(
    inquiryId: string,
    query: QueryInquiryMatchesDto = {},
  ): Promise<InquiryMatchListResponseDto> {
    const skip = Math.max(0, Number(query.skip ?? 0) || 0);
    const limit = Math.min(Math.max(1, Number(query.limit ?? 50) || 50), 200);
    const empty = {
      items: [],
      total: 0,
      newCount: 0,
      goneCount: 0,
      skip,
      limit,
    };

    const q = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: { ...this.matcherSelect, goneMatchCount: true },
    });
    if (!q) return empty;
    const anchors = await this.anchorsFor(q);

    const term =
      typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';
    const severities = (
      Array.isArray(query.severity)
        ? query.severity
        : query.severity
          ? [query.severity]
          : []
    ).map((s) => String(s).toUpperCase());
    const states = this.requestedStates(query);

    const passesFilters = (match: InquiryMatchDto): boolean => {
      if (
        term.length > 0 &&
        !(
          match.label.toLowerCase().includes(term) ||
          (match.assetName ?? '').toLowerCase().includes(term) ||
          (match.matchedContent ?? '').toLowerCase().includes(term)
        )
      ) {
        return false;
      }
      return (
        severities.length === 0 ||
        severities.includes((match.severity ?? '').toUpperCase())
      );
    };

    // Only the requested page is ever retained. The counters below are still
    // exact — every match is visited — but the sort no longer needs the whole
    // match set resident, which on a large workspace was millions of DTOs.
    const wanted = skip + limit;
    const ranked: InquiryMatchDto[] = [];
    let total = 0;
    let newCount = 0;
    let goneCount = 0;

    for await (const page of this.candidateFindingPages(q, true)) {
      for (const f of page.rows) {
        const state = classifyMatch(f as never, anchors) ?? 'ONGOING';
        const match = this.toMatchDto(f, state);
        if (!passesFilters(match)) continue;
        // Counted before the state filter narrows the set, so "3 new" stays the
        // same number whether or not the caller is filtering to new.
        if (state === 'NEW') newCount += 1;
        if (!states.has(state)) continue;

        total += 1;
        this.keepTopMatch(ranked, match, wanted);
      }
    }

    // The retired walk is opt-in. It is cheap, but it must never run by
    // default: `getLiveMatches` feeds case leads, the agent's evidence sampler
    // and — through `getMatchingFindingIds` — the pull into a case, and every
    // one of those would then be handed findings that no longer exist.
    if (states.has('GONE')) {
      for await (const page of this.retiredFindingPages(q, anchors, true)) {
        for (const f of page.rows) {
          const match = this.toMatchDto(f, 'GONE');
          if (!passesFilters(match)) continue;
          goneCount += 1;
          total += 1;
          this.keepTopMatch(ranked, match, wanted);
        }
      }
    } else {
      // The stored counter, refreshed by the last matching pass. Enough for a
      // badge saying the tab is worth opening; opening it does the real walk.
      goneCount = q.goneMatchCount;
    }

    return {
      items: ranked.slice(skip, skip + limit),
      total,
      newCount,
      goneCount,
      skip,
      limit,
    };
  }

  /**
   * Which states the caller wants back, defaulting to the live ones.
   *
   * GONE is never included by default — see the retired walk in
   * `getLiveMatches`. `onlyNew` is the pre-state spelling of `state: ['NEW']`
   * and is still honoured, including as the string a query parameter arrives as.
   */
  private requestedStates(
    query: QueryInquiryMatchesDto,
  ): ReadonlySet<InquiryMatchState> {
    const raw = Array.isArray(query.state)
      ? query.state
      : query.state
        ? [query.state]
        : [];
    const asked = new Set<InquiryMatchState>(
      raw
        .map((v) => String(v).toUpperCase())
        .filter(
          (v): v is InquiryMatchState =>
            v === 'NEW' || v === 'ONGOING' || v === 'GONE',
        ),
    );
    if (asked.size > 0) return asked;
    if (query.onlyNew === true || String(query.onlyNew) === 'true')
      return new Set<InquiryMatchState>(['NEW']);
    return new Set<InquiryMatchState>(['NEW', 'ONGOING']);
  }

  /**
   * Importance-first: matches are a triage queue, not a log. Unanalyzed rows
   * keep their recency order below the ranked ones.
   */
  private static compareMatches(
    a: InquiryMatchDto,
    b: InquiryMatchDto,
  ): number {
    const ai = a.ranking?.importance ?? -1;
    const bi = b.ranking?.importance ?? -1;
    if (ai !== bi) return bi - ai;
    return (
      (b.matchedAt instanceof Date ? b.matchedAt.getTime() : 0) -
      (a.matchedAt instanceof Date ? a.matchedAt.getTime() : 0)
    );
  }

  /**
   * Insert into a descending-ranked buffer holding at most `capacity` entries.
   *
   * Equivalent to sorting everything and slicing, without holding everything:
   * a candidate that cannot displace the current worst kept entry cannot appear
   * on the requested page either.
   */
  private keepTopMatch(
    ranked: InquiryMatchDto[],
    match: InquiryMatchDto,
    capacity: number,
  ): void {
    if (capacity <= 0) return;
    if (
      ranked.length >= capacity &&
      InquiryMatchingService.compareMatches(match, ranked[capacity - 1]) >= 0
    ) {
      return;
    }
    let low = 0;
    let high = ranked.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (InquiryMatchingService.compareMatches(match, ranked[mid]) < 0)
        high = mid;
      else low = mid + 1;
    }
    ranked.splice(low, 0, match);
    if (ranked.length > capacity) ranked.length = capacity;
  }

  private toMatchDto(f: FindingRow, state: InquiryMatchState): InquiryMatchDto {
    return {
      findingId: f.id,
      label: f.findingType,
      severity: String(f.severity),
      detectorType: String(f.detectorType),
      matchedContent: f.matchedContent ?? undefined,
      assetId: f.assetId,
      assetName: f.asset?.name,
      sourceType: f.asset ? String(f.asset.sourceType) : undefined,
      matchedAt: f.createdAt ?? new Date(),
      state,
      // Kept as the pre-state spelling of the same fact, for callers generated
      // against the older client.
      isNew: state === 'NEW',
      goneReason:
        state === 'GONE' ? (f.resolutionReason ?? undefined) : undefined,
      ranking: f.evidenceAnalysis
        ? {
            importance: f.evidenceAnalysis.importanceScore,
            quality: f.evidenceAnalysis.qualityScore,
            similarCount: f.evidenceAnalysis.similarCount,
            duplicateGroupHash: f.evidenceAnalysis.duplicateGroupHash,
            reasons: renderReasons(f.evidenceAnalysis.reasons),
            coverage: 'analyzed' as const,
          }
        : {
            similarCount: 0,
            reasons: [],
            coverage: 'pending' as const,
          },
    };
  }

  /**
   * Classify a KNOWN set of findings against a set of inquiries.
   *
   * The bounded counterpart of the candidate walk, for callers that already
   * hold the findings they care about — the case graph holds a few hundred
   * nodes and wants to badge the fresh ones. Walking every match of every
   * linked inquiry to answer that would be the whole corpus for a question
   * about one screenful.
   *
   * A finding watched by several of the case's inquiries reports the most
   * notable state: NEW over GONE over ONGOING.
   */
  async matchStatesForFindings(
    inquiryIds: string[],
    findingIds: string[],
  ): Promise<Map<string, InquiryMatchState>> {
    const states = new Map<string, InquiryMatchState>();
    if (inquiryIds.length === 0 || findingIds.length === 0) return states;

    const inquiries = await this.prisma.inquiry.findMany({
      where: { id: { in: inquiryIds } },
      select: this.matcherSelect,
    });
    if (inquiries.length === 0) return states;

    const findings = await this.prisma.finding.findMany({
      where: { id: { in: findingIds } },
      select: RETIRED_FINDING_SELECT,
    });
    if (findings.length === 0) return states;

    const anchors = await this.anchorsForAll(inquiries);
    const rank: Record<InquiryMatchState, number> = {
      NEW: 3,
      GONE: 2,
      ONGOING: 1,
    };

    for (const inquiry of inquiries) {
      const matcher = new CompiledMatcher(inquiry);
      for (const f of findings) {
        if (!matcher.matches(f)) continue;
        const state = classifyMatch(
          {
            sourceId: f.sourceId,
            createdAt: f.createdAt,
            status: String(f.status),
            resolvedAt: f.resolvedAt,
            resolutionReason: f.resolutionReason,
          },
          anchors,
        );
        if (!state) continue;
        const current = states.get(f.id);
        if (!current || rank[state] > rank[current]) states.set(f.id, state);
      }
    }
    return states;
  }

  /**
   * When the run that this inquiry's NEW and GONE are measured against started.
   *
   * The most recent anchor across every source in scope — so a reader can see
   * what "new" currently means without inferring it from the counters.
   */
  async latestRunAt(m: InquiryMatchers): Promise<Date | null> {
    const anchors = await this.anchorsFor(m);
    let latest: Date | null = null;
    for (const anchor of anchors.values()) {
      if (!latest || anchor.startedAt.getTime() > latest.getTime())
        latest = anchor.startedAt;
    }
    return latest;
  }

  /** Return live matching finding IDs for an inquiry (used by pullFromInquiry). */
  async getMatchingFindingIds(inquiryId: string): Promise<string[]> {
    const q = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: this.matcherSelect,
    });
    if (!q) return [];
    // Ids only. The full rows carry `matched_content` and eight other columns
    // apiece; the caller needs none of it.
    const ids: string[] = [];
    for await (const page of this.candidateFindingPages(q, false))
      for (const row of page.rows) ids.push(row.id);
    return ids;
  }

  /**
   * High-importance open findings that NO active inquiry is watching.
   *
   * The coverage the harness already reported was about SOURCES scanned. There
   * was nothing anywhere about findings *monitored*, and the difference showed:
   * on a live instance 250 findings scored above the high-importance bar while
   * a single inquiry matched anything at all, and the inquiry agent spent every
   * cycle re-reading its own two artifacts because the mission text pushes
   * hard toward "avoid duplicates, prefer enriching" and nothing pushed the
   * other way. This is the signal that was missing: evidence with no monitor.
   *
   * Every active inquiry's matcher is compiled once and applied in memory, so
   * this costs two queries rather than a preview per inquiry.
   */
  async unmonitoredFindings(
    minImportance: number,
    limit: number,
  ): Promise<{
    total: number;
    groups: Array<{
      detectorType: string;
      customDetectorKey: string | null;
      findingType: string;
      count: number;
      topImportance: number;
      sampleFindingIds: string[];
      sampleValues: string[];
    }>;
  }> {
    const [candidates, inquiries] = await Promise.all([
      this.prisma.finding.findMany({
        where: { status: 'OPEN', importanceScore: { gte: minImportance } },
        orderBy: { importanceScore: 'desc' },
        take: limit,
        select: {
          id: true,
          sourceId: true,
          detectorType: true,
          findingType: true,
          customDetectorKey: true,
          matchedContent: true,
          importanceScore: true,
        },
      }),
      this.prisma.inquiry.findMany({
        where: { status: 'ACTIVE' },
        select: this.matcherSelect,
      }),
    ]);

    const matchers = inquiries.map((q) => new CompiledMatcher(q));
    const unmatched = candidates.filter(
      (f) => !matchers.some((m) => m.matches(f)),
    );

    const byGroup = new Map<
      string,
      {
        detectorType: string;
        customDetectorKey: string | null;
        findingType: string;
        count: number;
        topImportance: number;
        sampleFindingIds: string[];
        sampleValues: string[];
      }
    >();
    for (const f of unmatched) {
      const key = `${f.detectorType}|${f.customDetectorKey ?? ''}|${f.findingType}`;
      let group = byGroup.get(key);
      if (!group) {
        group = {
          detectorType: String(f.detectorType),
          customDetectorKey: f.customDetectorKey,
          findingType: f.findingType,
          count: 0,
          topImportance: 0,
          sampleFindingIds: [],
          sampleValues: [],
        };
        byGroup.set(key, group);
      }
      group.count++;
      group.topImportance = Math.max(group.topImportance, f.importanceScore);
      if (group.sampleFindingIds.length < UNMONITORED_SAMPLES) {
        group.sampleFindingIds.push(f.id);
        if (f.matchedContent) {
          group.sampleValues.push(f.matchedContent.slice(0, 120));
        }
      }
    }

    return {
      total: unmatched.length,
      groups: [...byGroup.values()]
        .sort((a, b) => b.topImportance - a.topImportance)
        .slice(0, UNMONITORED_GROUPS),
    };
  }

  /**
   * Which of these findings an ACTIVE inquiry is watching, and which inquiries.
   *
   * The inverse of `unmonitoredFindings`, and the primitive behind two rules
   * that both turn on the same question — "is anyone relying on this finding?":
   * the ingest path must not auto-resolve watched evidence when its detector
   * leaves the config, and the autopilot must be told what a config change
   * would cost before it makes one.
   *
   * Findings absent from the returned map are watched by nobody. Ids that no
   * longer exist are simply absent — this never throws on a stale id.
   */
  async watchedBy(findingIds: string[]): Promise<Map<string, string[]>> {
    if (findingIds.length === 0) return new Map();
    const findings = await this.prisma.finding.findMany({
      where: { id: { in: findingIds } },
      select: FINDING_SELECT,
    });
    return this.watchersForFindings(findings);
  }

  /**
   * `watchedBy` for callers that already hold the finding rows.
   *
   * The ingest path has tens of thousands of them in memory when a detector
   * leaves a config, and turning those back into an `IN (…)` list of 44k ids
   * just to re-read what it already has would be the expensive way to ask a
   * cheap question. One query for the active inquiries, then match in memory —
   * the same shape `unmonitoredFindings` uses.
   */
  async watchersForFindings(
    findings: Array<FindingCandidate & { id: string }>,
  ): Promise<Map<string, string[]>> {
    const watched = new Map<string, string[]>();
    if (findings.length === 0) return watched;

    const inquiries = await this.prisma.inquiry.findMany({
      where: { status: 'ACTIVE' },
      select: this.matcherSelect,
    });
    if (inquiries.length === 0) return watched;

    const matchers = inquiries.map(
      (q) => [q.id, new CompiledMatcher(q)] as const,
    );
    for (const finding of findings) {
      const hits = matchers
        .filter(([, m]) => m.matches(finding))
        .map(([id]) => id);
      if (hits.length > 0) watched.set(finding.id, hits);
    }
    return watched;
  }

  /**
   * Bounded "what would this matcher select?" probe.
   *
   * `preview` loads every candidate row before regex-filtering in app code —
   * fine for a one-off operator request, not fine for the autopilot's evidence
   * floor, which runs this on every `inquiries.create` and again per duplicate
   * candidate. On a corpus with ~100k open findings that was up to six
   * unbounded full-table loads inside a single LLM tool call, on a service with
   * a heap ceiling.
   *
   * `exhausted` is the honest part: false means the scan cap was hit and the
   * answer is "no match in the first `scanLimit` candidates", NOT "no match".
   * Callers must not report a bounded miss as a definitive zero.
   */
  async probeMatches(
    matchers: InquiryMatchers,
    scanLimit = PROBE_SCAN_LIMIT,
  ): Promise<{ findingIds: string[]; scanned: number; exhausted: boolean }> {
    const findingIds: string[] = [];
    let scanned = 0;
    for await (const page of this.candidateFindingPages(
      matchers,
      false,
      scanLimit,
    )) {
      scanned += page.scanned;
      for (const row of page.rows) findingIds.push(row.id);
    }
    return {
      findingIds,
      scanned,
      // Candidates scanned, not matches found. Comparing the *filtered* count
      // against the cap declared a scan exhausted whenever the regex rejected
      // anything — which is nearly always — turning "no match in the first
      // `scanLimit` candidates" into a definitive zero, the exact confusion
      // the contract above warns callers about.
      exhausted: scanned < scanLimit,
    };
  }

  /** Compute (without persisting) the findings a matcher config currently selects. */
  async preview(matchers: InquiryMatchers): Promise<PreviewResponseDto> {
    const rows = await this.previewRows(matchers);
    const sample: InquiryMatchDto[] = rows.sample.map((f) => ({
      findingId: f.id,
      label: f.findingType,
      severity: String(f.severity),
      detectorType: String(f.detectorType),
      matchedContent: f.matchedContent ?? undefined,
      assetId: f.assetId,
      assetName: f.asset?.name,
      sourceType: f.asset ? String(f.asset.sourceType) : undefined,
      matchedAt: new Date(),
      // A preview answers "what would this matcher select", before any inquiry
      // exists to measure newness against. ONGOING is the neutral answer; the
      // alternative would be claiming a run relationship there isn't one.
      state: 'ONGOING' as const,
      isNew: false,
    }));
    return {
      total: rows.total,
      sample,
      diagnostics:
        rows.total === 0 ? await this.diagnoseEmptyPreview(matchers) : [],
    };
  }

  /**
   * Why a preview returned nothing.
   *
   * A total of zero is ambiguous in the worst possible way: an inquiry with a
   * wrong matcher and an inquiry with nothing to match are indistinguishable,
   * and both look like a finished, working question. Two real inquiries sat at
   * zero for hours while their detector produced findings the entire time.
   *
   * The method is leave-one-out: for each configured dimension, count what
   * would match if that one dimension were dropped. A dimension whose removal
   * unlocks findings is the one doing the eliminating, and it is named. Only
   * runs when the answer is already zero, so the cost is paid exactly when it
   * buys something.
   */
  private async diagnoseEmptyPreview(
    m: InquiryMatchers,
  ): Promise<PreviewDiagnosticDto[]> {
    const diagnostics: PreviewDiagnosticDto[] = [];

    const countWith = async (override: Partial<InquiryMatchers>) => {
      const relaxed: InquiryMatchers = { ...m, ...override };
      const where = candidateWhere(relaxed);
      if (
        relaxed.findingTypeRegex.length === 0 &&
        relaxed.findingValueRegex.length === 0
      ) {
        return this.prisma.finding.count({ where });
      }
      const matcher = new CompiledMatcher(relaxed);
      // Bounded: this is a diagnostic, and "some findings survive without this
      // dimension" is the whole claim — an exact number past the cap would cost
      // a full scan to say something the caller cannot act on differently.
      const rows = await this.prisma.finding.findMany({
        where,
        select: {
          id: true,
          sourceId: true,
          detectorType: true,
          customDetectorKey: true,
          findingType: true,
          matchedContent: true,
        },
        take: DIAGNOSTIC_SCAN_CAP,
      });
      return rows.filter((r) => matcher.matches(r as FindingCandidate)).length;
    };

    const corpus = await this.prisma.finding.count({
      where: { status: 'OPEN' },
    });
    if (corpus === 0) {
      return [
        {
          dimension: 'corpus',
          survivingWithout: 0,
          message:
            'There are no open findings at all, so no matcher could match ' +
            'anything. Run a scan first.',
        },
      ];
    }

    if (!m.matchAllSources && m.sourceIds.length > 0) {
      const without = await countWith({ matchAllSources: true, sourceIds: [] });
      if (without > 0) {
        diagnostics.push({
          dimension: 'sources',
          survivingWithout: without,
          message:
            `${without} finding(s) match everything else but come from other ` +
            'sources. Widen sourceIds, or set matchAllSources.',
        });
      }
    }

    if (m.detectorTypes.length > 0 || m.customDetectorKeys.length > 0) {
      const without = await countWith({
        detectorTypes: [],
        customDetectorKeys: [],
      });
      if (without > 0) {
        diagnostics.push({
          dimension: 'detectors',
          survivingWithout: without,
          message:
            `${without} finding(s) match everything else but come from other ` +
            'detectors. Check the detector keys against ' +
            'GET /inquiries/match-options.',
        });
      }
    }

    if (m.findingTypes.length > 0) {
      const without = await countWith({ findingTypes: [] });
      if (without > 0) {
        diagnostics.push({
          dimension: 'findingTypes',
          survivingWithout: without,
          message:
            `${without} finding(s) match everything else but have a different ` +
            'finding type. match-options lists the types each detector ' +
            'actually emits.',
        });
      }
    }

    if (m.findingTypeRegex.length > 0) {
      const without = await countWith({ findingTypeRegex: [] });
      if (without > 0) {
        diagnostics.push({
          dimension: 'findingTypeRegex',
          survivingWithout: without,
          message:
            `${without} finding(s) match everything else but no ` +
            'findingTypeRegex pattern matches their finding type.',
        });
      }
    }

    if (m.findingValueRegex.length > 0) {
      const without = await countWith({ findingValueRegex: [] });
      if (without > 0) {
        // The §5.10 trap, called by name: an AI detector's answer is the
        // finding TYPE and its matchedContent is prose reasoning, so a value
        // regex written for a TAG detector matches nothing at all.
        const answersInType = await this.findingsAnsweringInType(m);
        diagnostics.push({
          dimension: 'findingValueRegex',
          survivingWithout: without,
          message:
            `${without} finding(s) match everything else but no ` +
            'findingValueRegex pattern matches their content.' +
            (answersInType.length > 0
              ? ` Note: ${answersInType.join(', ')} put the answer in the ` +
                'finding TYPE, not the value — for those, use findingTypes ' +
                'instead of findingValueRegex.'
              : ''),
        });
      }
    }

    if (diagnostics.length === 0) {
      diagnostics.push({
        dimension: 'corpus',
        survivingWithout: 0,
        message:
          'Every dimension is satisfiable on its own; no finding satisfies all ' +
          'of them together. The question is wired consistently and simply has ' +
          'no matches yet.',
      });
    }
    return diagnostics;
  }

  /**
   * Named custom detectors whose findings answer in `findingType`.
   *
   * Detected from the data rather than from the pipeline schema, which this
   * service does not read: a detector emitting many distinct finding types is
   * classifying (the label IS the answer), while one emitting a single
   * `tag:<label>` type is asserting (the value is the answer).
   */
  private async findingsAnsweringInType(m: InquiryMatchers): Promise<string[]> {
    if (m.customDetectorKeys.length === 0) return [];
    const rows = await this.prisma.finding.groupBy({
      by: ['customDetectorKey', 'findingType'],
      where: {
        status: 'OPEN',
        detectorType: 'CUSTOM',
        customDetectorKey: { in: m.customDetectorKeys },
      },
    });
    const typesByKey = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.customDetectorKey) continue;
      const set = typesByKey.get(row.customDetectorKey) ?? new Set<string>();
      set.add(row.findingType);
      typesByKey.set(row.customDetectorKey, set);
    }
    return [...typesByKey.entries()]
      .filter(
        ([, types]) => types.size > 1 || ![...types][0]?.startsWith('tag:'),
      )
      .map(([key]) => `'${key}'`);
  }

  /**
   * Total matched count plus the first `PREVIEW_CAP` rows, without ever
   * materialising the whole match set.
   *
   * The previous implementation ran an unbounded `findMany` — every OPEN
   * finding the SQL prefilter allowed, each carrying `matchedContent` plus an
   * `asset` and `evidenceAnalysis` join — and then threw away all but 50 rows.
   * On a 3.1M-finding corpus that was a 22.7s query whose only real output was
   * a number and a 50-row sample.
   *
   * Two paths, because only one of them actually needs to see the rows:
   *
   *  - No regex dimensions configured → the SQL `where` built by
   *    `candidateWhere` is already an exact expression of the matcher (see the
   *    dimension-by-dimension correspondence in `CompiledMatcher.matches`), so
   *    `matcher.matches` would return true for every row the database
   *    returned. The count is therefore a `COUNT(*)` and the sample a
   *    `take: PREVIEW_CAP`.
   *  - Regexes configured → they cannot be pushed into SQL, so the rows must
   *    still be examined. But they are streamed in id-ordered batches
   *    selecting only the columns the matcher reads, and the expensive joins
   *    are fetched afterwards for the ≤50 rows actually rendered.
   */
  private async previewRows(
    m: InquiryMatchers,
  ): Promise<{ total: number; sample: FindingRow[] }> {
    const where = candidateWhere(m);
    const previewSelect = {
      ...FINDING_SELECT,
      asset: { select: { name: true, sourceType: true } },
      evidenceAnalysis: {
        select: {
          importanceScore: true,
          qualityScore: true,
          similarCount: true,
          duplicateGroupHash: true,
          reasons: true,
        },
      },
    } as const;

    if (m.findingTypeRegex.length === 0 && m.findingValueRegex.length === 0) {
      const [total, sample] = await Promise.all([
        this.prisma.finding.count({ where }),
        this.prisma.finding.findMany({
          where,
          take: PREVIEW_CAP,
          select: previewSelect,
        }),
      ]);
      return { total, sample };
    }

    const matcher = new CompiledMatcher(m);
    // Only the dimensions the matcher actually reads. `matchedContent` is the
    // large column here, so it is pulled only when a value regex needs it.
    const scanSelect = {
      id: true,
      sourceId: true,
      detectorType: true,
      customDetectorKey: true,
      findingType: true,
      ...(m.findingValueRegex.length > 0 ? { matchedContent: true } : {}),
    } as const;

    let total = 0;
    const sampleIds: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const batch = await this.prisma.finding.findMany({
        where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
        select: scanSelect,
        orderBy: { id: 'asc' },
        take: PREVIEW_SCAN_BATCH,
      });
      if (batch.length === 0) break;
      for (const row of batch) {
        if (!matcher.matches(row as FindingCandidate)) continue;
        total++;
        if (sampleIds.length < PREVIEW_CAP) sampleIds.push(row.id);
      }
      cursor = batch[batch.length - 1]!.id;
      if (batch.length < PREVIEW_SCAN_BATCH) break;
    }

    if (sampleIds.length === 0) return { total, sample: [] };
    const sample = await this.prisma.finding.findMany({
      where: { id: { in: sampleIds } },
      select: previewSelect,
    });
    // Restore the id order the scan established; `IN (…)` does not preserve it.
    const byId = new Map(sample.map((row) => [row.id, row]));
    return {
      total,
      sample: sampleIds
        .map((id) => byId.get(id))
        .filter((row): row is (typeof sample)[number] => row != null),
    };
  }

  // ─── Private ─────────────────────────────────────────────────────

  private readonly matcherSelect = {
    id: true,
    matchAllSources: true,
    sourceIds: true,
    detectorTypes: true,
    customDetectorKeys: true,
    findingTypes: true,
    findingTypeRegex: true,
    findingValueRegex: true,
  } satisfies Prisma.InquirySelect;

  /**
   * SQL-prefilter by source/detector/exact-type, then app-filter (regex) via
   * the matcher — a page at a time, retaining nothing between pages.
   *
   * The SQL half of a matcher is coarse: an inquiry watching "PII" prefilters
   * to `status = OPEN AND detector_type IN ('PII')`, which on a real corpus is
   * essentially the whole table. This used to be one `findMany` with no `take`,
   * so the driver materialised every matching row — 6.7M findings × nine
   * columns including `matched_content` — into a JS array before the regex
   * filter saw the first one. Captured on the desktop API, two seconds apart,
   * with exactly this statement in `pg_stat_activity` and no `LIMIT` on it:
   *
   *     18:34:16  rss=1461MB
   *     18:34:18  rss=1667MB
   *     18:34:20  rss=1952MB
   *     18:34:21  FATAL ERROR: Ineffective mark-compacts near heap limit
   *
   * Paging is not a cap: every candidate is still visited and every match is
   * still found. What changes is that only one page is live at a time, so the
   * peak is a property of the page size rather than of the corpus.
   *
   * Yields the matching rows of each page together with how many candidates
   * that page scanned, because a bounded probe needs the raw count to know
   * whether it reached the end.
   */
  private async *candidateFindingPages(
    m: InquiryMatchers,
    withAsset: boolean,
    scanLimit?: number,
  ): AsyncGenerator<{ rows: FindingRow[]; scanned: number }> {
    yield* this.findingPages(
      candidateWhere(m),
      m,
      this.pageSelect(FINDING_SELECT, withAsset),
      scanLimit,
    );
  }

  /**
   * The mirror walk: matches the latest run of their source RETIRED.
   *
   * Separate from the candidate walk rather than a widened scope on it, because
   * the two have opposite shapes. The OPEN candidate set is the corpus and is
   * bounded only by paging; this one is bounded in SQL to a single run's
   * retirements per source, so it stays small even for a matcher naming every
   * source — and it never makes the hot counter walk carry three more columns.
   */
  private async *retiredFindingPages(
    m: InquiryMatchers,
    anchors: RunAnchors,
    withAsset: boolean,
  ): AsyncGenerator<{ rows: FindingRow[]; scanned: number }> {
    const where = retiredCandidateWhere(m, anchors);
    if (!where) return;
    for await (const page of this.findingPages(
      where,
      m,
      this.pageSelect(RETIRED_FINDING_SELECT, withAsset),
    )) {
      // The SQL bounds retirement to the latest run; `classifyMatch` is what
      // rejects a manual resolve that happens to fall inside the same window.
      yield {
        rows: page.rows.filter(
          (f) => classifyMatch(f as never, anchors) === 'GONE',
        ),
        scanned: page.scanned,
      };
    }
  }

  private pageSelect<T extends object>(base: T, withAsset: boolean) {
    return withAsset
      ? {
          ...base,
          asset: { select: { name: true, sourceType: true } },
          evidenceAnalysis: {
            select: {
              importanceScore: true,
              qualityScore: true,
              similarCount: true,
              duplicateGroupHash: true,
              reasons: true,
            },
          },
        }
      : base;
  }

  private async *findingPages(
    where: Prisma.FindingWhereInput,
    m: InquiryMatchers,
    select: object,
    scanLimit?: number,
  ): AsyncGenerator<{ rows: FindingRow[]; scanned: number }> {
    const matcher = new CompiledMatcher(m);

    let cursor: string | null = null;
    let scanned = 0;
    for (;;) {
      // Keyset, not OFFSET: a growing table makes offset paging skip and repeat
      // rows, and the deep pages get slower the further in they go.
      const take =
        scanLimit != null
          ? Math.min(CANDIDATE_PAGE_SIZE, scanLimit - scanned)
          : CANDIDATE_PAGE_SIZE;
      if (take <= 0) return;

      const page = (await this.prisma.finding.findMany({
        where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
        // Deterministic order so a bounded probe scans the same window twice
        // and its answers do not flicker between calls.
        orderBy: { id: 'asc' as const },
        take,
        select,
      })) as FindingRow[];
      if (page.length === 0) return;

      scanned += page.length;
      cursor = page[page.length - 1].id;
      yield {
        rows: page.filter((f) => matcher.matches(f)),
        scanned: page.length,
      };

      if (page.length < take) return;
      // Hand the event loop back: this walk can span millions of rows and must
      // not starve the HTTP server it shares a process with.
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  /**
   * Every match, materialised.
   *
   * Only for callers that genuinely need every row at once and are already
   * bounded by something else — `probeMatches` caps the scan explicitly. Paths
   * that only need counts, ids, or one ranked page must stream instead; see
   * {@link candidateFindingPages}.
   */
  private async candidateFindings(
    m: InquiryMatchers,
    withAsset: boolean,
    scanLimit?: number,
  ): Promise<FindingRow[]> {
    const all: FindingRow[] = [];
    for await (const page of this.candidateFindingPages(
      m,
      withAsset,
      scanLimit,
    ))
      all.push(...page.rows);
    return all;
  }
}
