import { ApiProperty } from '@nestjs/swagger';
import { AssetListItemDto } from './asset-list-item.dto';

export class AssetListResponseDto {
  @ApiProperty({ type: [AssetListItemDto] })
  items: AssetListItemDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  skip: number;

  @ApiProperty()
  limit: number;
}
