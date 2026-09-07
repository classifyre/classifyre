import { Injectable, Logger } from '@nestjs/common';
import { PgBossService } from '../scheduler/pg-boss.service';
import {
  SOURCE_GRAPH_COALESCE_SECONDS,
  SOURCE_GRAPH_QUEUE,
  SOURCE_GRAPH_SINGLETON_KEY,
  type SourceGraphJobPayload,
} from './source-graph.constants';

/**
 * The only place that enqueues a source-map rebuild.
 *
 * Demand-driven, like the finding-stats rollup: a connector emitting
 * relationships asks after every batch, and the coalescing window collapses
 * those into roughly one rebuild per window while ingest is running and exactly
 * one after it stops.
 */
@Injectable()
export class SourceGraphScheduler {
  private readonly logger = new Logger(SourceGraphScheduler.name);

  constructor(private readonly pgBoss: PgBossService) {}

  async scheduleRebuild(reason: string): Promise<void> {
    const data: SourceGraphJobPayload = { reason };
    try {
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(SOURCE_GRAPH_QUEUE, data, {
        singletonKey: SOURCE_GRAPH_SINGLETON_KEY,
        singletonSeconds: SOURCE_GRAPH_COALESCE_SECONDS,
        singletonNextSlot: true,
        expireInSeconds: 3600,
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
      });
    } catch (error) {
      // A missed rebuild leaves the map stale, never wrong — the UI says how
      // old it is and offers a manual refresh. Not worth failing a scan over.
      this.logger.warn(
        `Could not queue source connection map rebuild (${reason}): ${String(error)}`,
      );
    }
  }
}
