import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class RetireOutOfScopeFindingsDto {
  @ApiPropertyOptional({
    description:
      'Default true: count what would be retired, by reason and exemption, ' +
      'as a background operation. Changes nothing.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({
    description:
      'Dry run only: restrict to these sources. A retire inherits the dry run’s sources.',
    type: [String],
    maxItems: 100,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  sourceIds?: string[];

  @ApiPropertyOptional({
    description:
      'Retire only: the completed dry run this retire carries out. It must be ' +
      'for the same, unchanged detector, less than 24 hours old, and not used before.',
  })
  @IsOptional()
  @IsString()
  fromOperationId?: string;

  @ApiPropertyOptional({
    description:
      "Retire only: the dry run's wouldRetire (or wouldRetireIncludingWatched " +
      'with includeInquiryWatched). The retire never changes more findings than this.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedCount?: number;

  @ApiPropertyOptional({ description: 'Retire only: must be true.' })
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;

  @ApiPropertyOptional({
    description:
      'Retire only, operator decision: also retire findings an ACTIVE inquiry ' +
      'watches. Findings a case cites are never retired.',
  })
  @IsOptional()
  @IsBoolean()
  includeInquiryWatched?: boolean;
}
