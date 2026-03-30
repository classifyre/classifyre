import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { FindingStatus, Severity } from '@prisma/client';
import { Type } from 'class-transformer';
import { SearchFindingsFiltersInputDto } from './search-findings-request.dto';

export class BulkUpdateFindingsDto {
  @ApiPropertyOptional({
    description:
      'Explicit finding IDs to update. Use either ids or filters, not both.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsUUID(4, { each: true })
  ids?: string[];

  @ApiPropertyOptional({
    description: 'Filter to update all matching findings (select-all mode).',
    type: SearchFindingsFiltersInputDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SearchFindingsFiltersInputDto)
  filters?: SearchFindingsFiltersInputDto;

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
}
