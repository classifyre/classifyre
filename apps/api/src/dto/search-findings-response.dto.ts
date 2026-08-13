import { ApiPropertyOptional } from '@nestjs/swagger';
import { FindingListResponseDto } from './finding-response.dto';

export class SearchFindingsRankingMetadataDto {
  @ApiPropertyOptional()
  mode?: string;

  @ApiPropertyOptional()
  query?: string;

  @ApiPropertyOptional()
  explained?: boolean;
}

export class SearchFindingsResponseDto extends FindingListResponseDto {
  @ApiPropertyOptional({ type: SearchFindingsRankingMetadataDto })
  ranking?: SearchFindingsRankingMetadataDto;

  /**
   * True when `total` is a floor rather than the exact number of matches.
   *
   * Counting every match of a filter the statistics rollup cannot answer is a
   * full-table `count(*)` — 2.0 s of the 2.7 s an unfiltered findings page used
   * to take, purely to render a number nobody paginates to. The count now stops
   * once it has more than it needs, and says so here rather than reporting a
   * capped figure as if it were exact.
   */
  @ApiPropertyOptional({
    description:
      'When true, `total` is a lower bound (the count was capped) and the UI should present it as e.g. "10,000+".',
  })
  totalIsLowerBound?: boolean;
}
