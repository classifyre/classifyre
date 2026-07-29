import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class FinalizeIngestRunDto {
  @ApiProperty({
    description: 'The runner ID that should be finalized',
    example: 'runner-123-abc',
  })
  @IsString()
  runnerId: string;

  @ApiProperty({
    description: 'Hashes observed during extraction for this run',
    type: [String],
    example: ['hash-1', 'hash-2'],
  })
  @IsArray()
  seenHashes: string[];

  @ApiPropertyOptional({
    description:
      'Opaque, source-defined AUTOMATIC sampling cursor to persist on the ' +
      'source for the next run. Omitted for non-AUTOMATIC strategies so the ' +
      'stored cursor is left unchanged.',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  samplingCursor?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Assets this run skipped entirely on scan-cache evidence — content and ' +
      'every applicable detector configuration unchanged since their last ' +
      'completed scan.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  assetsSkippedCached?: number;

  @ApiPropertyOptional({
    description:
      'Individual detector runs avoided across all assets, counting the ' +
      'partial skips on assets where only some detectors had to re-run.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  detectorRunsSkipped?: number;
}
