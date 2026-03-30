import { ApiProperty } from '@nestjs/swagger';

export class RunnersChartsTotalsDto {
  @ApiProperty() totalRuns: number;
  @ApiProperty() running: number;
  @ApiProperty() queued: number;
  @ApiProperty() completed: number;
  @ApiProperty() failed: number;
}

export class RunnersChartsTimelineBucketDto {
  @ApiProperty({ description: 'ISO date string YYYY-MM-DD' }) date: string;
  @ApiProperty() total: number;
  @ApiProperty() running: number;
  @ApiProperty() queued: number;
  @ApiProperty() completed: number;
  @ApiProperty() failed: number;
}

export class RunnersChartsTopSourceDto {
  @ApiProperty() sourceId: string;
  @ApiProperty() sourceName: string;
  @ApiProperty() runs: number;
  @ApiProperty() findings: number;
  @ApiProperty() assets: number;
}

export class SearchRunnersChartsResponseDto {
  @ApiProperty({ type: RunnersChartsTotalsDto })
  totals: RunnersChartsTotalsDto;

  @ApiProperty({ type: [RunnersChartsTimelineBucketDto] })
  timeline: RunnersChartsTimelineBucketDto[];

  @ApiProperty({ type: [RunnersChartsTopSourceDto] })
  topSources: RunnersChartsTopSourceDto[];
}
