import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { AssetListItemDto } from './asset-list-item.dto';
import { FindingResponseDto } from './finding-response.dto';

export class SearchAssetFindingDto extends OmitType(FindingResponseDto, [
  'asset',
  'source',
  'history',
] as const) {}

export class SearchAssetMatchDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Similarity of the best-matching passage to the query (0-1). Null when the passage was found by its words alone.',
  })
  score: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      'Page of the asset the passage is on (1-based), when the asset has pages.',
  })
  page?: number | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The start of the passage that matched.',
  })
  text?: string | null;

  @ApiProperty({
    enum: ['meaning', 'words'],
    description:
      'What found the passage: its meaning (embedding similarity) or the words it shares with the query. Hybrid search prefers the words when one passage holds the exact figures of the query.',
  })
  via: 'meaning' | 'words';
}

export class SearchAssetItemDto {
  @ApiProperty({ type: AssetListItemDto })
  asset: AssetListItemDto;

  @ApiProperty({ type: [SearchAssetFindingDto] })
  findings: SearchAssetFindingDto[];

  @ApiPropertyOptional({
    type: SearchAssetMatchDto,
    description:
      'Semantic and hybrid search: where in the asset the query matched best. Absent when only the asset name matched.',
  })
  match?: SearchAssetMatchDto;
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

  @ApiPropertyOptional({
    description:
      'Present when results were ordered by semantic or hybrid relevance',
  })
  ranking?: {
    mode: string;
    query: string;
    explained: boolean;
  };
}
