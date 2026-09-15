import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, RunnerStatus } from '@prisma/client';

import { PrismaService } from '../prisma.service';
import {
  COHORT_BANDS,
  COHORT_WEIGHT_RULES,
  computeCohortWeights,
  type BandObservation,
  type CohortBand,
  type CohortWeightsResult,
} from './cohort-weights';

/** One cohort as a run reports it (the CLI's `cohortStats`, plus hits). */
export interface CohortYield {
  bands: Partial<Record<CohortBand, BandObservation>>;
  weightsUsed: Partial<Record<CohortBand, number>>;
  declared: Partial<Record<CohortBand, number>>;
  minShare: number | null;
  universeSize: number;
}

export type CohortWeightsMode = 'auto' | 'fixed';

export interface CohortWeightsPreview {
  name: string;
  mode: CohortWeightsMode;
  weights: Partial<Record<CohortBand, number>>;
  reason: CohortWeightsResult['reason'] | 'fixed';
  derivation: CohortWeightsResult['derivation'];
  runs: Array<{
    runnerId: string;
    triggeredAt: Date;
    bands: CohortYield['bands'];
    weightsUsed: CohortYield['weightsUsed'];
  }>;
}

const MAX_COHORTS = 20;

/**
 * Measures cohort bands and turns the measurement into the next run's split.
 *
 * Recording happens at finalize, once the run's findings are all in: `hits` is
 * how many of the keys a band visited produced a new HIGH/CRITICAL finding in
 * this run, counted in SQL over the run's own assets. `visited` comes from the
 * connector, because a key that produced no asset at all is still a miss —
 * counting only assets would inflate the rate of the least productive band.
 */
@Injectable()
export class CohortWeightsService {
  private readonly logger = new Logger(CohortWeightsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordYield(
    runnerId: string,
    sourceId: string,
    rawStats: unknown,
  ): Promise<void> {
    const stats = normalizeStats(rawStats);
    if (Object.keys(stats).length === 0) return;

    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: { startedAt: true, triggeredAt: true },
    });
    const since = runner?.startedAt ?? runner?.triggeredAt ?? new Date(0);
    const hits = await this.prisma.$queryRaw<
      Array<{ cohort: string; band: string; hits: number }>
    >`
      SELECT a.metadata #>> '{_cohort,name}' AS cohort,
             a.metadata #>> '{_cohort,band}' AS band,
             count(DISTINCT a.metadata #>> '{_cohort,key}')::int AS hits
      FROM runner_assets ra
      JOIN assets a ON a.hash = ra.asset_hash AND a.source_id = ${sourceId}
      WHERE ra.runner_id = ${runnerId}
        AND a.metadata -> '_cohort' IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM findings f
          WHERE f.asset_id = a.id
            AND f.severity IN ('HIGH'::"Severity", 'CRITICAL'::"Severity")
            AND f.first_detected_at >= ${since}
        )
      GROUP BY 1, 2
    `;
    for (const row of hits) {
      const band = stats[row.cohort]?.bands[row.band as CohortBand];
      if (band) band.hits = Math.min(Number(row.hits), band.visited);
    }
    await this.prisma.runner.update({
      where: { id: runnerId },
      data: { cohortYield: stats as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * The split each named cohort should run with next, or null to leave every
   * notebook's declared bands alone.
   */
  async effectiveWeights(
    sourceId: string,
    config: unknown,
  ): Promise<Record<string, Partial<Record<CohortBand, number>>> | null> {
    const settings = cohortSettings(config);
    if (settings.mode === 'fixed') {
      return Object.keys(settings.fixed).length > 0 ? settings.fixed : null;
    }
    const previews = await this.previewsFor(sourceId, settings);
    const measured = previews.filter(
      (preview) => preview.reason === 'measured',
    );
    if (measured.length === 0) return null;
    return Object.fromEntries(measured.map((p) => [p.name, p.weights]));
  }

  /** What the next run of a source would use, with how it was derived. */
  async preview(sourceId: string): Promise<CohortWeightsPreview[]> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { config: true },
    });
    if (!source) throw new NotFoundException(`Source ${sourceId} not found`);
    return this.previewsFor(sourceId, cohortSettings(source.config));
  }

  /** The source, with this run's cohort weights written into its recipe. */
  async withEffectiveWeights<T extends { id: string; config: unknown }>(
    source: T,
  ): Promise<T> {
    try {
      const effective = await this.effectiveWeights(source.id, source.config);
      if (!effective) return source;
      const config = (source.config ?? {}) as Record<string, any>;
      const optional = (config.optional ?? {}) as Record<string, any>;
      return {
        ...source,
        config: {
          ...config,
          optional: {
            ...optional,
            cohort_weights: { ...(optional.cohort_weights ?? {}), effective },
          },
        },
      };
    } catch (error) {
      // A run must never fail over its cohort split: the notebook's declared
      // bands are always a valid answer.
      this.logger.warn(
        `Cohort weights not computed for source ${source.id}: ${String(error)}`,
      );
      return source;
    }
  }

