import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import {
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from '../registry/namespace-registry.sql';

/** The scan limits an operator can change without redeploying. */
export const RUNNER_LIMIT_KEYS = [
  'maxRunnersPerSource',
  'maxConcurrentRunners',
  'autoScheduleMaxConcurrent',
] as const;

export type RunnerLimitKey = (typeof RUNNER_LIMIT_KEYS)[number];

const DB_KEY: Record<RunnerLimitKey, string> = {
  maxRunnersPerSource: 'max_runners_per_source',
  maxConcurrentRunners: 'max_concurrent_runners',
  autoScheduleMaxConcurrent: 'auto_schedule_max_concurrent',
};

const ENV_NAME: Record<RunnerLimitKey, string> = {
  maxRunnersPerSource: 'MAX_RUNNERS_PER_SOURCE',
  maxConcurrentRunners: 'MAX_CONCURRENT_RUNNERS',
  autoScheduleMaxConcurrent: 'AUTO_SCHEDULE_MAX_CONCURRENT',
};

/** What applies when neither the settings nor the environment say anything. */
const BUILT_IN_DEFAULT: Record<RunnerLimitKey, number> = {
  maxRunnersPerSource: 5,
  maxConcurrentRunners: 2,
  autoScheduleMaxConcurrent: 2,
};

export const MAX_RUNNER_LIMIT = 10_000;

export interface RunnerLimit {
  /** What the Settings page saved, or null when it follows the deployment. */
  override: number | null;
  /** What the Helm chart or the all-in-one image sets (or the built-in default). */
  deploymentDefault: number;
  /** What is in force: the override when there is one. */
  effective: number;
}

export type RunnerLimits = Record<RunnerLimitKey, RunnerLimit>;

const CACHE_MS = 5_000;

function parseLimit(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Scan limits that outrank the chart / image environment once set in Settings.
 *
 * Read through a short cache because the scan paths ask on every start and
 * every API and worker pod reads the same row: a change reaches all of them
 * within seconds, with no restart. A database that cannot be read falls back to
 * the environment, so limits never fail open to "unlimited" by accident.
 */
@Injectable()
export class DeploymentSettingsService implements OnApplicationShutdown {
  private pool: Pool | null = null;
  private cache: { at: number; overrides: Map<string, number> } | null = null;

  /** The environment value for a limit, or the built-in default. */
  deploymentDefault(key: RunnerLimitKey): number {
    return parseLimit(process.env[ENV_NAME[key]]) ?? BUILT_IN_DEFAULT[key];
  }

  async effective(key: RunnerLimitKey): Promise<number> {
    const overrides = await this.overrides();
    return overrides.get(DB_KEY[key]) ?? this.deploymentDefault(key);
  }

  async limits(): Promise<RunnerLimits> {
    const overrides = await this.overrides(true);
    const result = {} as RunnerLimits;
    for (const key of RUNNER_LIMIT_KEYS) {
      const override = overrides.get(DB_KEY[key]) ?? null;
      const deploymentDefault = this.deploymentDefault(key);
      result[key] = {
        override,
        deploymentDefault,
        effective: override ?? deploymentDefault,
      };
    }
    return result;
  }

  /** `null` clears an override; a number sets it. Keys left out are untouched. */
  async update(
    patch: Partial<Record<RunnerLimitKey, number | null>>,
  ): Promise<RunnerLimits> {
    const pool = this.requirePool();
    for (const key of RUNNER_LIMIT_KEYS) {
      const value = patch[key];
      if (value === undefined) continue;
      if (value === null) {
        await pool.query('DELETE FROM deployment_settings WHERE key = $1', [
          DB_KEY[key],
        ]);
        continue;
      }
      const clamped = Math.min(
        Math.max(Math.trunc(value), 0),
        MAX_RUNNER_LIMIT,
      );
      await pool.query(
        `INSERT INTO deployment_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [DB_KEY[key], String(clamped)],
      );
    }
    this.cache = null;
    return this.limits();
  }

  private async overrides(fresh = false): Promise<Map<string, number>> {
    const now = Date.now();
    if (!fresh && this.cache && now - this.cache.at < CACHE_MS) {
      return this.cache.overrides;
    }
    try {
      const { rows } = await this.requirePool().query<{
        key: string;
        value: string;
      }>('SELECT key, value FROM deployment_settings');
      const overrides = new Map<string, number>();
      for (const row of rows) {
        const value = parseLimit(row.value);
        if (value !== null) overrides.set(row.key, value);
      }
      this.cache = { at: now, overrides };
      return overrides;
    } catch {
      // Unreadable (not migrated yet, database blip): keep what was last known,
      // else follow the environment.
      return this.cache?.overrides ?? new Map();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    await pool?.end().catch(() => undefined);
  }

  private requirePool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: publicConnectionString(),
        options: PUBLIC_SEARCH_PATH_OPTION,
        max: 2,
      });
    }
    return this.pool;
  }
}
