import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DetectorType, FindingStatus, Severity } from '@prisma/client';

export enum QuickSearchKind {
  ASSETS = 'assets',
  FINDINGS = 'findings',
}

export class QuickSearchRequestDto {
  @ApiProperty({
    description: 'What to look for; at least 2 characters',
    minLength: 2,
    maxLength: 200,
  })
  q!: string;

  @ApiPropertyOptional({ enum: QuickSearchKind, isArray: true })
  kinds?: QuickSearchKind[];

  @ApiPropertyOptional({ description: 'Only this source' })
  sourceId?: string;

  @ApiPropertyOptional({ enum: Severity, isArray: true })
  severity?: Severity[];

  @ApiPropertyOptional({ enum: DetectorType, isArray: true })
  detectorType?: DetectorType[];

  @ApiPropertyOptional({
    description: 'Results per kind (default 8, at most 25)',
    minimum: 1,
    maximum: 25,
  })
  limit?: number;
}

export class QuickSearchSeverityCountsDto {
  @ApiProperty() critical!: number;
  @ApiProperty() high!: number;
  @ApiProperty() medium!: number;
  @ApiProperty() low!: number;
  @ApiProperty() info!: number;
}

export class QuickSearchAssetDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) externalUrl!:
    | string
    | null;
  @ApiProperty() assetType!: string;
  @ApiProperty() sourceType!: string;
  @ApiProperty() sourceId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) sourceName!:
    | string
    | null;
  @ApiProperty({
    description: 'Findings on the asset that are not resolved or dismissed',
  })
  openFindings!: number;
  @ApiProperty({ type: QuickSearchSeverityCountsDto })
  severityCounts!: QuickSearchSeverityCountsDto;
}

export class QuickSearchFindingDto {
  @ApiProperty() id!: string;
  @ApiProperty() assetId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) assetName!:
    | string
    | null;
  @ApiProperty() findingType!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) matchedContent!:
    | string
    | null;
  @ApiProperty({ enum: Severity }) severity!: Severity;
  @ApiProperty({ enum: DetectorType }) detectorType!: DetectorType;
  @ApiPropertyOptional({ type: String, nullable: true }) customDetectorName!:
    | string
    | null;
  @ApiProperty({ enum: FindingStatus }) status!: FindingStatus;
}

export class QuickSearchResponseDto {
  @ApiProperty({ type: [QuickSearchAssetDto] })
  assets!: QuickSearchAssetDto[];

  @ApiProperty({ type: [QuickSearchFindingDto] })
  findings!: QuickSearchFindingDto[];

  @ApiProperty({
    description:
      'True when a query ran out of its time budget and the lists may be short',
  })
  truncated!: boolean;
}
