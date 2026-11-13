import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FindingStatus, Prisma, type QualityRule } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { QueryRunService } from '../data-query/query-run.service';
import { columnsOf } from './governance-columns.service';
import { GovernanceNotifier } from './governance-notifier';
import { compileQuality, readCsvRow, ROWS_ALIAS } from './quality-sql';
import { HistoryEventType } from '../types/finding-history.types';
import {
  TABLE_RULE_TYPES,
  failureText,
  meets,
  qualityIdentity,
  qualityScore,
  type DetectorArguments,
  type Operator,
  type Threshold,
  type ValidRule,
} from './quality-rules';

const HISTORY = 20;
const SYSTEM = 'system:quality';
/** Longer than any quality query may take (timeout + job start). */
export const STALE_MS = 10 * 60_000;

export interface RuleResultView {
  evaluatedAt: Date;
  measuredValue: number | null;
  passed: boolean;
  error: string | null;
}

export interface QualityRuleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  columnName: string | null;
  dimension: string;
  type: string;
  metric: string;
  arguments: DetectorArguments;
  operator: string;
  threshold: Threshold;
  unit: string;
  severity: string;
  businessImpact: string | null;
  enabled: boolean;
  schedule: string | null;
  createdBy: string | null;
  updatedAt: Date;
  latest: RuleResultView | null;
  /** Oldest first, at most 20. */
  history: RuleResultView[];
  /** The open QUALITY finding while it fails. */
  findingId: string | null;
}

export interface AssetQuality {
  rules: QualityRuleView[];
  /** 0–100, weighted by severity; null until a rule has a result. */
  score: number | null;
  dimensions: { dimension: string; score: number | null; rules: number }[];
  failing: number;
  lastEvaluatedAt: Date | null;
  /** A whole-table query for this asset's rules is still out. */
  measuring: boolean;
}

/** How long a test run waits for a whole-table query. */
const TEST_WAIT_MS = 60_000;

export interface QualityTestResult {
  measuredValue: number | null;
  /** null when it could not be measured. */
  passed: boolean | null;
  error: string | null;
  rowsChecked: number | null;
  /** The query that measured it (table rules). */
  sql: string | null;
  tookMs: number;
  /** What the finding would say, when it fails. */
  failure: string | null;
}

export interface QualityOptionCount {
  value: string;
  count: number;
}

export interface QualityOptions {
  /** SQL name; null when SQL cannot read the asset. */
  table: string | null;
  columns: { name: string; type: string | null }[];
  rowCount: number | null;
  lastScannedAt: Date | null;
  openFindings: number;
  detectorTypes: QualityOptionCount[];
  customDetectors: QualityOptionCount[];
  findingTypes: QualityOptionCount[];
  categories: QualityOptionCount[];
  columnsWithFindings: QualityOptionCount[];
}

interface Measured {
  value: number | null;
  error: string | null;
}

/**
 * Data quality rules on assets, evaluated after every scan of the asset and
 * on request (docs/prd/GOV-governed-data-assets.md §5.4, G-3). Every
 * evaluation is kept (R7); a failing rule keeps exactly one open finding of
 * detector type QUALITY, which a passing result resolves (R9).
 *
 * Rights and audit are GovernanceService's: this service only reads,
 * measures and writes.
 */
