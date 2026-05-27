import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetContentType, SandboxRunStatus } from '@prisma/client';

export class SandboxRunDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  fileName: string;

  @ApiProperty({
    description: 'Raw MIME type detected by the CLI (e.g. "application/pdf")',
  })
  fileType: string;

  @ApiProperty({
    enum: AssetContentType,
    description: 'Internal content classification derived from the MIME type',
  })
  contentType: AssetContentType;

  @ApiProperty()
  fileExtension: string;

  @ApiProperty()
  fileSizeBytes: number;

  @ApiProperty()
  detectors: unknown;

  @ApiProperty()
  findings: unknown;

  @ApiProperty({ enum: SandboxRunStatus })
  status: SandboxRunStatus;

  @ApiPropertyOptional()
  errorMessage: string | null;

  @ApiPropertyOptional()
  durationMs: number | null;

  @ApiPropertyOptional({
    description:
      'S3 object key for the uploaded file (null when S3 is not configured)',
  })
  s3Key: string | null;

  @ApiPropertyOptional({
    description:
      'SHA-256 content hash of the uploaded file (used for duplicate detection)',
  })
  contentHash: string | null;
}
