import { ApiProperty } from '@nestjs/swagger';

export class QueryMetricDto {
  @ApiProperty({
    description: 'Metric id to evaluate',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  metricId: string;

  @ApiProperty({
    description: 'Dimensions to group by',
    example: ['severity', 'detectorType'],
    required: false,
  })
  dimensions?: string[];

  @ApiProperty({
    description: 'Additional filters to apply',
    example: { sourceIds: ['src-1'], severities: ['CRITICAL', 'HIGH'] },
    required: false,
  })
  filters?: Record<string, any>;

  @ApiProperty({
    description: 'Time range start',
    required: false,
  })
  from?: string;

  @ApiProperty({
    description: 'Time range end',
    required: false,
  })
  to?: string;

  @ApiProperty({
    description: 'Glossary term id to scope the query',
    required: false,
  })
  glossaryTermId?: string;
}

export class QueryMetricTimeSeriesDto extends QueryMetricDto {
  @ApiProperty({
    description: 'Time bucket granularity',
    enum: ['hour', 'day', 'week', 'month'],
    example: 'day',
  })
  granularity: 'hour' | 'day' | 'week' | 'month';
}

export class QueryDashboardMetricsDto {
  @ApiProperty({
    description: 'Dashboard identifier',
    example: 'discovery',
  })
  dashboard: string;

  @ApiProperty({
    description: 'Global filters applied to all metrics',
    required: false,
  })
  filters?: Record<string, any>;

  @ApiProperty({
    description: 'Time range start',
    required: false,
  })
  from?: string;

  @ApiProperty({
    description: 'Time range end',
    required: false,
  })
  to?: string;
}
