import { Injectable, Logger } from '@nestjs/common';
import { PgBossService } from '../scheduler/pg-boss.service';
import { CORRELATION_QUEUE } from './correlation.constants';

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

  constructor(private readonly pgBoss: PgBossService) {}

  async scheduleFull(reason: string, manual = false): Promise<void> {
    await this.sendBestEffort(
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

  async scheduleAssets(assetIds: string[], reason: string): Promise<void> {
    const unique = [...new Set(assetIds)].filter(Boolean);
    if (unique.length === 0) return;
    await this.sendBestEffort(
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
  ): Promise<void> {
    try {
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(CORRELATION_QUEUE, data, options);
    } catch (error) {
      // The mutation has already committed. Keep it successful and make the
      // missed background work visible; stale graph reads will nudge refreshes.
      this.logger.warn(
        `Could not schedule correlation work (${reason}): ${String(error)}`,
      );
    }
  }
}
