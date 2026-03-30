import { ApiProperty } from '@nestjs/swagger';
import {
  AssetContentType,
  RunnerStatus,
  Severity,
  TriggerType,
} from '@prisma/client';

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

  @ApiProperty({ enum: AssetContentType })
  assetType: AssetContentType;

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

  @ApiProperty()
  totalFindings: number;

  @ApiProperty()
  assetsCreated: number;

  @ApiProperty()
  assetsUpdated: number;

  @ApiProperty({ required: false, nullable: true })
  errorMessage?: string | null;

  @ApiProperty({ required: false, nullable: true, type: DiscoveryRunSourceDto })
  source?: DiscoveryRunSourceDto | null;
}

export class FindingsDiscoveryResponseDto {
  @ApiProperty({ enum: [7, 30, 90] })
  windowDays: number;

  @ApiProperty()
  includeResolved: boolean;

  @ApiProperty({ type: FindingsDiscoveryTotalsDto })
  totals: FindingsDiscoveryTotalsDto;

  @ApiProperty({ type: FindingsDiscoveryActivityDto })
  activity: FindingsDiscoveryActivityDto;

  @ApiProperty({ type: [FindingsDiscoveryTopAssetDto] })
  topAssets: FindingsDiscoveryTopAssetDto[];

  @ApiProperty({ type: [DiscoveryRecentRunDto] })
  recentRuns: DiscoveryRecentRunDto[];
}
