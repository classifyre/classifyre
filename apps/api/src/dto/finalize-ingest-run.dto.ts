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

  @ApiPropertyOptional({
    description:
      'Relationship edges the API accepted and resolved during this run.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  relationshipsEmitted?: number;

  @ApiPropertyOptional({
    description:
      'Relationship passes that raised. Counts passes, not edges: a pass that ' +
      'failed never got to say how many edges it would have produced. Any ' +
      'value above zero downgrades the run to WARNING — lineage is not ' +
      'optional output, and a green run with none used to be indistinguishable ' +
      'from a green run with all of it.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  relationshipsFailed?: number;

  @ApiPropertyOptional({
    description:
      'Edges the connector assembled and could not send. A real edge count, ' +
      'and also a run downgrade.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  relationshipsLost?: number;

  @ApiPropertyOptional({
    description:
      'Edges accepted but with an endpoint that could not be resolved. ' +
      'Expected in small numbers — the other half of a cross-source edge may ' +
      'be ingested later — so this alone never downgrades a run.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  relationshipsDropped?: number;

  @ApiPropertyOptional({
    description:
      'Up to five distinct relationship errors, verbatim, so the cause is in ' +
      'the run record rather than only in a job log.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  relationshipErrors?: string[];
}
