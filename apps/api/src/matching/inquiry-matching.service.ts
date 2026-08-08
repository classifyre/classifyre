import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { DetectorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import {
  CompiledMatcher,
  FindingCandidate,
  InquiryMatchers,
} from './inquiry-matcher';
import { INQUIRY_MATCH_QUEUE } from './matching.constants';
import {
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
  // Newness is decided by createdAt vs the inquiry's matchesSeenAt, so every
  // path that counts matches needs it — not just the one that renders them.
  createdAt: true,
} as const;

const PREVIEW_CAP = 50;

/**
 * Candidate rows a bounded probe will pull before giving up. Sized so the
 * autopilot's evidence floor stays cheap enough to run inside a tool call while
 * still being decisive for any matcher narrow enough to be worth monitoring.
 */
const PROBE_SCAN_LIMIT = 2000;

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
  ) {}

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
   * Count an inquiry's live matches the same way `getLiveMatches` does.
   *
   * Both the stored counters and the /matches endpoint go through here, so they
   * cannot disagree about what a match is or what makes one "new". They used to
   * apply different rules: newMatchCount incremented by every finding *this run
   * touched* — including ones merely re-detected, whose createdAt is old — while
   * /matches counted only findings created since matchesSeenAt. A re-scan that
   * re-detected 15 existing findings reported "15 new" next to "0 new".
   */
  private async computeMatchCounts(
    m: InquiryMatchers,
    seenAt: Date | null,
  ): Promise<{ total: number; newCount: number }> {
    const matches = await this.candidateFindings(m, false);
    const newCount = seenAt
      ? matches.filter((f) => (f.createdAt ?? new Date(0)) > seenAt).length
      : 0;
    return { total: matches.length, newCount };
  }

  /**
   * After a source run finishes, refresh each ACTIVE inquiry's counters from
   * the live match set.
   */
  async processSourceCompletion(
    sourceId: string,
    _runnerId: string | null,
  ): Promise<{ landed: number }> {
    const inquiries = await this.prisma.inquiry.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ matchAllSources: true }, { sourceIds: { has: sourceId } }],
      },
      select: {
        ...this.matcherSelect,
        matchCount: true,
        newMatchCount: true,
        matchesSeenAt: true,
      },
    });
    if (inquiries.length === 0) return { landed: 0 };

    let landed = 0;
    for (const q of inquiries) {
      const { total, newCount } = await this.computeMatchCounts(
        q,
        q.matchesSeenAt,
      );

      // Assigned, never incremented: an accumulator drifts permanently once any
      // run miscounts, and cannot be reconciled against the live set.
      if (total !== q.matchCount || newCount !== q.newMatchCount) {
        await this.prisma.inquiry.update({
          where: { id: q.id },
          data: { matchCount: total, newMatchCount: newCount },
        });
      }
      landed += newCount;
    }

    if (landed > 0)
      this.logger.log(
        `Recorded ${landed} new match(es) for source ${sourceId}`,
      );
    return { landed };
  }

  /**
   * Find an inquiry with a genuinely new match in one completed runner.
   *
   * Stored `newMatchCount` is corpus-wide and remains positive until an
   * operator marks the inquiry seen. It therefore cannot decide whether this
   * particular scan should bypass corpus coalescing. This live check applies
   * the canonical matcher to only this runner's findings and uses the same
   * createdAt > matchesSeenAt definition as the matching counters and API.
   */
  async findNewInquiryMatchForRunner(args: {
    sourceId: string;
    runnerId: string;
    createdByNot: string;
  }): Promise<{ id: string; title: string } | null> {
    const inquiries = await this.prisma.inquiry.findMany({
      where: {
        status: 'ACTIVE',
        createdBy: { not: args.createdByNot },
        matchesSeenAt: { not: null },
        OR: [{ matchAllSources: true }, { sourceIds: { has: args.sourceId } }],
      },
      select: {
        ...this.matcherSelect,
        title: true,
        matchesSeenAt: true,
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

    for (const inquiry of inquiries) {
      const seenAt = inquiry.matchesSeenAt;
      if (
        seenAt &&
        findings.some(
          (finding) =>
            (finding.createdAt?.getTime() ?? 0) > seenAt.getTime() &&
            new CompiledMatcher(inquiry).matches(finding),
        )
      ) {
        return { id: inquiry.id, title: inquiry.title };
      }
    }
    return null;
  }

  /**
   * Re-evaluate ALL current OPEN findings against a single inquiry. Seeds a newly
   * created inquiry with existing findings and refreshes its match set. Resets
   * newMatchCount to 0 (fresh baseline).
   */
  async rematchInquiry(inquiryId: string): Promise<{ landed: number }> {
    const q = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: this.matcherSelect,
    });
    if (!q) return { landed: 0 };
    const matches = await this.candidateFindings(q, false);
    // newMatchCount resets to 0 because a rematch *is* the fresh baseline; the
    // next run recomputes it against matchesSeenAt like everything else.
    await this.prisma.inquiry.update({
      where: { id: inquiryId },
      data: { matchCount: matches.length, newMatchCount: 0 },
    });
    return { landed: matches.length };
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
    const empty = { items: [], total: 0, newCount: 0, skip, limit };

    const q = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: { ...this.matcherSelect, matchesSeenAt: true },
    });
    if (!q) return empty;
    const seenAt = q.matchesSeenAt;

    const rows = await this.candidateFindings(q, true);
    let matches: InquiryMatchDto[] = rows.map((f) => ({
      findingId: f.id,
      label: f.findingType,
      severity: String(f.severity),
      detectorType: String(f.detectorType),
      matchedContent: f.matchedContent ?? undefined,
      assetId: f.assetId,
      assetName: f.asset?.name,
      sourceType: f.asset ? String(f.asset.sourceType) : undefined,
      matchedAt: f.createdAt ?? new Date(),
      isNew: seenAt ? (f.createdAt ?? new Date(0)) > seenAt : false,
      ranking: f.evidenceAnalysis
        ? {
            importance: f.evidenceAnalysis.importanceScore,
            quality: f.evidenceAnalysis.qualityScore,
            similarCount: f.evidenceAnalysis.similarCount,
            duplicateGroupHash: f.evidenceAnalysis.duplicateGroupHash,
            reasons: Array.isArray(f.evidenceAnalysis.reasons)
              ? (f.evidenceAnalysis.reasons as never[])
              : [],
            coverage: 'analyzed' as const,
          }
        : {
            similarCount: 0,
            reasons: [],
            coverage: 'pending' as const,
          },
    }));
    // Importance-first: matches are a triage queue, not a log. Unanalyzed
    // rows keep their recency order below the ranked ones.
    matches.sort((a, b) => {
      const ai = a.ranking?.importance ?? -1;
      const bi = b.ranking?.importance ?? -1;
      if (ai !== bi) return bi - ai;
      return (
        (b.matchedAt instanceof Date ? b.matchedAt.getTime() : 0) -
        (a.matchedAt instanceof Date ? a.matchedAt.getTime() : 0)
      );
    });

    const term =
      typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';
    if (term.length > 0) {
      matches = matches.filter(
        (m) =>
          m.label.toLowerCase().includes(term) ||
          (m.assetName ?? '').toLowerCase().includes(term) ||
          (m.matchedContent ?? '').toLowerCase().includes(term),
      );
    }
    const severities = (
      Array.isArray(query.severity)
        ? query.severity
        : query.severity
          ? [query.severity]
          : []
    ).map((s) => String(s).toUpperCase());
    if (severities.length > 0) {
      matches = matches.filter((m) =>
        severities.includes((m.severity ?? '').toUpperCase()),
      );
    }
    const onlyNew = query.onlyNew === true || String(query.onlyNew) === 'true';
    const newCount = matches.filter((m) => m.isNew).length;
    if (onlyNew) matches = matches.filter((m) => m.isNew);

    return {
      items: matches.slice(skip, skip + limit),
      total: matches.length,
      newCount,
      skip,
      limit,
    };
  }

  /** Return live matching finding IDs for an inquiry (used by pullFromInquiry). */
  async getMatchingFindingIds(inquiryId: string): Promise<string[]> {
    const q = await this.prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: this.matcherSelect,
    });
    if (!q) return [];
    const rows = await this.candidateFindings(q, false);
    return rows.map((r) => r.id);
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
    const rows = await this.candidateFindings(matchers, false, scanLimit);
    const matcher = new CompiledMatcher(matchers);
    return {
      findingIds: rows.filter((f) => matcher.matches(f)).map((f) => f.id),
      scanned: rows.length,
      exhausted: rows.length < scanLimit,
    };
  }

  /** Compute (without persisting) the findings a matcher config currently selects. */
  async preview(matchers: InquiryMatchers): Promise<PreviewResponseDto> {
    const rows = await this.candidateFindings(matchers, true);
    const sample: InquiryMatchDto[] = rows.slice(0, PREVIEW_CAP).map((f) => ({
      findingId: f.id,
      label: f.findingType,
      severity: String(f.severity),
      detectorType: String(f.detectorType),
      matchedContent: f.matchedContent ?? undefined,
      assetId: f.assetId,
      assetName: f.asset?.name,
      sourceType: f.asset ? String(f.asset.sourceType) : undefined,
      matchedAt: new Date(),
      isNew: false,
    }));
    return { total: rows.length, sample };
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

  /** SQL-prefilter by source/detector/exact-type, then app-filter (regex) via the matcher. */
  private async candidateFindings(
    m: InquiryMatchers,
    withAsset: boolean,
    scanLimit?: number,
  ): Promise<FindingRow[]> {
    const hasDetectorFilter =
      m.detectorTypes.length > 0 || m.customDetectorKeys.length > 0;
    const where: Prisma.FindingWhereInput = { status: 'OPEN' };
    if (!m.matchAllSources) where.sourceId = { in: m.sourceIds };
    if (hasDetectorFilter) {
      where.OR = [
        ...(m.detectorTypes.length > 0
          ? [{ detectorType: { in: m.detectorTypes } }]
          : []),
        ...(m.customDetectorKeys.length > 0
          ? [{ customDetectorKey: { in: m.customDetectorKeys } }]
          : []),
      ];
    }
    // Exact-type SQL prefilter: only safe when there are no type-regexes AND no value-regexes.
    if (
      m.findingTypeRegex.length === 0 &&
      m.findingValueRegex.length === 0 &&
      m.findingTypes.length > 0
    ) {
      where.findingType = { in: m.findingTypes };
    }

    const rows = (await this.prisma.finding.findMany({
      where,
      // Deterministic order so a bounded probe scans the same window twice and
      // its answers do not flicker between calls.
      ...(scanLimit != null
        ? { take: scanLimit, orderBy: { id: 'asc' as const } }
        : {}),
      select: withAsset
        ? {
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
          }
        : FINDING_SELECT,
    })) as FindingRow[];

    const matcher = new CompiledMatcher(m);
    return rows.filter((f) => matcher.matches(f));
  }
}
