import { ApiProperty, OmitType } from '@nestjs/swagger';
import { AssetListItemDto } from './asset-list-item.dto';
import { FindingResponseDto } from './finding-response.dto';

export class SearchAssetFindingDto extends OmitType(FindingResponseDto, [
  'asset',
  'source',
  'history',
] as const) {}

export class SearchAssetItemDto {
  @ApiProperty({ type: AssetListItemDto })
  asset: AssetListItemDto;

  @ApiProperty({ type: [SearchAssetFindingDto] })
  findings: SearchAssetFindingDto[];
}

export class SearchAssetsResponseDto {
  @ApiProperty({ type: [SearchAssetItemDto] })
  items: SearchAssetItemDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  skip: number;

  @ApiProperty()
  limit: number;
}