  private async previewsFor(
    sourceId: string,
    settings: ReturnType<typeof cohortSettings>,
  ): Promise<CohortWeightsPreview[]> {
    const runs = await this.prisma.runner.findMany({
      where: {
        sourceId,
        cohortYield: { not: Prisma.DbNull },
        status: { in: [RunnerStatus.COMPLETED, RunnerStatus.WARNING] },
      },
      select: { id: true, triggeredAt: true, cohortYield: true },
      orderBy: { triggeredAt: 'desc' },
      take: COHORT_WEIGHT_RULES.historyRuns,
    });
    const parsed = runs.map((run) => ({
      runnerId: run.id,
      triggeredAt: run.triggeredAt,
      cohorts: normalizeStats(run.cohortYield),
    }));
    const names = [
      ...new Set(parsed.flatMap((run) => Object.keys(run.cohorts))),
    ].slice(0, MAX_COHORTS);

    return names.map((name) => {
      const history = parsed.filter((run) => run.cohorts[name]);
      const latest = history[0].cohorts[name];
      if (settings.mode === 'fixed') {
        return {
          name,
          mode: 'fixed',
          weights: settings.fixed[name] ?? latest.declared,
          reason: 'fixed',
          derivation: {},
          runs: history.map((run) => ({
            runnerId: run.runnerId,
            triggeredAt: run.triggeredAt,
            bands: run.cohorts[name].bands,
            weightsUsed: run.cohorts[name].weightsUsed,
          })),
        };
      }
      const result = computeCohortWeights({
        declared: latest.declared,
        history: history.map((run) => run.cohorts[name].bands),
        previous: latest.weightsUsed,
        minShare: Math.max(latest.minShare ?? 0, settings.floor ?? 0),
      });
      return {
        name,
        mode: 'auto',
        weights: result.weights,
        reason: result.reason,
        derivation: result.derivation,
        runs: history.map((run) => ({
          runnerId: run.runnerId,
          triggeredAt: run.triggeredAt,
          bands: run.cohorts[name].bands,
          weightsUsed: run.cohorts[name].weightsUsed,
        })),
      };
    });
  }
}

/** `optional.cohort_weights` of a source config, read defensively. */
export function cohortSettings(config: unknown): {
  mode: CohortWeightsMode;
  fixed: Record<string, Partial<Record<CohortBand, number>>>;
  floor: number | null;
} {
  const raw =
    ((config as Record<string, any> | null)?.optional?.cohort_weights as
      | Record<string, unknown>
      | undefined) ?? {};
  const fixed: Record<string, Partial<Record<CohortBand, number>>> = {};
  if (raw.fixed && typeof raw.fixed === 'object') {
    for (const [name, weights] of Object.entries(raw.fixed)) {
      const bands = bandNumbers(weights);
      if (Object.keys(bands).length > 0) fixed[name] = bands;
    }
  }
  const floor = Number(raw.floor);
  return {
    mode: raw.mode === 'fixed' ? 'fixed' : 'auto',
    fixed,
    floor: Number.isFinite(floor) && floor > 0 && floor < 1 ? floor : null,
  };
}

function bandNumbers(value: unknown): Partial<Record<CohortBand, number>> {
  const out: Partial<Record<CohortBand, number>> = {};
  if (!value || typeof value !== 'object') return out;
  for (const band of COHORT_BANDS) {
    const weight = Number((value as Record<string, unknown>)[band]);
    if (Number.isFinite(weight) && weight > 0) out[band] = weight;
  }
  return out;
}

/** The CLI's per-cohort stats (or a stored yield), keeping only what is sound. */
export function normalizeStats(raw: unknown): Record<string, CohortYield> {
  const out: Record<string, CohortYield> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [name, value] of Object.entries(raw).slice(0, MAX_COHORTS)) {
    if (!value || typeof value !== 'object' || name.length > 200) continue;
    const entry = value as Record<string, unknown>;
    const bands: CohortYield['bands'] = {};
    const rawBands = (entry.bands ?? {}) as Record<string, unknown>;
    for (const band of COHORT_BANDS) {
      const observed = rawBands[band] as Record<string, unknown> | undefined;
      if (!observed || typeof observed !== 'object') continue;
      const visited = Math.max(0, Math.floor(Number(observed.visited) || 0));
      bands[band] = {
        visited,
        hits: Math.min(
          visited,
          Math.max(0, Math.floor(Number(observed.hits) || 0)),
        ),
        exhausted: observed.exhausted === true,
      };
    }
    const minShare = Number(entry.minShare);
    out[name] = {
      bands,
      weightsUsed: bandNumbers(entry.weightsUsed),
      declared: bandNumbers(entry.declared),
      minShare:
        Number.isFinite(minShare) && minShare >= 0 && minShare < 1
          ? minShare
          : null,
      universeSize: Math.max(0, Math.floor(Number(entry.universeSize) || 0)),
    };
  }
  return out;
}
