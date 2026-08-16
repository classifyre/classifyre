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
import { OPERATOR_CREATED } from '../autopilot/autopilot.constants';
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
    // Counters only: there is no reason to hold a single row past the moment
    // it has been counted, and holding them all is what killed the process.
    let total = 0;
    let newCount = 0;
    for await (const page of this.candidateFindingPages(m, false)) {
      total += page.rows.length;
      if (seenAt) {
        for (const f of page.rows) {
          if ((f.createdAt ?? new Date(0)) > seenAt) newCount += 1;
        }
      }
    }
    return { total, newCount };
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
        matchesSeenAt: { not: null },
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
    let matchCount = 0;
    for await (const page of this.candidateFindingPages(q, false))
      matchCount += page.rows.length;
    // newMatchCount resets to 0 because a rematch *is* the fresh baseline; the
    // next run recomputes it against matchesSeenAt like everything else.
    await this.prisma.inquiry.update({
      where: { id: inquiryId },
      data: { matchCount, newMatchCount: 0 },
    });
    return { landed: matchCount };
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

    const term =
      typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';
    const severities = (
      Array.isArray(query.severity)
        ? query.severity
        : query.severity
          ? [query.severity]
          : []
    ).map((s) => String(s).toUpperCase());
    const onlyNew = query.onlyNew === true || String(query.onlyNew) === 'true';

    // Only the requested page is ever retained. The counters below are still
    // exact — every match is visited — but the sort no longer needs the whole
    // match set resident, which on a large workspace was millions of DTOs.
    const wanted = skip + limit;
    const ranked: InquiryMatchDto[] = [];
    let total = 0;
    let newCount = 0;

    for await (const page of this.candidateFindingPages(q, true)) {
      for (const f of page.rows) {
        const match = this.toMatchDto(f, seenAt);
        if (
          term.length > 0 &&
          !(
            match.label.toLowerCase().includes(term) ||
            (match.assetName ?? '').toLowerCase().includes(term) ||
            (match.matchedContent ?? '').toLowerCase().includes(term)
          )
        ) {
          continue;
        }
        if (
          severities.length > 0 &&
          !severities.includes((match.severity ?? '').toUpperCase())
        ) {
          continue;
        }
        // Counted before `onlyNew` narrows the set, so "3 new" stays the same
        // number whether or not the caller is filtering to new.
        if (match.isNew) newCount += 1;
        if (onlyNew && !match.isNew) continue;

        total += 1;
        this.keepTopMatch(ranked, match, wanted);
      }
    }

    return {
      items: ranked.slice(skip, skip + limit),
      total,
      newCount,
      skip,
      limit,
    };
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

  private toMatchDto(f: FindingRow, seenAt: Date | null): InquiryMatchDto {
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
    };
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
      isNew: false,
    }));
    return { total: rows.total, sample };
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
    const where = this.candidateWhere(m);
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
   * The SQL half of a matcher: source, detector and (when safe) exact type.
   *
   * Shared by the scanning paths and by `previewRows`, so the fast count path
   * can never drift from the predicate the scanning path applies.
   */
  private candidateWhere(m: InquiryMatchers): Prisma.FindingWhereInput {
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
    return where;
  }

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
    const where = this.candidateWhere(m);
    const matcher = new CompiledMatcher(m);
    const select = withAsset
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
      : FINDING_SELECT;

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
