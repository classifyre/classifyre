import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import {
  featureOffMessage,
  type FeatureDisabledMode,
} from '../maintenance/workspace-features.constants';

/**
 * How long a process trusts its last read of the switch.
 *
 * The API and the workers are separate processes on Kubernetes, and the switch
 * is flipped in whichever API pod served the request, so every other process
 * learns about it by reading. Five seconds is inside the pause-refresh cadence
 * of the queue hold that stops the workers anyway; this read is the second
 * line, for work that does not come through a held queue (an on-demand
 * recompute, a job fetched in the instant before the hold landed).
 */
const SWITCH_CACHE_MS = 5_000;

export interface CorrelationSwitchState {
  enabled: boolean;
  /** How it was turned off: results kept or deleted. Null while on. */
  disabledMode: FeatureDisabledMode | null;
  changedAt: Date | null;
}

const DEFAULT_STATE: CorrelationSwitchState = {
  enabled: true,
  disabledMode: null,
  changedAt: null,
};

/**
 * Refusal for any duplicate-detection work while the switch is off.
 *
 * A 409 like the workspace pause: the request is fine, it conflicts with the
 * workspace's state, and turning the feature back on clears it. The duplicates
 * finder catches this class specifically, so a recompute that finds the switch
 * flipped mid-run ends as a SKIPPED run rather than a failure pg-boss retries.
 */
export class DuplicateDetectionOffException extends ConflictException {
  constructor() {
    super(featureOffMessage('duplicates'));
  }
}

/**
 * Duplicate detection's on/off switch, stored on the correlation config
 * singleton so it travels with a workspace export like the tuning does.
 *
 * Reads are cached per schema for a few seconds and a missing row means on:
 * every workspace had duplicate detection before the switch existed, and a
 * namespace mid-migration must keep behaving as it always did.
 */
@Injectable()
export class CorrelationSwitchService {
  private readonly logger = new Logger(CorrelationSwitchService.name);
  private readonly cache = new Map<
    string,
    { state: CorrelationSwitchState; at: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  private schemaKey(): string {
    return this.cls?.get<string>(CLS_SCHEMA) ?? '__default__';
  }

  async state(maxAgeMs = SWITCH_CACHE_MS): Promise<CorrelationSwitchState> {
    const key = this.schemaKey();
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at <= maxAgeMs) return cached.state;

    let state = DEFAULT_STATE;
    try {
      const row = await this.prisma.correlationConfig.findUnique({
        where: { id: 1 },
        select: { enabled: true, disabledMode: true, enabledChangedAt: true },
      });
      if (row) {
        state = {
          enabled: row.enabled,
          disabledMode: row.enabled ? null : toMode(row.disabledMode),
          changedAt: row.enabledChangedAt ?? null,
        };
      }
    } catch (error) {
      // Unreadable (a namespace whose migrations have not run yet): behave as
      // before the switch existed rather than stall every scan hand-off.
      this.logger.debug(
        `Duplicate-detection switch unreadable for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.cache.set(key, { state, at: Date.now() });
    return state;
  }

  async isEnabled(): Promise<boolean> {
    return (await this.state()).enabled;
  }

  /** Throw {@link DuplicateDetectionOffException} while the switch is off. */
  async assertEnabled(): Promise<void> {
    if (!(await this.isEnabled())) throw new DuplicateDetectionOffException();
  }

  /**
   * Flip the switch. Only the feature service calls this: turning duplicate
   * detection on or off also holds or releases its queue and schedules the
   * catch-up recompute, and none of that belongs here.
   */
  async set(
    enabled: boolean,
    mode: FeatureDisabledMode | null,
  ): Promise<CorrelationSwitchState> {
    const disabledMode = enabled ? null : (mode ?? 'kept');
    const now = new Date();
    const before = await this.state(0);
    // The change time moves only when the switch itself moves: deleting the
    // data of a feature that is already off is not "turned off again".
    const changedAt = before.enabled !== enabled ? now : before.changedAt;
    await this.prisma.correlationConfig.upsert({
      where: { id: 1 },
      create: { id: 1, enabled, disabledMode, enabledChangedAt: changedAt },
      update: { enabled, disabledMode, enabledChangedAt: changedAt },
    });
    const state: CorrelationSwitchState = { enabled, disabledMode, changedAt };
    this.cache.set(this.schemaKey(), { state, at: Date.now() });
    return state;
  }

  invalidate(): void {
    this.cache.delete(this.schemaKey());
  }
}

function toMode(value: string | null | undefined): FeatureDisabledMode {
  return value === 'deleted' ? 'deleted' : 'kept';
}
