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
import { RunnerAssetStatus } from '@prisma/client';

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

export enum SearchRunnersAssetsSortBy {
  CREATED_AT = 'CREATED_AT',
  COMPLETED_AT = 'COMPLETED_AT',
  STATUS = 'STATUS',
  STATUS_PRIORITY = 'STATUS_PRIORITY',
  ASSET_HASH = 'ASSET_HASH',
  FINDINGS_TOTAL = 'FINDINGS_TOTAL',
}

export enum SearchRunnersAssetsSortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class SearchRunnersAssetsFiltersInputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  runnerId?: string;

  @ApiPropertyOptional({
    description:
      'Case-insensitive text search across asset filename, hash, or error message',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: RunnerAssetStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @IsEnum(RunnerAssetStatus, { each: true })
  status?: RunnerAssetStatus[];

}

export class SearchRunnersAssetsPageDto {
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
    enum: SearchRunnersAssetsSortBy,
    default: SearchRunnersAssetsSortBy.STATUS_PRIORITY,
  })
  @IsOptional()
  @IsEnum(SearchRunnersAssetsSortBy)
  sortBy?: SearchRunnersAssetsSortBy = SearchRunnersAssetsSortBy.STATUS_PRIORITY;

  @ApiPropertyOptional({
    enum: SearchRunnersAssetsSortOrder,
    default: SearchRunnersAssetsSortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SearchRunnersAssetsSortOrder)
  sortOrder?: SearchRunnersAssetsSortOrder = SearchRunnersAssetsSortOrder.DESC;
}

export class SearchRunnersAssetsRequestDto {
  @ApiPropertyOptional({ type: SearchRunnersAssetsFiltersInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchRunnersAssetsFiltersInputDto)
  filters: SearchRunnersAssetsFiltersInputDto;

  @ApiPropertyOptional({ type: SearchRunnersAssetsPageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchRunnersAssetsPageDto)
  page?: SearchRunnersAssetsPageDto;
}
