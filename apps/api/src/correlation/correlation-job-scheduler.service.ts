import { Injectable, Logger } from '@nestjs/common';
import { PgBossService } from '../scheduler/pg-boss.service';
import { CORRELATION_QUEUE } from './correlation.constants';

export interface CorrelationJobPayload {
  sourceId?: string;
  runnerId?: string;
  assetIds?: string[];
  recomputeAll?: boolean;
  refreshGraph?: boolean;
  manual?: boolean;
}

const COALESCE_SECONDS = 5;

/**
 * Coalescing window for whole-graph rebuilds, which is a different problem from
 * coalescing a recompute.
 *
 * A rebuild assembles every node and edge in the namespace at once. On a real
 * corpus (61k nodes / 272k edges) that measured 13–24 seconds and drove the API
 * heap from ~160 MB to ~1.8 GB per pass. With the 5-second window used for
 * recomputes, an active scan — which invalidates correlation continuously —
 * queues the next rebuild long before the current one finishes, so the API
 * rebuilds the graph back-to-back for the entire scan and eventually dies of a
 * failed allocation. The published versions tell the story plainly: v316 → v322
 * inside twenty minutes.
 *
 * The window must therefore exceed the build itself by a wide margin. Reads
 * stay correct while it is open: a stale read serves the last-good snapshot and
 * nudges a refresh (see CorrelationGraphCacheService), so the cost of waiting
 * is a graph that lags a scan by a couple of minutes — which is the right
 * trade against an API that cannot stay up.
 */
const GRAPH_COALESCE_SECONDS = readPositiveIntEnv(
  'CORRELATION_GRAPH_COALESCE_SECONDS',
  180,
);

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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

  async scheduleGraphRefresh(reason: string): Promise<void> {
    await this.sendBestEffort(
      { refreshGraph: true },
      {
        singletonKey: 'correlation:graph-refresh',
        singletonSeconds: GRAPH_COALESCE_SECONDS,
        singletonNextSlot: true,
        expireInSeconds: 30 * 60,
        retryLimit: 3,
        retryDelay: 15,
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
