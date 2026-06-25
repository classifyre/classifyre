import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

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
}
