import { ApiProperty } from '@nestjs/swagger';

export class UploadedSourceFileDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  sourceId: string;

  @ApiProperty()
  fileName: string;

  @ApiProperty()
  declaredMimeType: string;

  @ApiProperty()
  fileExtension: string;

  @ApiProperty()
  fileSizeBytes: number;

  @ApiProperty({ description: 'SHA-256 hash of the uploaded bytes' })
  contentHash: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
