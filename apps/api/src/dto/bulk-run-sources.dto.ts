import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SearchSourcesFiltersDto } from './search-sources-request.dto';

export class BulkRunSourcesDto {
  @ApiPropertyOptional({
    description: 'Explicit source IDs to run. Use either ids or filters.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @ApiPropertyOptional({
    description: 'Run every source matching this filter snapshot.',
    type: SearchSourcesFiltersDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchSourcesFiltersDto)
  filters?: SearchSourcesFiltersDto;

  @ApiPropertyOptional({
    description: 'Ignore the scan cache for every run started by this call.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  forceFullRescan?: boolean;
}

export class BulkRunSourcesSkippedDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Why this source could not be started' })
  reason!: string;
}

export class BulkRunSourcesResponseDto {
  @ApiProperty({
    description:
      'Number of runs queued. Runs beyond the concurrency limit stay PENDING until a slot frees up.',
  })
  startedCount!: number;

  @ApiProperty({ type: [String], description: 'IDs of the started sources' })
  ids!: string[];

  @ApiProperty({
    type: [BulkRunSourcesSkippedDto],
    description: 'Sources that could not be started, with the reason',
  })
  skipped!: BulkRunSourcesSkippedDto[];
}
