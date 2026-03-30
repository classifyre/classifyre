import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AssetType, RunnerStatus } from '@prisma/client';

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

export class SearchSourcesFiltersDto {
  @ApiPropertyOptional({
    description: 'Filter by source name (case-insensitive contains)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: AssetType,
    isArray: true,
    description: 'Filter by source type',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @ArrayMaxSize(20)
  @IsEnum(AssetType, { each: true })
  type?: AssetType[];

  @ApiPropertyOptional({
    enum: RunnerStatus,
    isArray: true,
    description: 'Filter by runner status',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeToStringArray(value, true))
  @IsArray()
  @ArrayMaxSize(10)
  @IsEnum(RunnerStatus, { each: true })
  status?: RunnerStatus[];
}

export class SearchSourcesPageDto {
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 25;
}

export class SearchSourcesRequestDto {
  @ApiPropertyOptional({ type: SearchSourcesFiltersDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchSourcesFiltersDto)
  filters?: SearchSourcesFiltersDto;

  @ApiPropertyOptional({ type: SearchSourcesPageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchSourcesPageDto)
  page?: SearchSourcesPageDto;
}
