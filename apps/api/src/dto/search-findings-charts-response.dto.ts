import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FindingsChartsTotalsDto {
  @ApiProperty() total: number;
  @ApiProperty() critical: number;
  @ApiProperty() high: number;
  @ApiProperty() medium: number;
  @ApiProperty() low: number;
  @ApiProperty() info: number;
  @ApiProperty() open: number;
  @ApiProperty() resolved: number;
}

export class FindingsChartsTimelineBucketDto {
  @ApiProperty({ description: 'ISO date string YYYY-MM-DD' }) date: string;
  @ApiProperty() total: number;
  @ApiProperty() critical: number;
  @ApiProperty() high: number;
  @ApiProperty() medium: number;
  @ApiProperty() low: number;
  @ApiProperty() info: number;
}

export class FindingsChartsTopAssetDto {
  @ApiProperty() assetId: string;
  @ApiProperty() assetName: string;
  @ApiProperty() sourceId: string;
  @ApiPropertyOptional() sourceName: string | null;
  @ApiProperty() totalFindings: number;
  @ApiProperty() highestSeverity: string;
}

export class SearchFindingsChartsResponseDto {
  @ApiProperty({ type: FindingsChartsTotalsDto })
  totals: FindingsChartsTotalsDto;

  @ApiProperty({ type: [FindingsChartsTimelineBucketDto] })
  timeline: FindingsChartsTimelineBucketDto[];

  @ApiProperty({ type: [FindingsChartsTopAssetDto] })
  topAssets: FindingsChartsTopAssetDto[];
}
