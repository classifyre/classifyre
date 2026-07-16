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
}
