import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SearchSourcesFiltersDto } from './search-sources-request.dto';

const SOURCE_SCHEDULE_MODES = ['OFF', 'CRON', 'AUTO'] as const;
const SOURCE_SAMPLING_STRATEGIES = [
  'AUTOMATIC',
  'RANDOM',
  'LATEST',
  'ALL',
] as const;

export class BulkUpdateSourcesScheduleDto {
  @ApiProperty({ enum: SOURCE_SCHEDULE_MODES })
  @IsIn(SOURCE_SCHEDULE_MODES)
  mode: (typeof SOURCE_SCHEDULE_MODES)[number];

  @ApiPropertyOptional({ example: '30 1 * * *' })
  @IsOptional()
  @IsString()
  cron?: string;

  @ApiPropertyOptional({ example: 'UTC' })
  @IsOptional()
  @IsString()
  timezone?: string;
}

export class BulkUpdateSourcesSamplingDto {
  @ApiProperty({ enum: SOURCE_SAMPLING_STRATEGIES })
  @IsIn(SOURCE_SAMPLING_STRATEGIES)
  strategy: (typeof SOURCE_SAMPLING_STRATEGIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  order_by_column?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  fallback_to_random?: boolean;

  @ApiPropertyOptional({ minimum: 10, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(10000)
  rows_per_page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  include_column_names?: boolean;
}

export class BulkUpdateSourcesDto {
  @ApiPropertyOptional({
    description: 'Explicit source IDs to update. Use either ids or filters.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @ApiPropertyOptional({
    description: 'Update every source matching this filter snapshot.',
    type: SearchSourcesFiltersDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchSourcesFiltersDto)
  filters?: SearchSourcesFiltersDto;

  @ApiPropertyOptional({
    description:
      'New schedule for all selected sources. Omit to leave schedules unchanged.',
    type: BulkUpdateSourcesScheduleDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkUpdateSourcesScheduleDto)
  schedule?: BulkUpdateSourcesScheduleDto;

  @ApiPropertyOptional({
    description:
      'New sampling block for all selected sources. Other config sections are preserved.',
    type: BulkUpdateSourcesSamplingDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BulkUpdateSourcesSamplingDto)
  sampling?: BulkUpdateSourcesSamplingDto;
}

export class BulkUpdateSourcesResponseDto {
  @ApiProperty({ description: 'Number of sources successfully updated' })
  updatedCount: number;

  @ApiProperty({ type: [String], description: 'IDs of updated sources' })
  ids: string[];
}
