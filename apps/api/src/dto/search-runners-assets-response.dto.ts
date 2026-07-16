import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RunnerAssetStatus, TextExtractionStatus } from '@prisma/client';
import { AssetListItemDto } from './asset-list-item.dto';

export class RunnerAssetItemDto {
  @ApiProperty()
  runnerId: string;

  @ApiProperty()
  assetHash: string;

  @ApiProperty({ enum: RunnerAssetStatus })
  status: RunnerAssetStatus;

  @ApiPropertyOptional({ nullable: true })
  startedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  completedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  errorMessage: string | null;

  @ApiPropertyOptional({ enum: TextExtractionStatus, nullable: true })
  textExtractionStatus: TextExtractionStatus | null;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  findingsTotal: number | null;

  @ApiPropertyOptional({ nullable: true })
  findingsBySeverity: Record<string, number> | null;

  @ApiPropertyOptional({ nullable: true })
  findingsByDetector: Record<string, Record<string, number>> | null;

  @ApiPropertyOptional({
    description: 'Source-specific asset metadata (denormalized from the asset)',
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  metadata?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: AssetListItemDto, nullable: true })
  asset: AssetListItemDto | null;
}

export class SearchRunnersAssetsResponseDto {
  @ApiProperty({ type: [RunnerAssetItemDto] })
  items: RunnerAssetItemDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  skip: number;

  @ApiProperty()
  limit: number;
}
