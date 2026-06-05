import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetStatus, AssetType } from '@prisma/client';

export class AssetListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  hash: string;

  @ApiProperty()
  checksum: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  externalUrl: string;

  @ApiProperty({ type: [String] })
  links: string[];

  @ApiProperty({
    description: 'Catalog asset kind (file, image, page, comment, table, ...)',
  })
  assetType: string;

  @ApiProperty({ enum: AssetType })
  sourceType: AssetType;

  @ApiProperty()
  sourceId: string;

  @ApiPropertyOptional()
  runnerId?: string | null;

  @ApiPropertyOptional()
  lastScannedAt?: Date | null;

  @ApiProperty({ enum: AssetStatus })
  status: AssetStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({
    description: 'Source-specific asset metadata',
    type: 'object',
    additionalProperties: true,
  })
  metadata?: Record<string, unknown>;
}
