import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { DetectorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { CompiledMatcher, InquiryMatchers } from './inquiry-matcher';
import { INQUIRY_MATCH_QUEUE } from './matching.constants';
import { runsBackgroundWorkers } from '../service-role';
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
 * Background engine: an Inquiry is a saved query. After a source finishes
 * ingesting, the run's new findings are matched against every ACTIVE inquiry for
 * that source. Counts are stored on the Inquiry row (matchCount + newMatchCount)
 * instead of persisting individual match rows.
 */
@Injectable()
export class InquiryMatchingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InquiryMatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!runsBackgroundWorkers()) return;
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(INQUIRY_MATCH_QUEUE);
    await boss.work(
      INQUIRY_MATCH_QUEUE,
      { localConcurrency: 1 },
      (jobs: Job[]) => this.handle(jobs),
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
