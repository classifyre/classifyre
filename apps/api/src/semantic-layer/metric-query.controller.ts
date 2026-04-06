import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MetricEngineService } from './metric-engine.service';
import { AllowInDemoMode } from '../demo-mode.decorator';
import {
  QueryMetricDto,
  QueryMetricTimeSeriesDto,
  QueryDashboardMetricsDto,
} from './dto/query-metric.dto';

@AllowInDemoMode()
@ApiTags('Semantic Layer - Query')
@Controller('semantic/query')
export class MetricQueryController {
  constructor(private readonly metricEngine: MetricEngineService) {}

  @Post()
  @ApiOperation({
    summary: 'Evaluate a metric with optional dimensions and filters',
  })
  async queryMetric(@Body() dto: QueryMetricDto) {
    const result = await this.metricEngine.evaluateMetric(dto.metricId, {
      dimensions: dto.dimensions,
      filters: dto.filters,
      from: dto.from,
      to: dto.to,
      glossaryTermId: dto.glossaryTermId,
    });

    return {
      metricId: dto.metricId,
      value: result.value,
      breakdown: result.breakdown,
    };
  }

  @Post('timeseries')
  @ApiOperation({ summary: 'Evaluate a metric as a time series' })
  async queryTimeSeries(@Body() dto: QueryMetricTimeSeriesDto) {
    const timeSeries = await this.metricEngine.evaluateTimeSeries(
      dto.metricId,
      dto.granularity,
      {
        filters: dto.filters,
        from: dto.from,
        to: dto.to,
        glossaryTermId: dto.glossaryTermId,
      },
    );

    return {
      metricId: dto.metricId,
      timeSeries,
    };
  }

  @Post('dashboard')
  @ApiOperation({
    summary: 'Batch-evaluate all metrics placed on a dashboard',
  })
  async queryDashboard(@Body() dto: QueryDashboardMetricsDto) {
    return this.metricEngine.evaluateDashboard(dto.dashboard, {
      filters: dto.filters,
      from: dto.from,
      to: dto.to,
    });
  }

  @Post('explore')
  @ApiOperation({
    summary:
      'Explore detection data through a glossary term with metric breakdown',
  })
  async explore(
    @Body()
    dto: {
      glossaryTermId: string;
      metricIds: string[];
      dimensions?: string[];
      from?: string;
      to?: string;
    },
  ) {
    const results = await Promise.all(
      dto.metricIds.map(async (id) => {
        const result = await this.metricEngine.evaluateMetric(id, {
          dimensions: dto.dimensions,
          glossaryTermId: dto.glossaryTermId,
          from: dto.from,
          to: dto.to,
        });
        return {
          metricId: id,
          ...result,
        };
      }),
    );

    return {
      glossaryTermId: dto.glossaryTermId,
      results,
    };
  }
}
