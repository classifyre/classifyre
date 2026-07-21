import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { AgentKind, AgentRunStatus } from '@prisma/client';
import { PgBossService } from '../scheduler/pg-boss.service';
import { PrismaService } from '../prisma.service';
import {
  AUTOPILOT_QUEUE,
  AUTOPILOT_START_AFTER_SECONDS,
} from '../autopilot/autopilot.constants';
import { CORRELATION_QUEUE } from './correlation.constants';
import { DuplicatesFinderAgentService } from './duplicates-finder-agent.service';

interface CorrelationJob {
  sourceId?: string;
  runnerId?: string;
  /** Full recompute of every asset after a tuning change (logged run). */
  recomputeAll?: boolean;
}

/**
 * Consumes CORRELATION_QUEUE jobs (enqueued by the cli-runner when a scan
 * finishes). For each job it runs the deterministic DUPLICATES FINDER AGENT,
 * then hands off to the autopilot cycle — guaranteeing the duplicate/cluster
 * results exist before the inquiry/case agents run.
 */
@Injectable()
export class CorrelationWorker {
  private readonly logger = new Logger(CorrelationWorker.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly prisma: PrismaService,
    private readonly duplicatesFinder: DuplicatesFinderAgentService,
  ) {}

  /**
   * Registers this worker on the CURRENT namespace's pg-boss (invoked by the
   * NamespaceWorkerManager inside the namespace's CLS context).
   */
  async registerForNamespace(): Promise<void> {
    await this.recoverStaleRuns();

    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(CORRELATION_QUEUE);
    await this.pgBoss.work(CORRELATION_QUEUE, { localConcurrency: 1 }, (jobs) =>
      this.handle(jobs as Job[]),
    );
    this.logger.log(`Registered worker for queue ${CORRELATION_QUEUE}`);
  }

  /**
   * Mark any DUPLICATES runs that were still RUNNING when the pod died as
   * FAILED so they don't stay stuck in "running" status indefinitely. Runs
   * once at startup before the queue worker is registered.
   */
  private async recoverStaleRuns(): Promise<void> {
    const result = await this.prisma.agentRun.updateMany({
      where: {
        agentKind: AgentKind.DUPLICATES,
        status: AgentRunStatus.RUNNING,
      },
      data: {
        status: AgentRunStatus.FAILED,
        error: 'Pod restarted while run was in progress (OOM or SIGKILL).',
        finishedAt: new Date(),
      },
    });
    if (result.count > 0) {
      this.logger.warn(
        `Recovered ${result.count} stale DUPLICATES run(s) → FAILED (pod restarted).`,
      );
    }
  }

  private async handle(jobs: Job[]): Promise<void> {
    for (const job of jobs) {
      const data = job.data as CorrelationJob;
      if (data?.recomputeAll) {
        await this.duplicatesFinder.runForConfigChange();
        continue;
      }
      if (!data?.sourceId || !data?.runnerId) continue;
      // Per-namespace pg-boss (schema pgboss_<slug>) guarantees a job can only
      // be dequeued by its own namespace's worker, so no cross-namespace guard
      // is needed here anymore.
      await this.process(data.sourceId, data.runnerId);
    }
  }

  private async process(sourceId: string, runnerId: string): Promise<void> {
    const cycleKey = `scan:${sourceId}:${runnerId}`;
    const sourceName = await this.sourceName(sourceId);

    try {
      await this.duplicatesFinder.runForScan({
        sourceId,
        runnerId,
        cycleKey,
        sourceName,
      });
    } finally {
      // Always hand off to the autopilot cycle, even if correlation failed —
      // the AI agents are independently valuable. Mirrors the previous
      // cli-runner enqueue (singletonKey debounce, delayed start).
      await this.enqueueAutopilot(sourceId, runnerId, cycleKey);
    }
  }

  private async enqueueAutopilot(
    sourceId: string,
    runnerId: string,
    cycleKey: string,
  ): Promise<void> {
    try {
      const boss = await this.pgBoss.getBossAsync();
      await boss.send(
        AUTOPILOT_QUEUE,
        { sourceId, runnerId, cycleKey },
        {
          singletonKey: `autopilot:${sourceId}`,
          startAfter: AUTOPILOT_START_AFTER_SECONDS,
          retryLimit: 2,
          retryDelay: 120,
          retryBackoff: true,
          expireInSeconds: 3 * 3600,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue autopilot cycle for source ${sourceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async sourceName(sourceId: string): Promise<string> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { name: true },
    });
    return source?.name ?? 'a source';
  }
}
