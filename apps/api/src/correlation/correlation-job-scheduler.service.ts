import { Injectable, Logger, Optional } from '@nestjs/common';
import { PgBossService } from '../scheduler/pg-boss.service';
import { CORRELATION_QUEUE } from './correlation.constants';
import { CorrelationSwitchService } from './correlation-switch.service';

export interface CorrelationJobPayload {
  sourceId?: string;
  runnerId?: string;
  assetIds?: string[];
  recomputeAll?: boolean;
  manual?: boolean;
}

const COALESCE_SECONDS = 5;

/** One place for durable, replica-safe correlation job options. */
@Injectable()
export class CorrelationJobScheduler {
  private readonly logger = new Logger(CorrelationJobScheduler.name);

  constructor(
    private readonly pgBoss: PgBossService,
    // Optional and last so the specs' positional construction keeps working;
    // absent reads as "on".
    @Optional() private readonly featureSwitch?: CorrelationSwitchService,
  ) {}

  /**
   * Whether duplicate detection wants work at all.
   *
   * Refusing here rather than letting the job sit in the held queue matters:
   * every edit, exclusion and bulk update schedules a recompute, and a backlog
   * of them released at once when the switch comes back on would be pure
   * waste — turning it on schedules one full recompute that covers them all.
   */
  private async accepting(reason: string): Promise<boolean> {
    if (!this.featureSwitch || (await this.featureSwitch.isEnabled())) {
      return true;
    }
    this.logger.debug(
      `Duplicate detection is off — not scheduling correlation work (${reason})`,
    );
    return false;
  }

  /** Queue a full recompute. Returns false when the queue could not take it. */
  async scheduleFull(reason: string, manual = false): Promise<boolean> {
    if (!(await this.accepting(reason))) return false;
    return this.sendBestEffort(
      { recomputeAll: true, manual },
      {
        singletonKey: 'correlation:recompute-all',
        singletonSeconds: COALESCE_SECONDS,
        singletonNextSlot: true,
        expireInSeconds: 6 * 3600,
        retryLimit: 2,
        retryDelay: 60,
        retryBackoff: true,
      },
      reason,
    );
  }

  async scheduleAssets(assetIds: string[], reason: string): Promise<boolean> {
    const unique = [...new Set(assetIds)].filter(Boolean);
    if (unique.length === 0) return false;
    if (!(await this.accepting(reason))) return false;
    return this.sendBestEffort(
      { assetIds: unique },
      {
        expireInSeconds: 3 * 3600,
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
      },
      reason,
    );
  }

  private async sendBestEffort(
    data: CorrelationJobPayload,
    options: Record<string, unknown>,
    reason: string,
  ): Promise<boolean> {
    try {
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(CORRELATION_QUEUE, data, options);
      return true;
    } catch (error) {
      // The mutation has already committed. Keep it successful and make the
      // missed background work visible; stale graph reads will nudge refreshes.
      this.logger.warn(
        `Could not schedule correlation work (${reason}): ${String(error)}`,
      );
      return false;
    }
  }

  /**
   * Seconds a scheduled full recompute may sit before it starts.
   *
   * Surfaced to callers so a config response can say when the change actually
   * takes effect. Tuning is applied while a scan indexes an asset's correlation
   * values, so until that recompute runs the review queue still reflects the
   * OLD weights — which is exactly why one re-weighting looked instant (a scan
   * happened to be running) and the next looked like it did nothing.
   */
  readonly coalesceSeconds = COALESCE_SECONDS;
}
