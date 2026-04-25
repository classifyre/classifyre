import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MetricsService } from './metrics.service';
import { GlossaryService } from './glossary.service';
import { Prisma } from '@prisma/client';

interface SimpleDefinition {
  aggregation: 'COUNT' | 'COUNT_DISTINCT' | 'SUM' | 'AVG' | 'MIN' | 'MAX';
  entity: 'finding' | 'asset';
  field?: string;
  filters?: Record<string, any>;
}

interface RatioDefinition {
  numerator: SimpleDefinition | { metricId: string };
  denominator: SimpleDefinition | { metricId: string };
}

interface DerivedDefinition {
  formula: string;
  inputs: string[];
}

interface TrendDefinition {
  baseMetricId: string;
  compareWindow: string;
  currentWindow: string;
}

@Injectable()
export class MetricEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
    private readonly glossaryService: GlossaryService,
  ) {}

  /**
   * Evaluate a single metric and return its scalar value.
   */
  async evaluateMetric(
    id: string,
    options?: {
      dimensions?: string[];
      filters?: Record<string, any>;
      from?: string;
      to?: string;
      glossaryTermId?: string;
    },
  ): Promise<{
    value: number | null;
    breakdown?: { dimensionValue: string; value: number }[];
  }> {
    const metric = await this.metricsService.findById(id);
    const def = metric.definition as Record<string, any>;

    // Build base WHERE from glossary term if provided
    let glossaryWhere: Prisma.FindingWhereInput = {};
    if (options?.glossaryTermId) {
      const term = await this.glossaryService.findById(options.glossaryTermId);
      glossaryWhere = this.glossaryService.resolveToFindingFilter(
        term.filterMapping as Record<string, any>,
      );
    } else if (metric.glossaryTermId && metric.glossaryTerm) {
      glossaryWhere = this.glossaryService.resolveToFindingFilter(
        (metric.glossaryTerm as any).filterMapping as Record<string, any>,
      );
    }

    // Build time range filter
    const timeWhere = this.buildTimeFilter(options?.from, options?.to);

    // Build additional filters
    const additionalWhere = this.buildAdditionalFilters(options?.filters);

    switch (metric.type) {
      case 'SIMPLE':
        return this.evaluateSimple(
          def as unknown as SimpleDefinition,
          { ...glossaryWhere, ...timeWhere, ...additionalWhere },
          options?.dimensions,
        );
      case 'RATIO':
        return this.evaluateRatio(def as unknown as RatioDefinition, {
          ...glossaryWhere,
          ...timeWhere,
          ...additionalWhere,
        });
      case 'DERIVED':
        return this.evaluateDerived(
          def as unknown as DerivedDefinition,
          options,
        );
      case 'TREND':
        return this.evaluateTrend(def as unknown as TrendDefinition);
      default:
        throw new BadRequestException(
          `Unknown metric type: ${String(metric.type)}`,
        );
    }
  }

  /**
   * Evaluate a metric as a time series.
   */
  async evaluateTimeSeries(
    id: string,
    granularity: 'hour' | 'day' | 'week' | 'month',
    options?: {
      filters?: Record<string, any>;
      from?: string;
      to?: string;
      glossaryTermId?: string;
    },
  ): Promise<{ timestamp: string; value: number }[]> {
    const metric = await this.metricsService.findById(id);

    // For time series, we only support SIMPLE metrics directly
    // RATIO/DERIVED would need the engine to compute each bucket
    if (metric.type !== 'SIMPLE') {
      throw new BadRequestException(
        `Time series queries currently only support SIMPLE metrics, got ${metric.type}`,
      );
    }

    const def = metric.definition as unknown as SimpleDefinition;

    let glossaryWhere: Prisma.FindingWhereInput = {};
    if (options?.glossaryTermId) {
      const term = await this.glossaryService.findById(options.glossaryTermId);
      glossaryWhere = this.glossaryService.resolveToFindingFilter(
        term.filterMapping as Record<string, any>,
      );
    }

    const timeWhere = this.buildTimeFilter(options?.from, options?.to);
    const additionalWhere = this.buildAdditionalFilters(options?.filters);
    const defFilters = this.buildAdditionalFilters(def.filters);
    const combinedWhere = {
      ...glossaryWhere,
      ...timeWhere,
      ...additionalWhere,
      ...defFilters,
    };

    this.getDateTruncExpression(granularity);

    // Use raw SQL for date_trunc grouping
    const entity = def.entity ?? 'finding';
    if (entity !== 'finding') {
      throw new BadRequestException(
        'Time series only supported for finding entity',
      );
    }

    const results: { bucket: Date; count: bigint }[] =
      await this.prisma.$queryRawUnsafe(
        `SELECT date_trunc($1, detected_at) AS bucket, COUNT(*)::bigint AS count
         FROM findings
         WHERE detected_at >= $2::timestamp AND detected_at <= $3::timestamp
         ${this.buildRawWhereClause(combinedWhere)}
         GROUP BY bucket
         ORDER BY bucket ASC`,
        granularity,
        options?.from
          ? new Date(options.from)
          : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        options?.to ? new Date(options.to) : new Date(),
      );

    return results.map((r) => ({
      timestamp: r.bucket.toISOString(),
      value: Number(r.count),
    }));
  }

  /**
   * Batch-evaluate all metrics placed on a specific dashboard.
   */
  async evaluateDashboard(
    dashboard: string,
    options?: {
      filters?: Record<string, any>;
      from?: string;
      to?: string;
    },
  ) {
    const placements = await this.metricsService.findByDashboard(dashboard);
    const results = await Promise.all(
      placements.map(async (placement) => {
        const metric = placement.metricDefinition;
        try {
          const result = await this.evaluateMetric(metric.id, {
            filters: {
              ...((placement.pinnedFilters as Record<string, any>) ?? {}),
              ...(options?.filters ?? {}),
            },
            from: options?.from,
            to: options?.to,
          });
          return {
            metricId: metric.id,
            displayName: metric.displayName,
            value: result.value,
            format: metric.format,
            unit: metric.unit,
            color: metric.color,
            size: placement.size,
            position: placement.position,
            chartType: placement.chartType,
          };
        } catch (err) {
          return {
            metricId: metric.id,
            displayName: metric.displayName,
            value: null,
            error:
              err instanceof BadRequestException
                ? err.message
                : 'Evaluation failed',
            format: metric.format,
            unit: metric.unit,
            color: metric.color,
            size: placement.size,
            position: placement.position,
            chartType: placement.chartType,
          };
        }
      }),
    );

    return { dashboard, metrics: results };
  }

  // ── Private evaluation methods ──────────────────────────────────

  private async evaluateSimple(
    def: SimpleDefinition,
    where: Prisma.FindingWhereInput,
    dimensions?: string[],
  ): Promise<{
    value: number | null;
    breakdown?: { dimensionValue: string; value: number }[];
  }> {
    const defFilters = this.buildAdditionalFilters(def.filters);
    const combinedWhere = { ...where, ...defFilters };

    const entity = def.entity ?? 'finding';

    if (entity === 'asset') {
      const count = await this.prisma.asset.count({
        where: combinedWhere as any,
      });
      return { value: count };
    }

    // Finding-based aggregation
    switch (def.aggregation) {
      case 'COUNT': {
        const count = await this.prisma.finding.count({
          where: combinedWhere,
        });

        let breakdown: { dimensionValue: string; value: number }[] | undefined;
        if (dimensions?.length) {
          breakdown = await this.groupByDimension(combinedWhere, dimensions[0]);
        }

        return { value: count, breakdown };
      }
      case 'COUNT_DISTINCT': {
        if (!def.field) {
          throw new BadRequestException(
            'COUNT_DISTINCT requires a field parameter',
          );
        }
        const results: { count: bigint }[] = await this.prisma.$queryRawUnsafe(
          `SELECT COUNT(DISTINCT ${this.sanitizeFieldName(def.field)})::bigint AS count FROM findings ${this.buildRawWhereFromPrisma(combinedWhere)}`,
        );
        return { value: Number(results[0]?.count ?? 0) };
      }
      case 'AVG':
      case 'SUM':
      case 'MIN':
      case 'MAX': {
        if (!def.field) {
          throw new BadRequestException(
            `${def.aggregation} requires a field parameter`,
          );
        }
        // Only 'confidence' is a numeric field supported by Prisma aggregate
        const numericField =
          def.field === 'confidence' ? ('confidence' as const) : null;
        if (!numericField) {
          throw new BadRequestException(
            `Field '${def.field}' is not supported for ${def.aggregation} aggregation. Supported: confidence`,
          );
        }
        const aggOption = { confidence: true as const };
        const agg = await this.prisma.finding.aggregate({
          where: combinedWhere,
          _avg: def.aggregation === 'AVG' ? aggOption : undefined,
          _sum: def.aggregation === 'SUM' ? aggOption : undefined,
          _min: def.aggregation === 'MIN' ? aggOption : undefined,
          _max: def.aggregation === 'MAX' ? aggOption : undefined,
        });

        const aggKey = `_${def.aggregation.toLowerCase()}` as keyof typeof agg;
        const result = agg[aggKey] as any;
        return {
          value:
            result?.[numericField] != null
              ? Number(result[numericField])
              : null,
        };
      }
      default:
        throw new BadRequestException(
          `Unknown aggregation: ${String(def.aggregation)}`,
        );
    }
  }

  private async evaluateRatio(
    def: RatioDefinition,
    baseWhere: Prisma.FindingWhereInput,
  ): Promise<{ value: number | null }> {
    const [numerator, denominator] = await Promise.all([
      this.evaluateSubExpression(def.numerator, baseWhere),
      this.evaluateSubExpression(def.denominator, baseWhere),
    ]);

    if (denominator === null || denominator === 0) {
      return { value: null };
    }

    return { value: (numerator ?? 0) / denominator };
  }

  private async evaluateSubExpression(
    expr: SimpleDefinition | { metricId: string },
    baseWhere: Prisma.FindingWhereInput,
  ): Promise<number | null> {
    if ('metricId' in expr) {
      const result = await this.evaluateMetric(expr.metricId);
      return result.value;
    }
    const result = await this.evaluateSimple(expr, baseWhere);
    return result.value;
  }

  private async evaluateDerived(
    def: DerivedDefinition,
    options?: Record<string, any>,
  ): Promise<{ value: number | null }> {
    const inputValues: Record<string, number> = {};

    // Use index-based variable names (v0, v1, ...) since inputs are now UUIDs
    for (let i = 0; i < def.inputs.length; i++) {
      const result = await this.evaluateMetric(def.inputs[i], options);
      inputValues[`v${i}`] = result.value ?? 0;
    }

    try {
      // Simple formula evaluation - replace variable names with values
      let formula = def.formula;
      for (const [key, val] of Object.entries(inputValues)) {
        formula = formula.replace(new RegExp(key, 'g'), String(val));
      }

      // Safe eval using Function constructor (only arithmetic)
      const sanitized = formula.replace(/[^0-9+\-*/().%\s]/g, '');
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const value = new Function(`return (${sanitized})`)() as number;
      return { value: isFinite(value) ? value : null };
    } catch {
      return { value: null };
    }
  }

  private async evaluateTrend(
    def: TrendDefinition,
  ): Promise<{ value: number | null }> {
    const currentMs = this.parseWindow(def.currentWindow);
    const compareMs = this.parseWindow(def.compareWindow);

    const now = new Date();
    const currentFrom = new Date(now.getTime() - currentMs);
    const compareFrom = new Date(currentFrom.getTime() - compareMs);

    const [current, previous] = await Promise.all([
      this.evaluateMetric(def.baseMetricId, {
        from: currentFrom.toISOString(),
        to: now.toISOString(),
      }),
      this.evaluateMetric(def.baseMetricId, {
        from: compareFrom.toISOString(),
        to: currentFrom.toISOString(),
      }),
    ]);

    if (previous.value === null || previous.value === 0) {
      return { value: null };
    }

    const change =
      ((current.value ?? 0) - previous.value) / Math.abs(previous.value);
    return { value: change };
  }

  // ── Helper methods ──────────────────────────────────────────────

  private buildTimeFilter(
    from?: string,
    to?: string,
  ): Prisma.FindingWhereInput {
    if (!from && !to) return {};
    const filter: Prisma.FindingWhereInput = {};
    const detectedAt: any = {};
    if (from) detectedAt.gte = new Date(from);
    if (to) detectedAt.lte = new Date(to);
    filter.detectedAt = detectedAt;
    return filter;
  }

  private buildAdditionalFilters(
    filters?: Record<string, any>,
  ): Prisma.FindingWhereInput {
    if (!filters) return {};
    const where: Prisma.FindingWhereInput = {};

    if (filters.sourceIds?.length) {
      where.sourceId = { in: filters.sourceIds };
    }
    if (filters.severities?.length) {
      where.severity = { in: filters.severities };
    }
    if (filters.detectorTypes?.length) {
      where.detectorType = { in: filters.detectorTypes };
    }
    if (filters.statuses?.length) {
      where.status = { in: filters.statuses };
    }
    if (filters.findingTypes?.length) {
      where.findingType = { in: filters.findingTypes };
    }
    if (filters.customDetectorKeys?.length) {
      where.customDetectorKey = { in: filters.customDetectorKeys };
    }

    return where;
  }

  private async groupByDimension(
    where: Prisma.FindingWhereInput,
    dimension: string,
  ): Promise<{ dimensionValue: string; value: number }[]> {
    const fieldMap = {
      severity: 'severity',
      detectorType: 'detectorType',
      status: 'status',
      findingType: 'findingType',
      category: 'category',
      customDetectorKey: 'customDetectorKey',
    } as const;

    const field = (fieldMap as Record<string, string>)[dimension];
    if (!field) return [];

    const grouped = await this.prisma.finding.groupBy({
      by: [field] as unknown as Prisma.FindingScalarFieldEnum[],
      where,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    return grouped.map((g) => ({
      dimensionValue: String(g[field]),
      value: typeof g._count === 'object' ? (g._count.id ?? 0) : 0,
    }));
  }

  private parseWindow(window: string): number {
    const match = window.match(/^(\d+)([hdwm])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      case 'w':
        return value * 7 * 24 * 60 * 60 * 1000;
      case 'm':
        return value * 30 * 24 * 60 * 60 * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000;
    }
  }

  private sanitizeFieldName(field: string): string {
    // Only allow known column names to prevent SQL injection
    const allowed = new Set([
      'id',
      'asset_id',
      'source_id',
      'detector_type',
      'finding_type',
      'category',
      'severity',
      'confidence',
      'status',
      'custom_detector_id',
      'custom_detector_key',
      'custom_detector_name',
    ]);
    // Convert camelCase to snake_case
    const snaked = field.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`);
    if (!allowed.has(snaked)) {
      throw new BadRequestException(`Field '${field}' is not allowed`);
    }
    return snaked;
  }

  private buildRawWhereClause(where: Prisma.FindingWhereInput): string {
    // Build additional raw WHERE conditions from glossary/filter mappings
    // Only allow known enum values to prevent SQL injection
    const conditions: string[] = [];

    const allowedDetectorTypes = new Set([
      'SECRETS',
      'PII',
      'TOXIC',
      'NSFW',
      'YARA',
      'BROKEN_LINKS',
      'PROMPT_INJECTION',
      'PHISHING_URL',
      'SPAM',
      'LANGUAGE',
      'CODE_SECURITY',
      'CUSTOM',
    ]);
    const allowedSeverities = new Set([
      'CRITICAL',
      'HIGH',
      'MEDIUM',
      'LOW',
      'INFO',
    ]);
    const allowedStatuses = new Set([
      'OPEN',
      'FALSE_POSITIVE',
      'RESOLVED',
      'IGNORED',
    ]);

    if (where.detectorType && 'in' in (where.detectorType as any)) {
      const values = ((where.detectorType as any).in as string[]).filter((v) =>
        allowedDetectorTypes.has(v),
      );
      if (values.length) {
        conditions.push(
          `detector_type IN (${values.map((v) => `'${v}'`).join(',')})`,
        );
      }
    }
    if (where.severity && 'in' in (where.severity as any)) {
      const values = ((where.severity as any).in as string[]).filter((v) =>
        allowedSeverities.has(v),
      );
      if (values.length) {
        conditions.push(
          `severity IN (${values.map((v) => `'${v}'`).join(',')})`,
        );
      }
    }
    if (where.status && 'in' in (where.status as any)) {
      const values = ((where.status as any).in as string[]).filter((v) =>
        allowedStatuses.has(v),
      );
      if (values.length) {
        conditions.push(`status IN (${values.map((v) => `'${v}'`).join(',')})`);
      }
    }

    if (where.customDetectorKey && 'in' in (where.customDetectorKey as any)) {
      const values = ((where.customDetectorKey as any).in as string[]).filter(
        (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]+$/.test(v),
      );
      if (values.length) {
        conditions.push(
          `custom_detector_key IN (${values.map((v) => `'${v}'`).join(',')})`,
        );
      }
    }

    return conditions.length ? `AND ${conditions.join(' AND ')}` : '';
  }

  private buildRawWhereFromPrisma(where: Prisma.FindingWhereInput): string {
    const clause = this.buildRawWhereClause(where);
    if (!clause) return '';
    return `WHERE 1=1 ${clause}`;
  }

  private getDateTruncExpression(
    granularity: 'hour' | 'day' | 'week' | 'month',
  ): string {
    return granularity;
  }
}
