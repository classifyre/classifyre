import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/** The scan limits an operator can change without redeploying. */
export const RUNNER_LIMIT_KEYS = [
  'maxRunnersPerSource',
  'maxConcurrentRunners',
  'autoScheduleMaxConcurrent',
] as const;

export type RunnerLimitKey = (typeof RUNNER_LIMIT_KEYS)[number];

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
  /**
   * What is in force: the override when there is one. For scans at once the
   * deployment value stays a ceiling, so the smaller of the two (0 = no cap).
   */
  effective: number;
}

export type RunnerLimits = Record<RunnerLimitKey, RunnerLimit>;

/**
 * The scans-at-once cap one workspace actually runs under.
 *
 * A workspace may hold itself BELOW the installation-wide ceiling, never above
 * it: two scans contend for the same cores whichever workspace started them.
 * `0` means "no cap" on both sides, so a workspace value of 0 adds nothing and
 * a ceiling of 0 (unlimited) leaves the workspace value as the only cap.
 */
export function effectiveConcurrentRunners(
  workspaceLimit: number | null,
  ceiling: number,
): number {
  if (!workspaceLimit) return ceiling;
  if (ceiling === 0) return workspaceLimit;
  return Math.min(workspaceLimit, ceiling);
}

function parseLimit(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Scan limits of one workspace, which outrank the chart / image environment
 * once set in Settings.
 *
 * Stored per workspace (`instance_settings`), read in the current workspace's
 * context. `maxConcurrentRunners` is a cap on the scans THIS workspace runs
 * at once; the deployment-wide ceiling from the environment still applies on
 * top, so a workspace limit can only hold a workspace back, never let it
 * exceed what the machine was configured for.
 */
@Injectable()
export class DeploymentSettingsService {
  private readonly logger = new Logger(DeploymentSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The environment value for a limit, or the built-in default. */
  deploymentDefault(key: RunnerLimitKey): number {
    return parseLimit(process.env[ENV_NAME[key]]) ?? BUILT_IN_DEFAULT[key];
  }

  /** This workspace's saved value, or null when it follows the deployment. */
  async override(key: RunnerLimitKey): Promise<number | null> {
    try {
      const row = await this.prisma.instanceSettings.findUnique({
        where: { id: 1 },
        select: { [key]: true },
      });
      const value = (row as Record<string, number | null> | null)?.[key];
      return typeof value === 'number' ? value : null;
    } catch (error) {
      // Falls back to the deployment value, which is the ceiling for the
      // scans-at-once cap, so this never lets a workspace exceed the machine.
      this.logger.warn(
        `Could not read the ${key} setting, using the deployment value: ${String(error)}`,
      );
      return null;
    }
  }

  async effective(key: RunnerLimitKey): Promise<number> {
    return (await this.override(key)) ?? this.deploymentDefault(key);
  }

  async limits(): Promise<RunnerLimits> {
    const row = await this.prisma.instanceSettings.findUnique({
      where: { id: 1 },
    });
    const result = {} as RunnerLimits;
    for (const key of RUNNER_LIMIT_KEYS) {
      const override = row?.[key] ?? null;
      const deploymentDefault = this.deploymentDefault(key);
      result[key] = {
        override,
        deploymentDefault,
        effective:
          key === 'maxConcurrentRunners'
            ? effectiveConcurrentRunners(override, deploymentDefault)
            : (override ?? deploymentDefault),
      };
    }
    return result;
  }

  /** `null` clears an override; a number sets it. Keys left out are untouched. */
  async update(
    patch: Partial<Record<RunnerLimitKey, number | null>>,
  ): Promise<RunnerLimits> {
    const data: Partial<Record<RunnerLimitKey, number | null>> = {};
    for (const key of RUNNER_LIMIT_KEYS) {
      const value = patch[key];
      if (value === undefined) continue;
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        throw new BadRequestException(`${key} must be 0 or more`);
      }
      data[key] =
        value === null
          ? null
          : Math.min(Math.max(Math.trunc(value), 0), MAX_RUNNER_LIMIT);
    }
    await this.prisma.instanceSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
    return this.limits();
  }
}
