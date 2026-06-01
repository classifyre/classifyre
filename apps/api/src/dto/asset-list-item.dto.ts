import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssetContentType, AssetStatus, AssetType } from '@prisma/client';

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

  @ApiProperty({ enum: AssetContentType })
  assetType: AssetContentType;

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

  @ApiPropertyOptional({
    description:
      'Hash of the parent asset when this asset was extracted from inside another file (e.g. an image embedded in a parquet/office document). Null for top-level assets.',
    nullable: true,
  })
  parentId?: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
