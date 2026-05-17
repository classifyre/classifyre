import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DetectorType, FindingStatus, RunnerAssetStatus, Severity } from '@prisma/client';

export enum SearchRunnerAssetsSortBy {
  CREATED_AT = 'CREATED_AT',
  STATUS = 'STATUS',
  ASSET_HASH = 'ASSET_HASH',
  COMPLETED_AT = 'COMPLETED_AT',
}

export enum SearchRunnerAssetsSortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

const normalizeToStringArray = (value: unknown, uppercase = false) => {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  return Array.from(
    new Set(
      raw
        .map((item) => String(item).trim())
        .filter(Boolean)
        .map((item) => (uppercase ? item.toUpperCase() : item)),
    ),
  );
};

export class SearchRunnerAssetsFiltersInputDto {
  @ApiProperty({ description: 'Runner ID to scope assets to' })
  @IsString()
  runnerId: string;

  @ApiPropertyOptional({
    enum: RunnerAssetStatus,
    isArray: true,
    description: 'Filter by processing status',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(RunnerAssetStatus, { each: true })
  status?: RunnerAssetStatus[];

  @ApiPropertyOptional({
    description: 'Search on asset hash or asset name',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: Severity, isArray: true, description: 'Filter by finding severity' })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(Severity, { each: true })
  findingSeverity?: Severity[];

  @ApiPropertyOptional({ enum: FindingStatus, isArray: true, description: 'Filter by finding status' })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(FindingStatus, { each: true })
  findingStatus?: FindingStatus[];

  @ApiPropertyOptional({ enum: DetectorType, isArray: true, description: 'Filter by finding detector type' })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(DetectorType, { each: true })
  findingDetectorType?: DetectorType[];
}

export class SearchRunnerAssetsPageDto {
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
    enum: SearchRunnerAssetsSortBy,
    default: SearchRunnerAssetsSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(SearchRunnerAssetsSortBy)
  sortBy?: SearchRunnerAssetsSortBy = SearchRunnerAssetsSortBy.CREATED_AT;

  @ApiPropertyOptional({
    enum: SearchRunnerAssetsSortOrder,
    default: SearchRunnerAssetsSortOrder.ASC,
  })
  @IsOptional()
  @IsEnum(SearchRunnerAssetsSortOrder)
  sortOrder?: SearchRunnerAssetsSortOrder = SearchRunnerAssetsSortOrder.ASC;
}

export class SearchRunnerAssetsRequestDto {
  @ApiProperty({ type: SearchRunnerAssetsFiltersInputDto })
  @ValidateNested()
  @Type(() => SearchRunnerAssetsFiltersInputDto)
  filters: SearchRunnerAssetsFiltersInputDto;

  @ApiPropertyOptional({ type: SearchRunnerAssetsPageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchRunnerAssetsPageDto)
  page?: SearchRunnerAssetsPageDto;
}
