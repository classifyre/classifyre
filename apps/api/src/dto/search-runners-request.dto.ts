import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AssetType, RunnerStatus, TriggerType } from '@prisma/client';

const normalizeToStringArray = (value: unknown, uppercase = false) => {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const values = raw
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) => (uppercase ? item.toUpperCase() : item));

  return Array.from(new Set(values));
};

export enum SearchRunnersSortBy {
  TRIGGERED_AT = 'TRIGGERED_AT',
  STATUS = 'STATUS',
  SOURCE_NAME = 'SOURCE_NAME',
  DURATION_MS = 'DURATION_MS',
  TOTAL_FINDINGS = 'TOTAL_FINDINGS',
}

export enum SearchRunnersSortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class SearchRunnersFiltersInputDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive text search across runner id, source name/type, triggeredBy, and error message',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  sourceId?: string[];

  @ApiPropertyOptional({ enum: AssetType, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @ArrayMaxSize(100)
  @IsEnum(AssetType, { each: true })
  sourceType?: AssetType[];

  @ApiPropertyOptional({ enum: RunnerStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @ArrayMaxSize(100)
  @IsEnum(RunnerStatus, { each: true })
  status?: RunnerStatus[];

  @ApiPropertyOptional({ enum: TriggerType, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @ArrayMaxSize(100)
  @IsEnum(TriggerType, { each: true })
  triggerType?: TriggerType[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  triggeredBy?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  triggeredAfter?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  triggeredBefore?: Date;
}

export class SearchRunnersPageDto {
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
  @Max(200)
  limit?: number = 50;

  @ApiPropertyOptional({
    enum: SearchRunnersSortBy,
    default: SearchRunnersSortBy.TRIGGERED_AT,
  })
  @IsOptional()
  @IsEnum(SearchRunnersSortBy)
  sortBy?: SearchRunnersSortBy = SearchRunnersSortBy.TRIGGERED_AT;

  @ApiPropertyOptional({
    enum: SearchRunnersSortOrder,
    default: SearchRunnersSortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SearchRunnersSortOrder)
  sortOrder?: SearchRunnersSortOrder = SearchRunnersSortOrder.DESC;
}

export class SearchRunnersRequestDto {
  @ApiPropertyOptional({ type: SearchRunnersFiltersInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchRunnersFiltersInputDto)
  filters?: SearchRunnersFiltersInputDto;

  @ApiPropertyOptional({ type: SearchRunnersPageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchRunnersPageDto)
  page?: SearchRunnersPageDto;
}
