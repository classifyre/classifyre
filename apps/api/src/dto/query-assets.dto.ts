import { ApiPropertyOptional } from '@nestjs/swagger';
import { AssetStatus, AssetType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryAssetsDto {
  @ApiPropertyOptional({ description: 'Search by asset name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by source ID' })
  @IsOptional()
  @IsString()
  sourceId?: string;

  @ApiPropertyOptional({ description: 'Filter by runner ID' })
  @IsOptional()
  @IsString()
  runnerId?: string;

  @ApiPropertyOptional({
    description: 'Filter by one or more asset statuses',
    isArray: true,
    enum: AssetStatus,
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
  @IsEnum(AssetStatus, { each: true })
  status?: AssetStatus[];

  @ApiPropertyOptional({
    description: 'Filter by one or more source types',
    isArray: true,
    enum: AssetType,
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
  @IsEnum(AssetType, { each: true })
  sourceTypes?: AssetType[];

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
