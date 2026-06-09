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
  createdAt?: Date;
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

  /**
   * After a source run finishes: count new findings from this run that match each
   * ACTIVE inquiry, increment newMatchCount by that delta, and refresh matchCount
   * (total OPEN findings across all runs).
   */
  async processSourceCompletion(sourceId: string, runnerId: string | null): Promise<{ landed: number }> {
    const inquiries = await this.prisma.inquiry.findMany({
      where: { status: 'ACTIVE', OR: [{ matchAllSources: true }, { sourceIds: { has: sourceId } }] },
      select: { ...this.matcherSelect, matchCount: true },
    });
    if (inquiries.length === 0) return { landed: 0 };

    // Findings specifically from this run (the "new" ones).
    const runFindings = (await this.prisma.finding.findMany({
      where: runnerId ? { runnerId, status: 'OPEN' } : { sourceId, status: 'OPEN' },
      select: FINDING_SELECT,
    })) as FindingRow[];

    let landed = 0;
    for (const q of inquiries) {
      const matcher = new CompiledMatcher(q);

      // Count hits from this run's findings (the "new" delta).
      const newHits = runFindings.filter((f) => matcher.matches(f)).length;

      // Recompute total matchCount across all sources/runs.
      const allMatches = await this.candidateFindings(q, false);
      const newTotal = allMatches.length;

      if (newHits > 0 || newTotal !== q.matchCount) {
        await this.prisma.inquiry.update({
          where: { id: q.id },
          data: {
            matchCount: newTotal,
            ...(newHits > 0 ? { newMatchCount: { increment: newHits } } : {}),
          },
        });
        landed += newHits;
      }
    }

    if (landed > 0) this.logger.log(`Recorded ${landed} new match(es) for source ${sourceId}`);
    return { landed };
  }

  /**
   * Re-evaluate ALL current OPEN findings against a single inquiry. Seeds a newly
   * created inquiry with existing findings and refreshes its match set. Resets
   * newMatchCount to 0 (fresh baseline).
   */
  async rematchInquiry(inquiryId: string): Promise<{ landed: number }> {
    const q = await this.prisma.inquiry.findUnique({ where: { id: inquiryId }, select: this.matcherSelect });
    if (!q) return { landed: 0 };
    const matches = await this.candidateFindings(q, false);
    await this.prisma.inquiry.update({
      where: { id: inquiryId },
      data: { matchCount: matches.length, newMatchCount: 0 },
    });
    return { landed: matches.length };
  }

  /** Return live matching findings for an inquiry (used by listMatches endpoint). */
  async getLiveMatches(inquiryId: string): Promise<InquiryMatchDto[]> {
    const q = await this.prisma.inquiry.findUnique({ where: { id: inquiryId }, select: this.matcherSelect });
    if (!q) return [];
    const rows = await this.candidateFindings(q, true);
    return rows.map((f) => ({
      findingId: f.id,
      label: f.findingType,
      severity: String(f.severity),
      detectorType: String(f.detectorType),
      matchedContent: f.matchedContent ?? undefined,
      assetId: f.assetId,
      assetName: f.asset?.name,
      sourceType: f.asset ? String(f.asset.sourceType) : undefined,
      matchedAt: f.createdAt ?? new Date(),
      isNew: false,
    }));
  }

  /** Return live matching finding IDs for an inquiry (used by pullFromInquiry). */
  async getMatchingFindingIds(inquiryId: string): Promise<string[]> {
    const q = await this.prisma.inquiry.findUnique({ where: { id: inquiryId }, select: this.matcherSelect });
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
    if (m.findingTypeRegex.length === 0 && m.findingValueRegex.length === 0 && m.findingTypes.length > 0) {
      where.findingType = { in: m.findingTypes };
    }

    const rows = (await this.prisma.finding.findMany({
      where,
      select: withAsset
        ? { ...FINDING_SELECT, createdAt: true, asset: { select: { name: true, sourceType: true } } }
        : FINDING_SELECT,
    })) as FindingRow[];

    const matcher = new CompiledMatcher(m);
    return rows.filter((f) => matcher.matches(f));
  }
}
