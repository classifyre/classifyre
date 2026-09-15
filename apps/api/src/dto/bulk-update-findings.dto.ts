import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { FindingStatus, Severity } from '@prisma/client';
import { Type } from 'class-transformer';
import { SearchFindingsFiltersInputDto } from './search-findings-request.dto';

/** Above this, an explicit id list is refused: use filters with expectedCount. */
export const BULK_UPDATE_MAX_IDS = 1000;

export class BulkUpdateFindingsDto {
  @ApiPropertyOptional({
    description:
      `Explicit finding IDs to update (at most ${BULK_UPDATE_MAX_IDS}). ` +
      'Use either ids or filters, not both.',
    type: [String],
    maxItems: BULK_UPDATE_MAX_IDS,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BULK_UPDATE_MAX_IDS)
  @IsUUID(4, { each: true })
  ids?: string[];

  @ApiPropertyOptional({
    description:
      'Filter to update all matching findings (select-all mode). Unknown keys ' +
      'are rejected with 400 rather than ignored.',
    type: SearchFindingsFiltersInputDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchFindingsFiltersInputDto)
  filters?: SearchFindingsFiltersInputDto;

  @ApiPropertyOptional({
    description:
      'Must be true when the filters narrow nothing beyond status, ' +
      'includeResolved and excludeIds — that is, when the update would apply ' +
      'to every finding in the namespace.',
  })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;

  @ApiPropertyOptional({
    description:
      'How many findings the caller expects the filters to match, e.g. from a ' +
      'dryRun. If more match when the update runs, it is refused with 409 and ' +
      'nothing is written.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedCount?: number;

  @ApiPropertyOptional({
    description:
      'Count what would be updated, and report whether the filters narrow the ' +
      'corpus, without writing anything.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ enum: FindingStatus })
  @IsOptional()
  @IsEnum(FindingStatus)
  status?: FindingStatus;

  @ApiPropertyOptional({ enum: Severity })
  @IsOptional()
  @IsEnum(Severity)
  severity?: Severity;

  @ApiPropertyOptional({
    description: 'Comment applied to all updated findings',
  })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class BulkUpdateFindingsResponseDto {
  @ApiProperty({ description: 'Number of findings successfully updated' })
  updatedCount: number;

  @ApiProperty({
    type: [String],
    description: 'IDs of updated findings (empty for filter-mode updates)',
  })
  ids: string[];

  @ApiPropertyOptional({
    description:
      'dryRun only: the exact number of findings the request would update.',
  })
  wouldUpdate?: number;

  @ApiPropertyOptional({
    description:
      'dryRun only: whether the filters select a subset of the corpus. When ' +
      'false, the real request needs confirm: true.',
  })
  narrowed?: boolean;

  @ApiPropertyOptional({ description: 'True when nothing was written.' })
  dryRun?: boolean;

  @ApiPropertyOptional({
    description:
      'Set when the selection was too large to change inside the request: the ' +
      'change runs as a background operation. Poll GET /findings/bulk-operations/{operationId}.',
  })
  operationId?: string;

  @ApiPropertyOptional({
    description: 'True when the change was queued rather than applied.',
  })
  async?: boolean;

  @ApiPropertyOptional({
    description: 'Findings the queued operation matched when it was created.',
  })
  total?: number;
}
