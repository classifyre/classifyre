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
}
