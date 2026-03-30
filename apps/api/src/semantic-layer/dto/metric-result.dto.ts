import { ApiProperty } from '@nestjs/swagger';

export class MetricDimensionBreakdownDto {
  @ApiProperty({ example: 'CRITICAL' })
  dimensionValue: string;

  @ApiProperty({ example: 42 })
  value: number;
}

export class MetricResultDto {
  @ApiProperty({ example: 'false-positive-rate' })
  metricId: string;

  @ApiProperty({ example: 'False Positive Rate' })
  displayName: string;

  @ApiProperty({
    description: 'Computed scalar value',
    example: 12.5,
  })
  value: number | null;

  @ApiProperty({ nullable: true, example: 'percentage' })
  format: string | null;

  @ApiProperty({ nullable: true, example: '%' })
  unit: string | null;

  @ApiProperty({
    description: 'Breakdown by requested dimensions',
    type: [MetricDimensionBreakdownDto],
    required: false,
  })
  breakdown?: MetricDimensionBreakdownDto[];
}

export class TimeSeriesPointDto {
  @ApiProperty({ example: '2026-03-20T00:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: 42 })
  value: number;
}

export class MetricTimeSeriesResultDto {
  @ApiProperty({ example: 'total-findings' })
  metricId: string;

  @ApiProperty({ example: 'Total Findings' })
  displayName: string;

  @ApiProperty({ type: [TimeSeriesPointDto] })
  timeSeries: TimeSeriesPointDto[];

  @ApiProperty({ nullable: true })
  format: string | null;

  @ApiProperty({ nullable: true })
  unit: string | null;
}

export class DashboardMetricResultDto {
  @ApiProperty({ example: 'total-findings' })
  metricId: string;

  @ApiProperty({ example: 'Total Findings' })
  displayName: string;

  @ApiProperty({ example: 1234 })
  value: number | null;

  @ApiProperty({ nullable: true })
  format: string | null;

  @ApiProperty({ nullable: true })
  unit: string | null;

  @ApiProperty({ nullable: true })
  color: string | null;

  @ApiProperty({ example: 'md' })
  size: string;

  @ApiProperty({ example: 0 })
  position: number;

  @ApiProperty({ nullable: true, example: 'number' })
  chartType: string | null;
}

export class DashboardMetricsResponseDto {
  @ApiProperty({ example: 'discovery' })
  dashboard: string;

  @ApiProperty({ type: [DashboardMetricResultDto] })
  metrics: DashboardMetricResultDto[];
}
