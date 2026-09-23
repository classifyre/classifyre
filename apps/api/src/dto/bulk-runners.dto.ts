import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SearchRunnersFiltersInputDto } from './search-runners-request.dto';

/**
 * Select scan runs either explicitly or as a filter snapshot, mirroring
 * {@link BulkRunSourcesDto} for sources.
 */
export class BulkRunnersDto {
  @ApiPropertyOptional({
    description: 'Explicit runner IDs. Use either ids or filters.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @ApiPropertyOptional({
    description:
      'Every runner matching this search filter snapshot. Use either ids or filters.',
    type: SearchRunnersFiltersInputDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchRunnersFiltersInputDto)
  filters?: SearchRunnersFiltersInputDto;
}

export class BulkStopRunnersDto extends BulkRunnersDto {}

export class BulkDeleteRunnersDto extends BulkRunnersDto {}

export class BulkRerunScansDto extends BulkRunnersDto {
  @ApiPropertyOptional({
    description: 'Ignore the scan cache for every run started by this call.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  forceFullRescan?: boolean;

  @ApiPropertyOptional({
    description:
      "Who started these runs, recorded as each run's triggeredBy. Defaults to 'bulk-rerun' so a run started this way is never anonymous.",
  })
  @IsOptional()
  @IsString()
  triggeredBy?: string;
}

export class BulkRunnersSkippedDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Why this runner was not processed' })
  reason!: string;
}

export class BulkStopRunnersResponseDto {
  @ApiProperty({
    description:
      'Number of runs stopped. PENDING runs are cancelled outright, RUNNING ones are torn down; all end STOPPED.',
  })
  stoppedCount!: number;

  @ApiProperty({ type: [String], description: 'IDs of the stopped runs' })
  ids!: string[];

  @ApiProperty({
    type: [BulkRunnersSkippedDto],
    description: 'Runs that could not be stopped, with the reason',
  })
  skipped!: BulkRunnersSkippedDto[];
}

export class BulkDeleteRunnersResponseDto {
  @ApiProperty({
    description: 'Number of scan records deleted.',
  })
  deletedCount!: number;

  @ApiProperty({ type: [String], description: 'IDs of the deleted runs' })
  ids!: string[];

  @ApiProperty({
    type: [BulkRunnersSkippedDto],
    description:
      'Runs that could not be deleted (e.g. still in flight), with the reason',
  })
  skipped!: BulkRunnersSkippedDto[];
}

export class BulkRerunScansResponseDto {
  @ApiProperty({
    description:
      'Number of runs queued. Runs beyond the concurrency limit stay PENDING until a slot frees up.',
  })
  startedCount!: number;

  @ApiProperty({ type: [String], description: 'IDs of the newly started runs' })
  ids!: string[];

  @ApiProperty({
    type: [BulkRunnersSkippedDto],
    description: 'Runs whose source could not be started, with the reason',
  })
  skipped!: BulkRunnersSkippedDto[];
}
