import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { AgentKind, AgentRunStatus, RunnerStatus } from '@prisma/client';
import { PgBossService } from '../scheduler/pg-boss.service';
import { PrismaService } from '../prisma.service';
import { InquiryMatchingService } from '../matching/inquiry-matching.service';
import {
  AI_ACTOR,
  AUTOPILOT_COALESCE_WINDOW_SECONDS,
  AUTOPILOT_CORPUS_SINGLETON_KEY,
  AUTOPILOT_QUEUE,
  AUTOPILOT_START_AFTER_SECONDS,
  EXPRESS_CONSECUTIVE_FAILURES,
  EXPRESS_IMPORTANCE_SCORE,
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
    private readonly matching: InquiryMatchingService,
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
      // Always hand off to the autopilot, even if correlation failed — the AI
      // agents are independently valuable.
      await this.handOffToAutopilot(sourceId, runnerId, cycleKey);
    }
  }

  /**
   * Enrol the scanned source in the next corpus-wide cycle, and decide whether
   * anything about this scan is urgent enough to skip the wait.
   *
   * Each completed scan used to enqueue its own cycle, debounced per source. On
   * a 151-source corpus that produced 151 independent cycles of five agents
   * apiece, each reasoning over whatever had landed so far and none aware of
   * the others — which is how five separate "HTML email artifact noise"
   * inquiries came to exist, one per mailbox.
   */
  private async handOffToAutopilot(
    sourceId: string,
    runnerId: string,
    cycleKey: string,
  ): Promise<void> {
    try {
      await this.prisma.source.update({
        where: { id: sourceId },
        data: { autopilotDirtyAt: new Date() },
      });

      const express = await this.expressReason(sourceId, runnerId);
      if (express) {
        this.logger.log(
          `Express autopilot cycle for source ${sourceId}: ${express.reason}`,
        );
        await this.enqueue(
          {
            sourceId,
            runnerId,
            cycleKey,
            trigger: 'express',
            expressReason: express.reason,
            agentKinds: express.agentKinds,
          },
          {
            // Throttled per source for the same reason as the corpus job — a
            // bare singletonKey is inert on a `standard` queue. A source that
            // is rescanning in a tight loop gets one express cycle per window,
            // not one per scan.
            singletonKey: `autopilot:express:${sourceId}`,
            singletonSeconds: AUTOPILOT_COALESCE_WINDOW_SECONDS,
            startAfter: AUTOPILOT_START_AFTER_SECONDS,
          },
        );
        return;
      }

      // One corpus job per window, whatever the scan rate.
      //
      // `singletonKey` ALONE does not do this. In pg-boss 12 every
      // single-job-per-key index is predicated on the queue's policy
      // (`short`/`singleton`/`stately`/`exclusive`), and this queue is created
      // with the default `standard` policy — so a bare singletonKey dedupes
      // nothing and each scan would still get its own cycle. `singletonSeconds`
      // is the policy-independent path: it buckets `singleton_on` into
      // fixed-width slots and the unique index `job_i4 (name, singleton_on,
      // singleton_key)` applies regardless of policy.
      //
      // The window is only worth waiting out when something else is still
      // scanning — that is the whole point of accumulating. A lone source has
      // nothing to batch with, so it keeps the original short delay rather than
      // sitting idle for ten minutes.
      const inFlight = await this.prisma.source.count({
        where: {
          runnerStatus: { in: [RunnerStatus.PENDING, RunnerStatus.RUNNING] },
        },
      });
      await this.enqueue(
        { corpus: true, cycleKey: `corpus:${new Date().toISOString()}` },
        {
          singletonKey: AUTOPILOT_CORPUS_SINGLETON_KEY,
          singletonSeconds: AUTOPILOT_COALESCE_WINDOW_SECONDS,
          startAfter:
            inFlight > 0
              ? AUTOPILOT_COALESCE_WINDOW_SECONDS
              : AUTOPILOT_START_AFTER_SECONDS,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue autopilot cycle for source ${sourceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async enqueue(
    data: Record<string, unknown>,
    opts: {
      singletonKey: string;
      singletonSeconds: number;
      startAfter: number;
    },
  ): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.send(AUTOPILOT_QUEUE, data, {
      ...opts,
      // Collisions must DEFER, not vanish. Without this a scan finishing after
      // its slot's job had already run left its source marked dirty with no
      // job to consume it — stranded until some later scan happened to land in
      // a new slot, and on a single-source instance (scan twice inside one
      // window) that meant never. pg-boss retries the insert with
      // `singletonOffset = singletonSeconds`, moving the job to the next slot.
      singletonNextSlot: true,
      retryLimit: 2,
      retryDelay: 120,
      retryBackoff: true,
      expireInSeconds: 3 * 3600,
    });
  }

  /**
   * Whether this scan produced something that should not wait for the window.
   * Batching must not mean a real hit sits unnoticed for ten minutes.
   *
   * Checked in cost order, cheapest first. Returns null when nothing is urgent
   * — the ordinary case — so the source simply joins the next batch.
   */
  private async expressReason(
    sourceId: string,
    runnerId: string,
  ): Promise<{ reason: string; agentKinds?: AgentKind[] } | null> {
    // 1. Operational failure. Routed to CONFIG + notification, deliberately NOT
    //    to the investigation agents: a source that will not scan is an
    //    operator problem, and 60 of the first run's 82 scans errored while the
    //    agents drew conclusions from the 14 that worked and said nothing about
    //    the rest.
    const runner = await this.prisma.runner.findUnique({
      where: { id: runnerId },
      select: { status: true, assetsWithoutText: true, assetsCreated: true },
    });
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { consecutiveFailures: true },
    });
    if (runner?.status === RunnerStatus.ERROR) {
      return {
        reason: 'scan failed',
        agentKinds: [AgentKind.CONFIG],
      };
    }
    if ((source?.consecutiveFailures ?? 0) >= EXPRESS_CONSECUTIVE_FAILURES) {
      return {
        reason: `source has failed ${source?.consecutiveFailures} scans in a row`,
        agentKinds: [AgentKind.CONFIG],
      };
    }
    // A run can report success having read none of its assets' actual content.
    const created = runner?.assetsCreated ?? 0;
    const withoutText = runner?.assetsWithoutText ?? 0;
    if (created > 0 && withoutText >= created) {
      return {
        reason: 'scan produced assets but extracted no text from any of them',
        agentKinds: [AgentKind.CONFIG],
      };
    }

    // 2. A hit on something the operator explicitly asked to watch. Operator
    //    intent outranks the batch by definition.
    //
    //    Read from inquiries, not detectors: CustomDetector has no authorship
    //    column, so an operator-written detector is indistinguishable from one
    //    the detector-authoring agent wrote. An Inquiry records `createdBy`,
    //    and is in any case the more direct expression of "tell me when this
    //    appears".
    //
    //    Stored newMatchCount is corpus-wide and may describe an unread match
    //    from a different source. Prove that THIS runner produced a new live
    //    match, otherwise one unread inquiry would expedite every source.
    const operatorInquiry = await this.matching.findNewInquiryMatchForRunner({
      sourceId,
      runnerId,
      createdByNot: AI_ACTOR,
    });
    if (operatorInquiry) {
      return {
        reason: `operator-authored inquiry "${operatorInquiry.title}" has new matches`,
      };
    }

    // 3. A finding the evidence analyzer scored as genuinely important. Read
    //    from the denormalized score, so an unanalyzed backlog simply yields no
    //    express trigger rather than a guess — the batch is the safe default.
    const important = await this.prisma.finding.findFirst({
      where: {
        runnerId,
        status: 'OPEN',
        importanceScore: { gte: EXPRESS_IMPORTANCE_SCORE },
      },
      orderBy: { importanceScore: 'desc' },
      select: { id: true, importanceScore: true },
    });
    if (important) {
      return {
        reason: `high-importance finding scored ${important.importanceScore}`,
      };
    }

    return null;
  }

  private async sourceName(sourceId: string): Promise<string> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { name: true },
    });
    return source?.name ?? 'a source';
  }
}
