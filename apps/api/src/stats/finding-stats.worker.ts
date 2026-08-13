import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { PgBossService } from '../scheduler/pg-boss.service';
import { FindingStatsService } from './finding-stats.service';
import { FindingStatsScheduler } from './finding-stats-scheduler.service';
import {
  FINDING_STATS_QUEUE,
  type FindingStatsJobPayload,
} from './finding-stats.constants';

/**
 * Consumes {@link FINDING_STATS_QUEUE}.
 *
 * `localConcurrency: 1` matters here: two overlapping refreshes would race on
 * the same day rows, and the work is idempotent but not commutative — the
 * cheapest correct answer is to never run two at once. Coalescing upstream
 * means a queue depth of one is also all that is ever needed.
 */
@Injectable()
export class FindingStatsWorker {
  private readonly logger = new Logger(FindingStatsWorker.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly stats: FindingStatsService,
    private readonly scheduler: FindingStatsScheduler,
  ) {}

  /** Registers on the CURRENT namespace's pg-boss (inside its CLS context). */
  async registerForNamespace(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(FINDING_STATS_QUEUE);
    await this.pgBoss.work(
      FINDING_STATS_QUEUE,
      { localConcurrency: 1 },
      (jobs) => this.handle(jobs as Job[]),
    );

    // A workspace that has never built the rollup would otherwise serve the
    // live queries forever. Build it once, in the background, on the
    // background connection lane.
    if (!(await this.stats.isUsable())) {
      await this.scheduler.scheduleFull('first build after migration');
    }
    this.logger.log(`Registered worker for queue ${FINDING_STATS_QUEUE}`);
  }

  private async handle(jobs: Job[]): Promise<void> {
    // The batch is a coalesced set of requests for the same work. Doing it
    // once for the whole batch is the entire point; a full rebuild supersedes
    // any incremental request that rode along with it.
    const payloads = jobs.map((job) => job.data as FindingStatsJobPayload);
    const full = payloads.some((payload) => payload?.full);
    const reason =
      payloads.find((payload) => payload?.reason)?.reason ?? 'unspecified';

    // An incremental refresh only recomputes the days it was told about, so
    // running one against a rollup that was never built would leave every other
    // day missing while marking the result usable. Escalate instead.
    if (full || !(await this.stats.isUsable())) {
      await this.stats.rebuildAll();
      this.logger.log(`Full rollup rebuild complete (${reason}).`);
      return;
    }
    await this.stats.refreshDirtyDays();
  }
}
