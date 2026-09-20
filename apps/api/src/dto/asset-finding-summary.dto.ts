import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DetectorType, FindingStatus, Severity } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { AssetResponseDto, SourceResponseDto } from './finding-response.dto';

export class AssetFindingDetectorCountDto {
  @ApiProperty({ enum: DetectorType })
  detectorType: DetectorType;

  @ApiProperty()
  count: number;
}

export class AssetFindingSeverityCountDto {
  @ApiProperty({ enum: Severity })
  severity: Severity;

  @ApiProperty()
  count: number;
}

export class AssetFindingStatusCountDto {
  @ApiProperty({ enum: FindingStatus })
  status: FindingStatus;

  @ApiProperty()
  count: number;
}

export class AssetFindingTypeCountDto {
  @ApiProperty()
  findingType: string;

  @ApiProperty()
  count: number;
}

export class AssetFindingSummaryDto {
  @ApiProperty()
  assetId: string;

  @ApiPropertyOptional({ type: AssetResponseDto })
  asset?: AssetResponseDto;

  @ApiPropertyOptional({ type: SourceResponseDto })
  source?: SourceResponseDto;

  @ApiProperty()
  totalFindings: number;

  @ApiProperty()
  lastDetectedAt: Date;

  @ApiProperty({ enum: Severity })
  highestSeverity: Severity;

  @ApiProperty({ type: [AssetFindingDetectorCountDto] })
  detectorCounts: AssetFindingDetectorCountDto[];

  @ApiProperty({ type: [AssetFindingSeverityCountDto] })
  severityCounts: AssetFindingSeverityCountDto[];

  @ApiProperty({ type: [AssetFindingStatusCountDto] })
  statusCounts: AssetFindingStatusCountDto[];

  @ApiProperty({ type: [AssetFindingTypeCountDto] })
  findingTypeCounts: AssetFindingTypeCountDto[];
}

export class AssetFindingSummaryListResponseDto {
  @ApiProperty({ type: [AssetFindingSummaryDto] })
  items: AssetFindingSummaryDto[];

  @ApiProperty()
  totalAssets: number;

  @ApiProperty()
  totalFindings: number;

  @ApiProperty()
  skip: number;

  @ApiProperty()
  limit: number;
}

/** Unresolved finding counts for one asset, for a graph view that has its nodes. */
export class AssetSeverityCountsItemDto {
  @ApiProperty()
  assetId!: string;

  @ApiProperty()
  total!: number;

  @ApiProperty({
    type: Object,
    description:
      'Severity (uppercase) to count, omitting severities with none.',
  })
  severityCounts!: Record<string, number>;
}

/**
 * Asset ids to count findings for.
 *
 * A lineage graph carries no finding nodes, so every hotspot it drew reported
 * "0 findings" while each of its assets carried one (GENESIS field report P13).
 */
export class AssetSeverityCountsRequestDto {
  @ApiProperty({
    type: [String],
    description: 'Up to 500 asset ids. Anything beyond that is ignored.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  assetIds!: string[];
}

export class AssetSeverityCountsResponseDto {
  @ApiProperty({ type: [AssetSeverityCountsItemDto] })
  items!: AssetSeverityCountsItemDto[];
}
