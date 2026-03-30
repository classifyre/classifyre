import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AssetContentType,
  Severity,
  FindingStatus,
  DetectorType,
  AssetType,
} from '@prisma/client';

export class FindingLocationDto {
  @ApiProperty({
    description:
      "Human-readable source reference: 'schema.table, row N' for tabular, URL for web/Slack",
  })
  path: string;

  @ApiPropertyOptional({
    description: 'Additional detail, e.g. column name where value was found',
  })
  description?: string;

  @ApiPropertyOptional({
    type: Number,
    description: 'Line number (1-based) where the finding starts',
  })
  line?: number;

  @ApiPropertyOptional({
    type: Number,
    description: 'Column number (1-based) where the finding starts',
  })
  column?: number;

  @ApiPropertyOptional({
    type: Number,
    description: 'Character offset start within the content',
  })
  start?: number;

  @ApiPropertyOptional({
    type: Number,
    description: 'Character offset end within the content',
  })
  end?: number;
}

export class FindingHistoryEntryDto {
  @ApiProperty()
  timestamp: Date;

  @ApiProperty()
  runnerId: string;

  @ApiProperty({
    enum: [
      'DETECTED',
      'RE_DETECTED',
      'RESOLVED',
      'STATUS_CHANGED',
      'SEVERITY_CHANGED',
      'RE_OPENED',
    ],
  })
  eventType: string;

  @ApiProperty({ enum: FindingStatus })
  status: FindingStatus;

  @ApiPropertyOptional()
  severity?: string;

  @ApiPropertyOptional()
  confidence?: number;

  @ApiPropertyOptional()
  location?: any;

  @ApiPropertyOptional()
  changedBy?: string;

  @ApiPropertyOptional()
  changeReason?: string;
}

export class AssetResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  hash: string;

  @ApiProperty()
  externalUrl: string;

  @ApiProperty({ type: [String] })
  links: string[];

  @ApiProperty({ enum: AssetContentType })
  assetType: AssetContentType;

  @ApiProperty({ enum: AssetType })
  sourceType: AssetType;
}

export class SourceResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: AssetType })
  type: AssetType;
}

export class FindingResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  detectionIdentity: string;

  @ApiProperty()
  assetId: string;

  @ApiProperty()
  sourceId: string;

  @ApiPropertyOptional()
  runnerId?: string;

  @ApiProperty({ enum: DetectorType })
  detectorType: DetectorType;

  @ApiPropertyOptional({
    description: 'Custom detector ID when detectorType is CUSTOM',
  })
  customDetectorId?: string;

  @ApiPropertyOptional({
    description: 'Custom detector key when detectorType is CUSTOM',
  })
  customDetectorKey?: string;

  @ApiPropertyOptional({
    description: 'Custom detector display name when detectorType is CUSTOM',
  })
  customDetectorName?: string;

  @ApiProperty()
  findingType: string;

  @ApiProperty()
  category: string;

  @ApiProperty({ enum: Severity })
  severity: Severity;

  @ApiProperty({ description: 'Confidence score between 0 and 1' })
  confidence: number;

  @ApiProperty()
  matchedContent: string;

  @ApiPropertyOptional()
  redactedContent?: string;

  @ApiPropertyOptional()
  contextBefore?: string;

  @ApiPropertyOptional()
  contextAfter?: string;

  @ApiPropertyOptional({ type: FindingLocationDto })
  location?: FindingLocationDto;

  @ApiProperty({ enum: FindingStatus })
  status: FindingStatus;

  @ApiPropertyOptional()
  resolutionReason?: string;

  @ApiPropertyOptional()
  comment?: string;

  @ApiPropertyOptional({ type: [FindingHistoryEntryDto] })
  history?: FindingHistoryEntryDto[];

  @ApiProperty()
  detectedAt: Date;

  @ApiPropertyOptional()
  firstDetectedAt?: Date;

  @ApiPropertyOptional()
  lastDetectedAt?: Date;

  @ApiPropertyOptional()
  resolvedAt?: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({ type: AssetResponseDto })
  asset?: AssetResponseDto;

  @ApiPropertyOptional({ type: SourceResponseDto })
  source?: SourceResponseDto;
}

export class FindingListResponseDto {
  @ApiProperty({ type: [FindingResponseDto] })
  findings: FindingResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  skip: number;

  @ApiProperty()
  limit: number;
}
