import { ApiPropertyOptional } from '@nestjs/swagger';
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
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DetectorType, FindingStatus, Severity } from '@prisma/client';

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

export class SearchFindingsFiltersInputDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive text search across finding fields and related asset/source names',
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

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  assetId?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  runnerId?: string[];

  @ApiPropertyOptional({ enum: DetectorType, isArray: true })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @ArrayMaxSize(100)
  @IsEnum(DetectorType, { each: true })
  detectorType?: DetectorType[];

  @ApiPropertyOptional({
    description: 'Filter by custom detector keys',
    type: [String],
  })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  customDetectorKey?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value))
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  findingType?: string[];

  @ApiPropertyOptional({ type: [String] })
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

export class SearchFindingsPageDto {
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

export class SearchFindingsRequestDto {
  @ApiPropertyOptional({ type: SearchFindingsFiltersInputDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchFindingsFiltersInputDto)
  filters?: SearchFindingsFiltersInputDto;

  @ApiPropertyOptional({ type: SearchFindingsPageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchFindingsPageDto)
  page?: SearchFindingsPageDto;
}
