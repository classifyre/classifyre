import { Injectable, Logger } from '@nestjs/common';
import { PgBossService } from '../scheduler/pg-boss.service';
import { FindingStatsService } from './finding-stats.service';
import {
  FINDING_STATS_COALESCE_SECONDS,
  FINDING_STATS_FULL_KEY,
  FINDING_STATS_INCREMENTAL_KEY,
  FINDING_STATS_QUEUE,
  type FindingStatsJobPayload,
} from './finding-stats.constants';

/**
 * The only place that enqueues rollup refreshes.
 *
 * Refresh is demand-driven rather than scheduled: a nightly rebuild would be
 * hours stale during a scan and pure waste on an idle night. Instead every
 * write marks the day it touched and asks for a refresh, and two mechanisms
 * stop that from turning into a refresh per batch:
 *
 *  - `singletonKey` + `singletonSeconds` collapse all requests inside the
 *    window onto one job.
 *  - `singletonNextSlot` moves a request that arrives while a job already
 *    occupies the current slot into the *next* slot instead of discarding it,
 *    so the last write before a workspace goes quiet is still reflected.
 *
 * The effect is that during active ingest the rollup trails reality by about
 * one coalescing window, and once writes stop, exactly one final refresh runs
 * and then nothing.
 */
@Injectable()
export class FindingStatsScheduler {
  private readonly logger = new Logger(FindingStatsScheduler.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly stats: FindingStatsService,
  ) {}

  /**
   * Findings were created or changed on `days`. Marks those days dirty and
   * asks for an incremental refresh.
   */
  async scheduleForDays(
    days: Array<Date | null | undefined>,
    reason: string,
  ): Promise<void> {
    try {
      await this.stats.markDaysDirty(days);
    } catch (error) {
      this.logger.warn(
        `Could not mark rollup days dirty (${reason}): ${String(error)}`,
      );
      return;
    }
    await this.send({ reason }, FINDING_STATS_INCREMENTAL_KEY, reason);
  }

  /**
   * Rebuild everything. For mutations whose affected days are not knowable
   * cheaply (a bulk status update across an arbitrary filter, a detector
   * removal that resolves findings of every age) and for the manual refresh.
   */
  async scheduleFull(reason: string): Promise<void> {
    await this.send({ full: true, reason }, FINDING_STATS_FULL_KEY, reason);
  }

  private async send(
    data: FindingStatsJobPayload,
    singletonKey: string,
    reason: string,
  ): Promise<void> {
    try {
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(FINDING_STATS_QUEUE, data, {
        singletonKey,
        singletonSeconds: FINDING_STATS_COALESCE_SECONDS,
        singletonNextSlot: true,
        expireInSeconds: 3600,
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
      });
    } catch (error) {
      // The mutation has already committed; a missed refresh only makes the
      // dashboard stale, and the day stays marked dirty for the next one.
      this.logger.warn(
        `Could not schedule finding rollup refresh (${reason}): ${String(error)}`,
      );
    }
  }
}
