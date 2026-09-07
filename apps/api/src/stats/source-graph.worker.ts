import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { PgBossService } from '../scheduler/pg-boss.service';
import { SourceGraphService } from './source-graph.service';
import { SourceGraphScheduler } from './source-graph-scheduler.service';
import {
  SOURCE_GRAPH_QUEUE,
  type SourceGraphJobPayload,
} from './source-graph.constants';

/**
 * Consumes {@link SOURCE_GRAPH_QUEUE}.
 *
 * `localConcurrency: 1` because the rebuild truncates and repopulates three
 * tables; two of them running at once would have one reading what the other has
 * just emptied. Coalescing upstream means a depth of one is all that is needed.
 */
@Injectable()
export class SourceGraphWorker {
  private readonly logger = new Logger(SourceGraphWorker.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly sourceGraph: SourceGraphService,
    private readonly scheduler: SourceGraphScheduler,
  ) {}

  /** Registers on the CURRENT namespace's pg-boss (inside its CLS context). */
  async registerForNamespace(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(SOURCE_GRAPH_QUEUE);
    await this.pgBoss.work(
      SOURCE_GRAPH_QUEUE,
      { localConcurrency: 1 },
      (jobs) => this.handle(jobs as Job[]),
    );

    // A workspace whose map was never built would otherwise show an empty
    // dashboard panel forever, since nothing else triggers the first build.
    if (!(await this.sourceGraph.isUsable())) {
      await this.scheduler.scheduleRebuild('first build after migration');
    }
    this.logger.log(`Registered worker for queue ${SOURCE_GRAPH_QUEUE}`);
  }

  private async handle(jobs: Job[]): Promise<void> {
    // The batch is a coalesced set of requests for one piece of work.
    const reason =
      jobs
        .map((job) => job.data as SourceGraphJobPayload)
        .find((payload) => payload?.reason)?.reason ?? 'unspecified';
    const result = await this.sourceGraph.rebuild();
    this.logger.log(
      `Source connection map rebuilt (${reason}): ${result.sources} sources, ${result.links} links.`,
    );
  }
}
