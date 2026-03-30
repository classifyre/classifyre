import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsObject,
  IsDate,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Severity, DetectorType } from '@prisma/client';
import { Type } from 'class-transformer';

export class LocationDto {
  @ApiProperty({
    description:
      "Human-readable source reference: 'schema.table, row N' for tabular, URL for web/Slack",
  })
  @IsString()
  path: string;

  @ApiPropertyOptional({
    description: 'Additional detail, e.g. column name where value was found',
  })
  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateFindingDto {
  @ApiProperty()
  @IsString()
  assetId: string;

  @ApiProperty()
  @IsString()
  sourceId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  runnerId?: string;

  @ApiPropertyOptional({
    description: 'Custom detector ID when detectorType is CUSTOM',
  })
  @IsOptional()
  @IsString()
  customDetectorId?: string;

  @ApiPropertyOptional({
    description: 'Custom detector key when detectorType is CUSTOM',
  })
  @IsOptional()
  @IsString()
  customDetectorKey?: string;

  @ApiPropertyOptional({
    description: 'Custom detector display name when detectorType is CUSTOM',
  })
  @IsOptional()
  @IsString()
  customDetectorName?: string;

  @ApiProperty({ enum: DetectorType })
  @IsEnum(DetectorType)
  detectorType: DetectorType;

  @ApiProperty()
  @IsString()
  findingType: string;

  @ApiProperty()
  @IsString()
  category: string;

  @ApiProperty({ enum: Severity })
  @IsEnum(Severity)
  severity: Severity;

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence: number;

  @ApiProperty()
  @IsString()
  matchedContent: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  redactedContent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contextBefore?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contextAfter?: string;

  @ApiPropertyOptional({ type: LocationDto })
  @IsOptional()
  @IsObject()
  location?: LocationDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  detectedAt: Date;
}
