import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class BulkIngestAssetsDto {
  @ApiProperty({
    description: 'The runner ID for this ingestion batch',
    example: 'runner-123-abc',
  })
  @IsString()
  runnerId: string;

  @ApiProperty({
    description:
      'Array of assets to ingest (validated against output.json schema)',
    type: [Object],
    example: [
      {
        hash: 'V09SRFBSRVNTXyNfaHR0cHM6Ly9ibG9nLmV4YW1wbGUuY29tXyNfcG9zdHNfMTIz',
        name: 'My Document',
        external_url: 'https://blog.example.com/posts/my-document',
        checksum: 'a1b2c3d4',
        links: [],
        asset_type: 'URL',
        created_at: '2023-01-01T12:00:00Z',
        updated_at: '2023-01-01T12:00:00Z',
        findings: [
          {
            finding_type: 'email',
            category: 'pii',
            severity: 'medium',
            confidence: 0.95,
            matched_content: 'john@example.com',
          },
        ],
      },
    ],
  })
  @IsArray()
  assets: Record<string, any>[];

  @ApiPropertyOptional({
    description:
      'Whether this request should finalize the run immediately (defaults to true)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  finalizeRun?: boolean;
}
