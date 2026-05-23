import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RunnerAssetStatus } from '@prisma/client';
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

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  findingsTotal: number | null;

  @ApiPropertyOptional({ nullable: true })
  findingsBySeverity: Record<string, number> | null;

  @ApiPropertyOptional({ nullable: true })
  findingsByDetector: Record<string, Record<string, number>> | null;

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
