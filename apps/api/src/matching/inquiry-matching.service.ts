import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { DetectorType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { CompiledMatcher, InquiryMatchers } from './inquiry-matcher';
import { INQUIRY_MATCH_QUEUE } from './matching.constants';
import { PreviewResponseDto, InquiryMatchDto } from '../dto/inquiry.dto';

interface FindingRow {
  id: string;
  assetId: string;
  sourceId: string;
  detectorType: DetectorType;
  customDetectorKey: string | null;
  findingType: string;
  severity: { toString(): string };
  matchedContent: string | null;
  asset?: { name: string; sourceType: { toString(): string } } | null;
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
} as const;

const PREVIEW_CAP = 50;

/**
 * Background engine: a Question is a saved query. After a source finishes
 * ingesting, the run's findings are matched against every ACTIVE question for that
 * source and the matches are recorded in `question_matches` (a lightweight tracker,
 * NOT evidence). Decoupled from ingestion via a pg-boss queue; idempotent via the
 * unique (questionId, findingId) constraint, so it is safe across multiple pods.
 */
@Injectable()
export class InquiryMatchingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(InquiryMatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(INQUIRY_MATCH_QUEUE);
    await boss.work(INQUIRY_MATCH_QUEUE, { localConcurrency: 1 }, (jobs: Job[]) => this.handle(jobs));
    this.logger.log(`Registered worker for queue ${INQUIRY_MATCH_QUEUE}`);
  }

  private async handle(jobs: Job[]): Promise<void> {
    for (const job of jobs) {
      const data = job.data as Record<string, unknown>;
      const sourceId = typeof data?.sourceId === 'string' ? data.sourceId : null;
      const runnerId = typeof data?.runnerId === 'string' ? data.runnerId : null;
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

  /** Match the run's findings against every ACTIVE question for this source. */
  async processSourceCompletion(sourceId: string, runnerId: string | null): Promise<{ landed: number }> {
    const inquiries = await this.prisma.inquiry.findMany({
      where: { status: 'ACTIVE', OR: [{ matchAllSources: true }, { sourceIds: { has: sourceId } }] },
      select: this.matcherSelect,
    });
    if (inquiries.length === 0) return { landed: 0 };

    const candidates = (await this.prisma.finding.findMany({
      where: runnerId ? { runnerId, status: 'OPEN' } : { sourceId, status: 'OPEN' },
      select: FINDING_SELECT,
    })) as FindingRow[];
    if (candidates.length === 0) return { landed: 0 };

    let landed = 0;
    for (const q of inquiries) {
      const matcher = new CompiledMatcher(q);
      const hits = candidates.filter((f) => matcher.matches(f));
      if (hits.length > 0) landed += await this.recordMatches(q.id, hits.map((f) => f.id));
    }
    if (landed > 0) this.logger.log(`Recorded ${landed} match(es) for source ${sourceId}`);
    return { landed };
  }

  /**
   * Re-evaluate ALL current OPEN findings against a single question. Seeds a newly
   * created question with existing findings and refreshes its match set.
   */
  async rematchInquiry(inquiryId: string): Promise<{ landed: number }> {
    const q = await this.prisma.inquiry.findUnique({ where: { id: inquiryId }, select: this.matcherSelect });
    if (!q) return { landed: 0 };
    const ids = (await this.candidateFindings(q, false)).map((f) => f.id);
    const landed = ids.length > 0 ? await this.recordMatches(inquiryId, ids) : 0;
    return { landed };
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
  private async candidateFindings(m: InquiryMatchers, withAsset: boolean): Promise<FindingRow[]> {
    const hasDetectorFilter = m.detectorTypes.length > 0 || m.customDetectorKeys.length > 0;
    const where: Prisma.FindingWhereInput = { status: 'OPEN' };
    if (!m.matchAllSources) where.sourceId = { in: m.sourceIds };
    if (hasDetectorFilter) {
      where.OR = [
        ...(m.detectorTypes.length > 0 ? [{ detectorType: { in: m.detectorTypes } }] : []),
        ...(m.customDetectorKeys.length > 0 ? [{ customDetectorKey: { in: m.customDetectorKeys } }] : []),
      ];
    }
    // Exact-type SQL prefilter: only safe when there are no type-regexes AND no value-regexes.
    // Once either regex list is non-empty every row must reach app-land for CompiledMatcher.
    if (m.findingTypeRegex.length === 0 && m.findingValueRegex.length === 0 && m.findingTypes.length > 0) {
      where.findingType = { in: m.findingTypes };
    }

    const rows = (await this.prisma.finding.findMany({
      where,
      select: withAsset
        ? { ...FINDING_SELECT, asset: { select: { name: true, sourceType: true } } }
        : FINDING_SELECT,
    })) as FindingRow[];

    const matcher = new CompiledMatcher(m);
    return rows.filter((f) => matcher.matches(f));
  }

  private async recordMatches(inquiryId: string, findingIds: string[]): Promise<number> {
    const result = await this.prisma.inquiryMatch.createMany({
      data: findingIds.map((findingId) => ({ inquiryId, findingId })),
      skipDuplicates: true,
    });
    return result.count;
  }
}
