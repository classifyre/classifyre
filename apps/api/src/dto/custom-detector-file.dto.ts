import { ApiProperty } from '@nestjs/swagger';

/** A file uploaded to a code detector (CODE_DETECTOR), read with ctx.file(name). */
export class CustomDetectorFileDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  customDetectorId: string;

  @ApiProperty({ description: 'The name ctx.file(name) finds it by' })
  fileName: string;

  @ApiProperty()
  declaredMimeType: string;

  @ApiProperty()
  fileSizeBytes: number;

  @ApiProperty({
    description: 'SHA-256 of the bytes; part of the scan-cache fingerprint',
  })
  contentHash: string;

  @ApiProperty()
  createdAt: Date;
}
