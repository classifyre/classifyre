import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  AssetContentType,
  DetectorType,
  SandboxRunStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export enum SandboxRunsSortBy {
  CREATED_AT = 'CREATED_AT',
  FILE_NAME = 'FILE_NAME',
  STATUS = 'STATUS',
  FILE_SIZE_BYTES = 'FILE_SIZE_BYTES',
  DURATION_MS = 'DURATION_MS',
  FINDINGS_COUNT = 'FINDINGS_COUNT',
}

export enum SandboxRunsSortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class QuerySandboxRunsDto {
  @ApiPropertyOptional({
    description: 'Search by file name or MIME type',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by one or more run statuses',
    isArray: true,
    enum: SandboxRunStatus,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    return undefined;
  })
  @IsEnum(SandboxRunStatus, { each: true })
  status?: SandboxRunStatus[];

  @ApiPropertyOptional({
    description: 'Filter by one or more content types',
    isArray: true,
    enum: AssetContentType,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    return undefined;
  })
  @IsEnum(AssetContentType, { each: true })
  contentType?: AssetContentType[];

  @ApiPropertyOptional({
    description:
      'Filter by detectors used in the run configuration or reported findings',
    isArray: true,
    enum: DetectorType,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    return undefined;
  })
  @IsEnum(DetectorType, { each: true })
  detectorType?: DetectorType[];

  @ApiPropertyOptional({
    description: 'Filter by whether findings exist',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasFindings?: boolean;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: SandboxRunsSortBy,
    default: SandboxRunsSortBy.CREATED_AT,
  })
  @IsOptional()
  @IsEnum(SandboxRunsSortBy)
  sortBy?: SandboxRunsSortBy = SandboxRunsSortBy.CREATED_AT;

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: SandboxRunsSortOrder,
    default: SandboxRunsSortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(SandboxRunsSortOrder)
  sortOrder?: SandboxRunsSortOrder = SandboxRunsSortOrder.DESC;

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
}