@Injectable()
export class QualityService {
  private readonly logger = new Logger(QualityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: QueryRunService,
    private readonly notifier: GovernanceNotifier,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  async forAsset(assetId: string): Promise<AssetQuality> {
    const rules = await this.prisma.qualityRule.findMany({
      where: { assetId },
      orderBy: [{ dimension: 'asc' }, { name: 'asc' }],
      include: {
        results: {
          orderBy: { evaluatedAt: 'desc' },
          take: HISTORY,
        },
      },
    });
    const findings = rules.length
      ? await this.prisma.finding.findMany({
          where: {
            detectionIdentity: { in: rules.map((r) => qualityIdentity(r.id)) },
            status: FindingStatus.OPEN,
          },
          select: { id: true, detectionIdentity: true },
        })
      : [];
    const findingOf = new Map(findings.map((f) => [f.detectionIdentity, f.id]));
    const views = rules.map((rule) => {
      const history = [...rule.results].reverse().map((r) => ({
        evaluatedAt: r.evaluatedAt,
        measuredValue: r.measuredValue,
        passed: r.passed,
        error: r.error,
      }));
      return {
        ...this.ruleFields(rule),
        latest: history.at(-1) ?? null,
        history,
        findingId: findingOf.get(qualityIdentity(rule.id)) ?? null,
      };
    });
    const scored = views
      .filter((rule) => rule.enabled)
      .map((rule) => ({
        severity: rule.severity,
        dimension: rule.dimension,
        passed: rule.latest && !rule.latest.error ? rule.latest.passed : null,
      }));
    const dimensions = [...new Set(scored.map((r) => r.dimension))].map(
      (dimension) => {
        const of = scored.filter((r) => r.dimension === dimension);
        return { dimension, score: qualityScore(of), rules: of.length };
      },
    );
    const dates = views
      .map((rule) => rule.latest?.evaluatedAt?.getTime() ?? 0)
      .filter(Boolean);
    return {
      rules: views,
      score: qualityScore(scored),
      dimensions,
      failing: scored.filter((r) => r.passed === false).length,
      lastEvaluatedAt: dates.length ? new Date(Math.max(...dates)) : null,
      measuring:
        (await this.prisma.qualityEvaluation.count({
          where: {
            status: 'running',
            assetIds: { has: assetId },
            // A run the API lost (restarted mid-query) stops counting.
            startedAt: { gte: new Date(Date.now() - STALE_MS) },
          },
        })) > 0,
    };
  }

  /** Score and failing count per asset, for lists and the checklist. */
  async summaries(
    assetIds: readonly string[],
  ): Promise<
    Map<string, { rules: number; failing: number; score: number | null }>
  > {
    const out = new Map<
      string,
      { rules: number; failing: number; score: number | null }
    >();
    if (!assetIds.length) return out;
    const rules = await this.prisma.qualityRule.findMany({
      where: { assetId: { in: [...assetIds] }, enabled: true },
      select: {
        assetId: true,
        severity: true,
        results: {
          orderBy: { evaluatedAt: 'desc' },
          take: 1,
          select: { passed: true, error: true },
        },
      },
    });
    const byAsset = new Map<
      string,
      { severity: string; passed: boolean | null }[]
    >();
    for (const rule of rules) {
      const latest = rule.results[0];
      const list = byAsset.get(rule.assetId) ?? [];
      list.push({
        severity: rule.severity,
        passed: latest && !latest.error ? latest.passed : null,
      });
      byAsset.set(rule.assetId, list);
    }
    for (const [assetId, list] of byAsset) {
      out.set(assetId, {
        rules: list.length,
        failing: list.filter((r) => r.passed === false).length,
        score: qualityScore(list),
      });
    }
    return out;
  }

  /**
   * What a rule would measure right now, without saving it or touching
   * findings: the rule editor's test run. Table rules run their query as a
   * system query and wait for it (at most `TEST_WAIT_MS`).
   */
  async test(assetId: string, rule: ValidRule): Promise<QualityTestResult> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, metadata: true, lastScannedAt: true },
    });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found.`);
    const started = Date.now();
    const done = (
      measured: Measured,
      extra: { rowsChecked?: number | null; sql?: string | null } = {},
    ): QualityTestResult => ({
      measuredValue: measured.value,
      passed:
        measured.error === null && measured.value !== null
          ? meets(rule.operator, measured.value, rule.threshold)
          : null,
      error: measured.error,
      rowsChecked: extra.rowsChecked ?? null,
      sql: extra.sql ?? null,
      tookMs: Date.now() - started,
      failure:
        measured.error === null &&
        measured.value !== null &&
        !meets(rule.operator, measured.value, rule.threshold)
          ? failureText(rule, measured.value)
          : null,
    });

    if (!TABLE_RULE_TYPES.includes(rule.type)) {
      const measured = await this.measure({
        ...(this.data(rule) as unknown as QualityRule),
        id: 'test',
        assetId,
        asset,
      }).catch(
        (error: unknown): Measured => ({ value: null, error: String(error) }),
      );
      return done(measured);
    }

    const table = await this.queries.tableName(assetId);
    if (!table) {
      return done({
        value: null,
        error: 'This asset is not a table SQL can read.',
      });
    }
    const compiled = compileQuality(
      table,
      columnsOf(asset.metadata).map((c) => c.name),
      [
        {
          id: 'test',
          type: rule.type,
          metric: rule.metric,
          columnName: rule.columnName,
          arguments: rule.arguments,
        },
      ],
    );
    const compileError = compiled.errors.get('test');
    if (compileError) return done({ value: null, error: compileError });

    let settle: (runId: string | null) => void = () => undefined;
    const finished = new Promise<string | null>((resolve) => {
      settle = resolve;
    });
    const timer = setTimeout(() => settle(null), TEST_WAIT_MS);
    const startedRun = await this.queries.createSystem({
      assetId,
      sql: compiled.sql,
      purpose: 'quality',
      actorRef: SYSTEM,
      onDone: (runId) => {
        settle(runId);
        return Promise.resolve();
      },
    });
    if ('refused' in startedRun) {
      clearTimeout(timer);
      return done(
        {
          value: null,
          error: startedRun.busy
            ? 'Other quality queries are running here; try again in a minute.'
            : startedRun.refused,
        },
        { sql: compiled.sql },
      );
    }
    const runId = await finished;
    clearTimeout(timer);
    if (!runId) {
      return done(
        {
          value: null,
          error:
            'The query is still running; a table this size is better measured on save.',
        },
        { sql: compiled.sql },
      );
    }
    const result = await this.queries.systemResult(runId);
    if (result.status !== 'SUCCESS' || result.csv === null) {
      return done(
        { value: null, error: result.error ?? 'The quality query failed.' },
        { sql: compiled.sql },
      );
    }
    const row = readCsvRow(result.csv);
    const rows = row.get(ROWS_ALIAS) ?? null;
    const raw = row.get(compiled.aliases.get('test') ?? '');
    if (raw === undefined || raw === null) {
      return done(
        { value: null, error: 'The query returned no number.' },
        { sql: compiled.sql, rowsChecked: rows },
      );
    }
    const value =
      rule.unit === 'percent'
        ? rows
          ? Math.round((raw / rows) * 10_000) / 100
          : 0
        : raw;
    return done(
      { value, error: null },
      { sql: compiled.sql, rowsChecked: rows },
    );
  }

  /**
   * What the rule editor offers on this asset: its columns, whether SQL can
   * read it, and its open findings grouped the ways a detector rule counts
   * them, with how many there are now.
   */
  async options(assetId: string): Promise<QualityOptions> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { metadata: true, lastScannedAt: true },
    });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found.`);
    const [table, findings] = await Promise.all([
      this.queries.tableName(assetId),
      this.prisma.finding.findMany({
        where: {
          assetId,
          status: FindingStatus.OPEN,
          detectorType: { not: 'QUALITY' as never },
        },
        select: {
          detectorType: true,
          customDetectorKey: true,
          findingType: true,
          category: true,
          metadata: true,
        },
        take: 20_000,
      }),
    ]);
    const tally = (values: (string | null | undefined)[]) => {
      const counts = new Map<string, number>();
      for (const value of values) {
        if (!value) continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    };
    const rawRows = (asset.metadata as { row_count?: unknown } | null)
      ?.row_count;
    const rowCount =
      typeof rawRows === 'number'
        ? rawRows
        : rawRows !== undefined &&
            rawRows !== null &&
            Number.isFinite(Number(rawRows))
          ? Number(rawRows)
          : null;
    return {
      table,
      columns: columnsOf(asset.metadata).map((column) => ({
        name: column.name,
        type: column.type ?? null,
      })),
      rowCount,
      lastScannedAt: asset.lastScannedAt,
      openFindings: findings.length,
      detectorTypes: tally(findings.map((f) => String(f.detectorType))),
      customDetectors: tally(findings.map((f) => f.customDetectorKey)),
      findingTypes: tally(findings.map((f) => f.findingType)),
      categories: tally(findings.map((f) => f.category)),
      columnsWithFindings: tally(
        findings.map((f) => {
          const name = (f.metadata as { tabular_column_name?: unknown } | null)
            ?.tabular_column_name;
          return typeof name === 'string' ? name : null;
        }),
      ),
    };
  }

  /** The table's SQL name, or null when SQL cannot read it. */
  tableName(assetId: string): Promise<string | null> {
    return this.queries.tableName(assetId);
  }

  // ── Changes (called by GovernanceService, which checks rights) ────────────

  async create(
    assetId: string,
    rule: ValidRule,
    actorRef: string | null,
  ): Promise<QualityRule> {
    try {
      return await this.prisma.qualityRule.create({
        data: { assetId, ...this.data(rule), createdBy: actorRef },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new KeyTakenError(rule.key);
      }
      throw error;
    }
  }

  async update(ruleId: string, rule: ValidRule): Promise<QualityRule> {
    return this.prisma.qualityRule.update({
      where: { id: ruleId },
      data: this.data(rule),
    });
  }

  /** Delete a rule, and resolve the finding it kept open. */
  async remove(ruleId: string): Promise<void> {
    await this.resolveFinding(ruleId, 'Quality rule deleted');
    await this.prisma.qualityRule.delete({ where: { id: ruleId } });
  }

  async rule(ruleId: string): Promise<QualityRule> {
    const rule = await this.prisma.qualityRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule) throw new NotFoundException(`Quality rule ${ruleId} not found`);
    return rule;
  }

  toValid(rule: QualityRule): ValidRule {
    return {
      key: rule.key,
      name: rule.name,
      description: rule.description,
      columnName: rule.columnName,
      dimension: rule.dimension as ValidRule['dimension'],
      type: rule.type as ValidRule['type'],
      metric: rule.metric,
      arguments: (rule.arguments ?? {}) as DetectorArguments,
      operator: rule.operator as Operator,
      threshold: rule.threshold as Threshold,
      unit: rule.unit,
      severity: rule.severity,
      businessImpact: rule.businessImpact,
      enabled: rule.enabled,
      schedule: rule.schedule,
    };
  }

  // ── Evaluation ────────────────────────────────────────────────────────────

  /**
   * After a scan: evaluate the enabled rules of the assets this run wrote
   * (`assets.runner_id`). Never fails the run; errors are logged.
   */
  async afterScan(sourceId: string, runnerId: string): Promise<void> {
    try {
      // Rules with their own schedule run on it, not after every scan.
      const rules = await this.prisma.qualityRule.findMany({
        where: {
          enabled: true,
          schedule: null,
          asset: { sourceId, runnerId },
        },
        select: { id: true, assetId: true },
      });
      if (!rules.length) return;
      await this.evaluate([...new Set(rules.map((r) => r.assetId))], 'scan', {
        runnerId,
        ruleIds: rules.map((r) => r.id),
      });
    } catch (error) {
      this.logger.warn(
        `Quality rules after run ${runnerId} not evaluated: ${String(error)}`,
      );
    }
  }

  /**
   * Close evaluations still running after {@link STALE_MS}: the process that
   * waited for their query is gone (a restart), so their results never come.
   * The rules simply run again on their next scan, schedule or request.
   */
  async closeStale(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.qualityEvaluation.updateMany({
      where: {
        status: 'running',
        startedAt: { lt: new Date(now.getTime() - STALE_MS) },
      },
      data: { status: 'error', finishedAt: now },
    });
    return count;
  }

  /** Evaluate the enabled rules of `assetIds` now and keep every result. */
  async evaluate(
    assetIds: readonly string[],
    trigger: 'scan' | 'manual' | 'schedule',
    context: {
      runnerId?: string;
      actorRef?: string | null;
      /** Only these rules (one just created or changed). */
      ruleIds?: string[];
    } = {},
  ): Promise<{ evaluationId: string; rules: number; failed: number }> {
    const rules = await this.prisma.qualityRule.findMany({
      where: {
        assetId: { in: [...assetIds] },
        enabled: true,
        ...(context.ruleIds ? { id: { in: context.ruleIds } } : {}),
      },
      include: {
        asset: {
          select: {
            id: true,
            sourceId: true,
            metadata: true,
            lastScannedAt: true,
            externalUrl: true,
          },
        },
      },
    });
    const evaluation = await this.prisma.qualityEvaluation.create({
      data: {
        trigger,
        assetIds: [...assetIds],
        runnerId: context.runnerId ?? null,
        actorRef: context.actorRef ?? null,
      },
    });
    let failed = 0;
    const inline = rules.filter((r) => !TABLE_RULE_TYPES.includes(r.type));
    const byTable = new Map<string, typeof rules>();
    for (const rule of rules) {
      if (!TABLE_RULE_TYPES.includes(rule.type)) continue;
      const list = byTable.get(rule.assetId) ?? [];
      list.push(rule);
      byTable.set(rule.assetId, list);
    }
    for (const rule of inline) {
      const measured = await this.measure(rule).catch(
        (error: unknown): Measured => ({ value: null, error: String(error) }),
      );
      const passed =
        measured.error === null && measured.value !== null
          ? meets(
              rule.operator as Operator,
              measured.value,
              rule.threshold as Threshold,
            )
          : false;
      await this.prisma.qualityResult.create({
        data: {
          ruleId: rule.id,
          evaluationId: evaluation.id,
          measuredValue: measured.value,
          passed,
          error: measured.error,
        },
      });
      // An error says nothing about the data: the finding stays as it is.
      if (measured.error !== null || measured.value === null) continue;
      if (passed) {
        await this.resolveFinding(rule.id, 'Quality rule passes again');
      } else {
        failed += 1;
        await this.raiseFinding(rule, rule.asset, measured.value);
      }
    }
    await this.prisma.qualityEvaluation.update({
      where: { id: evaluation.id },
      data: { rules: inline.length, failed, finishedAt: new Date() },
    });
    // Whole-table rules: one query per table, one table after another, in
    // the background — a person or a scan does not wait for them.
    if (byTable.size) {
      void (async () => {
        for (const [assetId, tableRules] of byTable) {
          await this.measureTable(assetId, tableRules, trigger, context).catch(
            (error: unknown) =>
              this.logger.warn(
                `Quality query for asset ${assetId}: ${String(error)}`,
              ),
          );
        }
      })();
    }
    return { evaluationId: evaluation.id, rules: rules.length, failed };
  }

  /**
   * Library and sql rules of one table as one system query (G-4); resolves
   * once the job's result is recorded and the findings are updated.
   */
  private async measureTable(
    assetId: string,
    rules: (QualityRule & {
      asset: {
        id: string;
        sourceId: string;
        metadata: Prisma.JsonValue;
        externalUrl: string;
      };
    })[],
    trigger: string,
    context: { runnerId?: string; actorRef?: string | null },
  ): Promise<void> {
    const asset = rules[0].asset;
    const table = await this.queries.tableName(assetId);
    const evaluation = await this.prisma.qualityEvaluation.create({
      data: {
        trigger,
        assetIds: [assetId],
        runnerId: context.runnerId ?? null,
        actorRef: context.actorRef ?? null,
        status: 'running',
        rules: rules.length,
      },
    });
    const finish = async (
      measured: Map<string, Measured>,
      status: 'done' | 'error',
      runId: string | null,
    ) => {
      let failed = 0;
      for (const rule of rules) {
        const m = measured.get(rule.id) ?? {
          value: null,
          error: 'Not measured.',
        };
        const passed =
          m.error === null && m.value !== null
            ? meets(
                rule.operator as Operator,
                m.value,
                rule.threshold as Threshold,
              )
            : false;
        await this.prisma.qualityResult.create({
          data: {
            ruleId: rule.id,
            evaluationId: evaluation.id,
            measuredValue: m.value,
            passed,
            error: m.error,
          },
        });
        if (m.error !== null || m.value === null) continue;
        if (passed) {
          await this.resolveFinding(rule.id, 'Quality rule passes again');
        } else {
          failed += 1;
          await this.raiseFinding(rule, asset, m.value);
        }
      }
      await this.prisma.qualityEvaluation.update({
        where: { id: evaluation.id },
        data: { status, failed, queryRunId: runId, finishedAt: new Date() },
      });
    };
    const allError = (message: string) =>
      new Map(rules.map((r) => [r.id, { value: null, error: message }]));

    if (!table) {
      await finish(
        allError('This asset is not a table SQL can read.'),
        'error',
        null,
      );
      return;
    }
    const compiled = compileQuality(
      table,
      columnsOf(asset.metadata).map((c) => c.name),
      rules.map((r) => ({
        id: r.id,
        type: r.type,
        metric: r.metric,
        columnName: r.columnName,
        arguments: (r.arguments ?? {}) as DetectorArguments,
      })),
    );
    await new Promise<void>((resolve) => {
      void this.startWhenFree({
        assetId,
        sql: compiled.sql,
        purpose: 'quality',
        actorRef: SYSTEM,
        onDone: async (runId) => {
          try {
            const result = await this.queries.systemResult(runId);
            if (result.status !== 'SUCCESS' || result.csv === null) {
              await finish(
                allError(result.error ?? 'The quality query failed.'),
                'error',
                runId,
              );
              return;
            }
            const row = readCsvRow(result.csv);
            const rows = row.get(ROWS_ALIAS) ?? null;
            const measured = new Map<string, Measured>();
            for (const rule of rules) {
              const error = compiled.errors.get(rule.id);
              if (error) {
                measured.set(rule.id, { value: null, error });
                continue;
              }
              const raw = row.get(compiled.aliases.get(rule.id) ?? '');
              if (raw === undefined || raw === null) {
                measured.set(rule.id, {
                  value: null,
                  error: 'The query returned no number for this rule.',
                });
                continue;
              }
              const value =
                rule.unit === 'percent'
                  ? rows
                    ? Math.round((raw / rows) * 10_000) / 100
                    : 0
                  : raw;
              measured.set(rule.id, { value, error: null });
            }
            await finish(measured, 'done', runId);
          } finally {
            resolve();
          }
        },
      })
        .then(async (started) => {
          if ('refused' in started) {
            await finish(allError(started.refused), 'error', null);
            resolve();
          }
        })
        .catch(async (error: unknown) => {
          await finish(allError(String(error)), 'error', null).catch(
            () => undefined,
          );
          resolve();
        });
    });
  }

  /**
   * Start a system query, waiting for a free slot (at most 2 run at once per
   * workspace) for up to five minutes rather than failing a rule because
   * others were measured a moment earlier.
   */
  private async startWhenFree(
    input: Parameters<QueryRunService['createSystem']>[0],
  ): ReturnType<QueryRunService['createSystem']> {
    for (let attempt = 0; ; attempt += 1) {
      const started = await this.queries.createSystem(input);
      if (!('refused' in started) || !started.busy || attempt >= 60) {
        return started;
      }
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  /** What one rule measures on its asset right now. */
  private async measure(
    rule: QualityRule & {
      asset: { metadata: Prisma.JsonValue; lastScannedAt: Date | null };
    },
  ): Promise<Measured> {
    if (rule.type === 'detector' && rule.metric === 'openFindings') {
      const args = (rule.arguments ?? {}) as DetectorArguments;
      const value = await this.prisma.finding.count({
        where: {
          assetId: rule.assetId,
          status: FindingStatus.OPEN,
          // A rule never counts the findings rules raise.
          detectorType: args.detectorType
            ? (args.detectorType as never)
            : { not: 'QUALITY' },
          ...(args.customDetectorKey
            ? { customDetectorKey: args.customDetectorKey }
            : {}),
          ...(args.findingType ? { findingType: args.findingType } : {}),
          ...(args.category ? { category: args.category } : {}),
          ...(rule.columnName
            ? {
                metadata: {
                  path: ['tabular_column_name'],
                  equals: rule.columnName,
                },
              }
            : {}),
        },
      });
      return { value, error: null };
    }
    if (rule.type === 'metadata' && rule.metric === 'rowCount') {
      const raw = (rule.asset.metadata as { row_count?: unknown } | null)
        ?.row_count;
      const value = typeof raw === 'number' ? raw : Number(raw);
      return raw === undefined || raw === null || !Number.isFinite(value)
        ? {
            value: null,
            error: 'The scan recorded no row count for this asset.',
          }
        : { value, error: null };
    }
    if (rule.type === 'metadata' && rule.metric === 'freshness') {
      if (!rule.asset.lastScannedAt) {
        return { value: null, error: 'This asset was never scanned.' };
      }
      const hours =
        (Date.now() - rule.asset.lastScannedAt.getTime()) / 3_600_000;
      return { value: Math.round(hours * 10) / 10, error: null };
    }
    return {
      value: null,
      error: `${rule.type}/${rule.metric} is not evaluated yet.`,
    };
  }

  private async raiseFinding(
    rule: QualityRule,
    asset: { id: string; sourceId: string; externalUrl: string },
    value: number,
  ): Promise<void> {
    const identity = qualityIdentity(rule.id);
    const now = new Date();
    const content = failureText(this.toValid(rule), value);
    const metadata = {
      ruleId: rule.id,
      ruleKey: rule.key,
      dimension: rule.dimension,
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      measuredValue: value,
      ...(rule.columnName ? { tabular_column_name: rule.columnName } : {}),
    } as Prisma.InputJsonValue;
    const existing = await this.prisma.finding.findUnique({
      where: { detectionIdentity: identity },
      select: { id: true, status: true, history: true },
    });
    const announce = async (findingId: string) => {
      const named = await this.prisma.asset.findUnique({
        where: { id: asset.id },
        select: { name: true },
      });
      void this.notifier.qualityFailing({
        assetId: asset.id,
        assetName: named?.name ?? 'an asset',
        sourceId: asset.sourceId,
        ruleKey: rule.key,
        ruleName: rule.name,
        severity: rule.severity,
        text: content,
        findingId,
      });
    };
    if (!existing) {
      const created = await this.prisma.finding.create({
        data: {
          detectionIdentity: identity,
          assetId: asset.id,
          sourceId: asset.sourceId,
          detectorType: 'QUALITY',
          findingType: `quality:${rule.key}`,
          category: 'QUALITY',
          severity: rule.severity,
          confidence: 1,
          matchedContent: content,
          location: {
            path: asset.externalUrl,
            ...(rule.columnName
              ? { description: `column ${rule.columnName}` }
              : {}),
          },
          metadata,
          status: FindingStatus.OPEN,
          detectedAt: now,
          firstDetectedAt: now,
          lastDetectedAt: now,
          history: [
            {
              timestamp: now,
              runnerId: SYSTEM,
              eventType: HistoryEventType.DETECTED,
              status: FindingStatus.OPEN,
              severity: rule.severity,
            },
          ],
        },
        select: { id: true },
      });
      // A rule starting to fail is news; failing again tomorrow is not.
      await announce(created.id);
      return;
    }
    // Reopen what the system resolved; a person's decision (false positive,
    // ignored) stands, with the new measurement recorded on it.
    const reopen = existing.status === FindingStatus.RESOLVED;
    const history = Array.isArray(existing.history) ? existing.history : [];
    await this.prisma.finding.update({
      where: { id: existing.id },
      data: {
        findingType: `quality:${rule.key}`,
        matchedContent: content,
        severity: rule.severity,
        metadata,
        lastDetectedAt: now,
        detectedAt: now,
        ...(reopen
          ? {
              status: FindingStatus.OPEN,
              resolvedAt: null,
              resolutionReason: null,
              history: [
                ...history,
                {
                  timestamp: now,
                  runnerId: SYSTEM,
                  eventType: HistoryEventType.RE_OPENED,
                  status: FindingStatus.OPEN,
                  severity: rule.severity,
                },
              ],
            }
          : {}),
      },
    });
    if (reopen) await announce(existing.id);
  }

  private async resolveFinding(ruleId: string, reason: string): Promise<void> {
    const finding = await this.prisma.finding.findUnique({
      where: { detectionIdentity: qualityIdentity(ruleId) },
      select: { id: true, status: true, history: true },
    });
    if (!finding || finding.status !== FindingStatus.OPEN) return;
    const now = new Date();
    const history = Array.isArray(finding.history) ? finding.history : [];
    await this.prisma.finding.update({
      where: { id: finding.id },
      data: {
        status: FindingStatus.RESOLVED,
        resolvedAt: now,
        resolutionReason: reason,
        history: [
          ...history,
          {
            timestamp: now,
            runnerId: SYSTEM,
            eventType: HistoryEventType.RESOLVED,
            status: FindingStatus.RESOLVED,
            changeReason: reason,
          },
        ],
      },
    });
  }

  private data(rule: ValidRule) {
    return {
      key: rule.key,
      name: rule.name,
      description: rule.description,
      columnName: rule.columnName,
      dimension: rule.dimension,
      type: rule.type,
      metric: rule.metric,
      arguments: rule.arguments as Prisma.InputJsonValue,
      operator: rule.operator,
      threshold: rule.threshold as Prisma.InputJsonValue,
      unit: rule.unit,
      severity: rule.severity,
      businessImpact: rule.businessImpact,
      enabled: rule.enabled,
      schedule: rule.schedule,
    };
  }

  private ruleFields(rule: QualityRule) {
    return {
      id: rule.id,
      key: rule.key,
      name: rule.name,
      description: rule.description,
      columnName: rule.columnName,
      dimension: rule.dimension,
      type: rule.type,
      metric: rule.metric,
      arguments: (rule.arguments ?? {}) as DetectorArguments,
      operator: rule.operator,
      threshold: rule.threshold as Threshold,
      unit: rule.unit,
      severity: rule.severity,
      businessImpact: rule.businessImpact,
      enabled: rule.enabled,
      schedule: rule.schedule,
      createdBy: rule.createdBy,
      updatedAt: rule.updatedAt,
    };
  }
}

export class KeyTakenError extends Error {
  constructor(readonly key: string) {
    super(`A rule with key ${key} already exists on this asset.`);
  }
}
