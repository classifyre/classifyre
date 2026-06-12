import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { DetectorType, InquiryStatus, AiManagementMode, Severity } from '@prisma/client';

/** Matcher fields shared by create/update/preview — what findings a query selects. */
export class InquiryMatchersDto {
  @ApiPropertyOptional({
    description: 'Match findings from any source (ignores sourceIds)',
  })
  @IsOptional()
  @IsBoolean()
  matchAllSources?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'Source IDs to match' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceIds?: string[];

  @ApiPropertyOptional({
    enum: DetectorType,
    isArray: true,
    description: 'Empty = any detector',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(DetectorType, { each: true })
  detectorTypes?: DetectorType[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Custom detector keys to match',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customDetectorKeys?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Exact findingType matches',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  findingTypes?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Regex patterns matched against findingType',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  findingTypeRegex?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Regex patterns matched against matchedContent (the detected value). Empty = any.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  findingValueRegex?: string[];
}

export class CreateInquiryDto extends InquiryMatchersDto {
  @ApiProperty({ description: 'The question / monitor name' })
  @IsString()
  @MaxLength(500)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class UpdateInquiryDto extends InquiryMatchersDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: InquiryStatus })
  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;

  @ApiPropertyOptional({
    enum: AiManagementMode,
    description:
      'AI autopilot mode for this inquiry. INHERIT follows the instance setting; OBSERVE_ONLY blocks autopilot mutations.',
  })
  @IsOptional()
  @IsEnum(AiManagementMode)
  aiMode?: AiManagementMode;
}

export class QueryInquiriesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: InquiryStatus, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(InquiryStatus, { each: true })
  status?: InquiryStatus[];

  @ApiPropertyOptional({
    description:
      'Filter to inquiries linked to a case (or "none" for unlinked)',
  })
  @IsOptional()
  @IsString()
  caseId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}

/** A case an inquiry is linked to. */
export class InquiryLinkedCaseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  status!: string;
}

export class InquiryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    type: () => [InquiryLinkedCaseDto],
    description: 'Cases this inquiry drives',
  })
  cases!: InquiryLinkedCaseDto[];

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty({ enum: InquiryStatus })
  status!: InquiryStatus;

  @ApiProperty({ enum: AiManagementMode })
  aiMode!: AiManagementMode;

  @ApiPropertyOptional()
  createdBy?: string | null;

  @ApiProperty()
  matchAllSources!: boolean;

  @ApiProperty({ type: [String] })
  sourceIds!: string[];

  @ApiProperty({ enum: DetectorType, isArray: true })
  detectorTypes!: DetectorType[];

  @ApiProperty({ type: [String] })
  customDetectorKeys!: string[];

  @ApiProperty({ type: [String] })
  findingTypes!: string[];

  @ApiProperty({ type: [String] })
  findingTypeRegex!: string[];

  @ApiProperty({ type: [String] })
  findingValueRegex!: string[];

  @ApiProperty({ description: 'Findings currently matching this query' })
  matchCount!: number;

  @ApiProperty({ description: 'Matches that appeared since you last viewed' })
  newMatchCount!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class InquiryListResponseDto {
  @ApiProperty({ type: [InquiryResponseDto] })
  items!: InquiryResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  skip!: number;

  @ApiProperty()
  limit!: number;
}

/** A finding currently matching a question (joined live; not persisted as evidence). */
export class InquiryMatchDto {
  @ApiProperty()
  findingId!: string;

  @ApiProperty()
  label!: string;

  @ApiPropertyOptional()
  severity?: string;

  @ApiPropertyOptional()
  detectorType?: string;

  @ApiPropertyOptional()
  matchedContent?: string;

  @ApiProperty()
  assetId!: string;

  @ApiPropertyOptional()
  assetName?: string;

  @ApiPropertyOptional()
  sourceType?: string;

  @ApiProperty()
  matchedAt!: Date;

  @ApiProperty({ description: 'Appeared since the question was last viewed' })
  isNew!: boolean;
}

export class QueryInquiryMatchesDto {
  @ApiPropertyOptional({ description: 'Substring match on finding type, asset name or matched content' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: Severity, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Severity, { each: true })
  severity?: Severity[];

  @ApiPropertyOptional({ description: 'Only matches that appeared since last seen' })
  @IsOptional()
  @IsBoolean()
  onlyNew?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 50;
}

export class InquiryMatchListResponseDto {
  @ApiProperty({ type: [InquiryMatchDto] })
  items!: InquiryMatchDto[];

  @ApiProperty({ description: 'Total matches after filters' })
  total!: number;

  @ApiProperty({ description: 'New matches after filters (appeared since last seen)' })
  newCount!: number;

  @ApiProperty()
  skip!: number;

  @ApiProperty()
  limit!: number;
}

/** Preview the current matches of a matcher config before saving a question. */
export class PreviewInquiryDto extends InquiryMatchersDto {}

export class PreviewResponseDto {
  @ApiProperty({ description: 'Total findings currently matching' })
  total!: number;

  @ApiProperty({
    type: [InquiryMatchDto],
    description: 'Sample of matches (capped)',
  })
  sample!: InquiryMatchDto[];
}

class MatchOptionSourceDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() type!: string;
}

class MatchOptionCustomDetectorDto {
  @ApiProperty() key!: string;
  @ApiProperty() name!: string;
}

class MatchOptionFindingTypeDto {
  @ApiProperty() value!: string;
  @ApiProperty() detectorType!: string;
  @ApiProperty() count!: number;
}

/** Everything the create-question form needs to build matchers, in one call. */
export class MatchOptionsResponseDto {
  @ApiProperty({ type: [MatchOptionSourceDto] })
  sources!: MatchOptionSourceDto[];

  @ApiProperty({ type: [MatchOptionCustomDetectorDto] })
  customDetectors!: MatchOptionCustomDetectorDto[];

  @ApiProperty({
    type: [MatchOptionFindingTypeDto],
    description:
      'Distinct finding types (optionally scoped to selected sources)',
  })
  findingTypes!: MatchOptionFindingTypeDto[];
}
