import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DetectorType, FindingStatus, Severity } from '@prisma/client';
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
