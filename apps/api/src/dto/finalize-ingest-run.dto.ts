import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

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
}
