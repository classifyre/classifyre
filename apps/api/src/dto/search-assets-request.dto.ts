import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DetectorType, FindingStatus, Severity } from '@prisma/client';
import { QueryAssetsDto } from './query-assets.dto';

export class SearchAssetsFiltersDto extends OmitType(QueryAssetsDto, [
  'skip',
  'limit',
] as const) {}

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

export class SearchFindingsFiltersDto {
  @ApiPropertyOptional({ enum: DetectorType, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @ArrayMaxSize(100)
  @IsEnum(DetectorType, { each: true })
  detectorType?: DetectorType[];

  @ApiPropertyOptional({
    description: 'Filter findings by custom detector keys',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  customDetectorKey?: string[];

  @ApiPropertyOptional({
    description: 'Filter by one or more finding runner IDs',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  runnerId?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  findingType?: string[];

  @ApiPropertyOptional({ description: 'Filter by categories', type: [String] })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  category?: string[];

  @ApiPropertyOptional({ enum: Severity, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @ArrayMaxSize(100)
  @IsEnum(Severity, { each: true })
  severity?: Severity[];

  @ApiPropertyOptional({ enum: FindingStatus, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @ArrayMaxSize(100)
  @IsEnum(FindingStatus, { each: true })
  status?: FindingStatus[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeResolved?: boolean = false;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  detectionIdentity?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  firstDetectedAfter?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  lastDetectedBefore?: Date;
}

export enum SearchAssetsSortBy {
  NAME = 'NAME',
  SOURCE_ID = 'SOURCE_ID',
  ASSET_TYPE = 'ASSET_TYPE',
  STATUS = 'STATUS',
  LAST_SCANNED_AT = 'LAST_SCANNED_AT',
  UPDATED_AT = 'UPDATED_AT',
  CREATED_AT = 'CREATED_AT',
}

export enum SearchAssetsSortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class SearchAssetsPageDto {
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
    enum: SearchAssetsSortBy,
    default: SearchAssetsSortBy.LAST_SCANNED_AT,
  })
  @IsOptional()
  @IsEnum(SearchAssetsSortBy)
  sortBy?: SearchAssetsSortBy = SearchAssetsSortBy.LAST_SCANNED_AT;

  @ApiPropertyOptional({
    enum: SearchAssetsSortOrder,
    default: SearchAssetsSortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SearchAssetsSortOrder)
  sortOrder?: SearchAssetsSortOrder = SearchAssetsSortOrder.DESC;
}

export class SearchAssetsOptionsDto {
  @ApiPropertyOptional({
    description:
      'When true, skip findings join and return assets with empty findings arrays',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  excludeFindings?: boolean = false;

  @ApiPropertyOptional({
    description:
      'When true, include assets even if they have no findings matching findings filters',
    default: false,
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeAssetsWithoutFindings?: boolean = false;
}

export class SearchAssetsRequestDto {
  @ApiPropertyOptional({ type: SearchAssetsFiltersDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchAssetsFiltersDto)
  assets?: SearchAssetsFiltersDto;

  @ApiPropertyOptional({ type: SearchFindingsFiltersDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchFindingsFiltersDto)
  findings?: SearchFindingsFiltersDto;

  @ApiPropertyOptional({ type: SearchAssetsPageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchAssetsPageDto)
  page?: SearchAssetsPageDto;

  @ApiPropertyOptional({ type: SearchAssetsOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchAssetsOptionsDto)
  options?: SearchAssetsOptionsDto;
}
