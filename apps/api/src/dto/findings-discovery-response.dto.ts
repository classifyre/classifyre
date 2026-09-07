import { ApiProperty } from '@nestjs/swagger';
import { RunnerStatus, Severity, TriggerType } from '@prisma/client';

export class FindingsDiscoverySeverityBreakdownDto {
  @ApiProperty()
  critical: number;

  @ApiProperty()
  high: number;

  @ApiProperty()
  medium: number;

  @ApiProperty()
  low: number;

  @ApiProperty()
  info: number;
}

export class FindingsDiscoveryStatusBreakdownDto {
  @ApiProperty()
  open: number;

  @ApiProperty()
  falsePositive: number;

  @ApiProperty()
  resolved: number;

  @ApiProperty()
  ignored: number;
}

export class FindingsDiscoveryTotalsDto {
  @ApiProperty()
  total: number;

  @ApiProperty({ type: FindingsDiscoverySeverityBreakdownDto })
  bySeverity: FindingsDiscoverySeverityBreakdownDto;

  @ApiProperty({ type: FindingsDiscoveryStatusBreakdownDto })
  byStatus: FindingsDiscoveryStatusBreakdownDto;
}

export class FindingsDiscoveryActivityDto {
  @ApiProperty()
  today: number;

  @ApiProperty()
  week: number;

  @ApiProperty()
  month: number;
}

export class FindingsDiscoveryTopAssetDto {
  @ApiProperty()
  assetId: string;

  @ApiProperty()
  assetName: string;

  @ApiProperty({ description: 'Catalog asset kind of the parent asset' })
  assetType: string;

  @ApiProperty({ required: false, nullable: true })
  sourceId?: string | null;

  @ApiProperty({ required: false, nullable: true })
  sourceName?: string | null;

  @ApiProperty({ required: false, nullable: true })
  sourceType?: string | null;

  @ApiProperty()
  totalFindings: number;

  @ApiProperty({ enum: Severity })
  highestSeverity: Severity;

  @ApiProperty({
    type: FindingsDiscoverySeverityBreakdownDto,
    description:
      'Priority mix of this asset\'s findings. Already computed to rank the list, so it costs nothing to return and lets the caller draw a per-asset bar.',
  })
  severityCounts: FindingsDiscoverySeverityBreakdownDto;

  @ApiProperty({ required: false, nullable: true })
  lastDetectedAt?: Date | null;
}

export class DiscoveryRunSourceDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ required: false, nullable: true })
  name?: string | null;

  @ApiProperty({ required: false, nullable: true })
  type?: string | null;
}

export class DiscoveryRecentRunDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: RunnerStatus })
  status: RunnerStatus;

  @ApiProperty({ enum: TriggerType })
  triggerType: TriggerType;

  @ApiProperty()
  triggeredAt: Date;

  @ApiProperty({ required: false, nullable: true })
  startedAt?: Date | null;

  @ApiProperty({ required: false, nullable: true })
  completedAt?: Date | null;

  @ApiProperty({ required: false, nullable: true })
  durationMs?: number | null;

  @ApiProperty({
    description:
      "The source's open finding set as of this run — NOT what the run discovered. Use findingsCreated for that.",
  })
  totalFindings: number;

  @ApiProperty({ description: 'Findings this run raised that did not exist before.' })
  findingsCreated: number;

  @ApiProperty({ description: 'Findings this run resolved because they were gone.' })
  findingsResolved: number;

  @ApiProperty()
  assetsCreated: number;

  @ApiProperty()
  assetsUpdated: number;

  @ApiProperty({ required: false, nullable: true })
  errorMessage?: string | null;

  @ApiProperty({ required: false, nullable: true, type: DiscoveryRunSourceDto })
  source?: DiscoveryRunSourceDto | null;
}

/**
 * Freshness of the numbers on the page.
 *
 * The overview is served from a pre-aggregated rollup rather than counted live,
 * which is what makes it instant instead of a ~43 s full-table aggregate. That
 * trade is only honest if the page can say how old the figures are, so this
 * travels with every response and the UI surfaces it next to a manual refresh.
 */
export class FindingsDiscoveryStatsDto {
  @ApiProperty({ required: false, nullable: true })
  refreshedAt?: Date | null;

  @ApiProperty({ required: false, nullable: true })
  durationMs?: number | null;

  @ApiProperty()
  isBuilt: boolean;

  @ApiProperty({
    enum: ['rollup', 'live'],
    description:
      'rollup: served from the pre-aggregated tables. live: the rollup has not been built yet for this workspace, so the figures were counted directly and are exact but slow.',
  })
  source: 'rollup' | 'live';
}

export class FindingsDiscoveryRefreshResponseDto {
  @ApiProperty()
  queued: boolean;

  @ApiProperty({ required: false, nullable: true })
  refreshedAt?: Date | null;

  @ApiProperty()
  isBuilt: boolean;
}

/**
 * Review-state mix over the same window, counted WITHOUT the status filter that
 * `totals` applies.
 *
 * `totals.byStatus` cannot answer this: the overview defaults to
 * `includeResolved: false`, so it only ever counts OPEN rows and the other three
 * buckets are structurally zero. Keeping them separate means the headline number
 * keeps its "still open" meaning while the review-state strip tells the truth.
 */
export class FindingsDiscoveryStatusMixDto extends FindingsDiscoveryStatusBreakdownDto {
  @ApiProperty({ description: 'Sum of the four buckets — findings of any status in the window.' })
  total: number;
}

export class FindingsDiscoveryResponseDto {
  @ApiProperty({ enum: [7, 30, 90] })
  windowDays: number;

  @ApiProperty()
  includeResolved: boolean;

  @ApiProperty({ type: FindingsDiscoveryTotalsDto })
  totals: FindingsDiscoveryTotalsDto;

  @ApiProperty({ type: FindingsDiscoveryStatusMixDto })
  statusMix: FindingsDiscoveryStatusMixDto;

  @ApiProperty({ type: FindingsDiscoveryActivityDto })
  activity: FindingsDiscoveryActivityDto;

  @ApiProperty({ type: [FindingsDiscoveryTopAssetDto] })
  topAssets: FindingsDiscoveryTopAssetDto[];

  @ApiProperty({ type: [DiscoveryRecentRunDto] })
  recentRuns: DiscoveryRecentRunDto[];

  @ApiProperty({ type: FindingsDiscoveryStatsDto })
  stats: FindingsDiscoveryStatsDto;
}
