import { Injectable, Logger, Optional } from '@nestjs/common';
import { PgBossService } from '../scheduler/pg-boss.service';
import { CORRELATION_QUEUE, VALUES_INDEX_QUEUE } from './correlation.constants';
import { CorrelationSwitchService } from './correlation-switch.service';
import { EntitySwitchService } from '../entities/entity-switch.service';

export interface CorrelationJobPayload {
  sourceId?: string;
  runnerId?: string;
  assetIds?: string[];
  recomputeAll?: boolean;
  manual?: boolean;
  /** VALUES_INDEX_QUEUE only: resolve every entity after a full reindex. */
  thenResolve?: boolean;
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
    @Optional() private readonly entitySwitch?: EntitySwitchService,
  ) {}

  /**
   * Which queue this work belongs on, or null when nothing wants it.
   *
   * With duplicate detection on it is CORRELATION_QUEUE, which indexes and
   * scores. With it off and entities on it is VALUES_INDEX_QUEUE, which only
   * keeps the value index fresh (G5 R9). With both off the work is refused
   * rather than left in a held queue: every edit, exclusion and bulk update
   * schedules a recompute, and a backlog of them released at once when a
   * switch comes back on would be pure waste — turning it on schedules one
   * full pass that covers them all.
   */
  private async targetQueue(reason: string): Promise<string | null> {
    if (!this.featureSwitch || (await this.featureSwitch.isEnabled())) {
      return CORRELATION_QUEUE;
    }
    if (this.entitySwitch && (await this.entitySwitch.isEnabled())) {
      return VALUES_INDEX_QUEUE;
    }
    this.logger.debug(
      `Duplicate detection and entities are off — not scheduling value-index work (${reason})`,
    );
    return null;
  }

  /** Queue a full recompute. Returns false when the queue could not take it. */
  async scheduleFull(reason: string, manual = false): Promise<boolean> {
    const queue = await this.targetQueue(reason);
    if (!queue) return false;
    return this.sendBestEffort(
      queue,
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
    const queue = await this.targetQueue(reason);
    if (!queue) return false;
    return this.sendBestEffort(
      queue,
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

  /**
   * Queue a full rebuild of the value index alone, for entities turned on
   * while duplicate detection is off. `thenResolve` asks the worker to resolve
   * every entity once the index is back.
   */
  async scheduleReindex(reason: string): Promise<boolean> {
    return this.sendBestEffort(
      VALUES_INDEX_QUEUE,
      { recomputeAll: true, thenResolve: true },
      {
        singletonKey: 'values-index:all',
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

  private async sendBestEffort(
    queue: string,
    data: CorrelationJobPayload,
    options: Record<string, unknown>,
    reason: string,
  ): Promise<boolean> {
    try {
      const boss = await this.pgBoss.getBossAsync();
      // A workspace that never had entities on has no `values.index` queue
      // until its workers next register; creating it is a no-op otherwise.
      if (queue === VALUES_INDEX_QUEUE) await boss.createQueue(queue);
      await boss.send(queue, data, options);
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
