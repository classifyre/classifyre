import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { QueryFindingsDto } from './query-findings.dto';

export enum AssetFindingsSort {
  MostFindings = 'most_findings',
  Latest = 'latest',
  HighestSeverity = 'highest_severity',
}

export class QueryFindingsAssetsDto extends QueryFindingsDto {
  @ApiPropertyOptional({
    enum: AssetFindingsSort,
    default: AssetFindingsSort.MostFindings,
  })
  @IsOptional()
  @IsEnum(AssetFindingsSort)
  sort?: AssetFindingsSort = AssetFindingsSort.MostFindings;
}
