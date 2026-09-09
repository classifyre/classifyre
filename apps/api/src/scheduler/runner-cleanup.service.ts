import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { RunnerStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from './pg-boss.service';
import { RunnerLogStorageService } from '../cli-runner/runner-log-storage.service';
import { KubernetesCliJobService } from '../cli-runner/kubernetes-cli-job.service';

/** pg-boss queue + schedule name for the nightly cleanup job. */
const CLEANUP_QUEUE = 'cleanup-old-runners';

/** Default retention window: scan runs older than this are removed. */
const DEFAULT_RETENTION_DAYS = 14;

/** Default cron: 03:00 every day (UTC), off-peak. */
const DEFAULT_CRON = '0 3 * * *';

/** pg-boss queue + schedule name for the orphaned-Job reaper. */
const REAP_QUEUE = 'reap-orphaned-cli-jobs';

/**
 * Default reaper cron: every five minutes.
 *
 * Deliberately far more frequent than the nightly cleanup above, because an
 * orphan is not stale history taking up disk — it is a pod holding CPU and
 * memory on the node right now.
 */
const DEFAULT_REAP_CRON = '*/5 * * * *';

/**
 * How long a runner must have been terminal before its Job is reaped.
 *
 * A pod that finished normally is torn down by its own exit a moment after the
 * API records the outcome, so anything younger than this is very likely just
 * mid-teardown and reaping it would race a clean exit for no benefit.
 */
const REAP_GRACE_MS = 2 * 60 * 1000;

/** Most orphans to reap in one pass, so a backlog cannot monopolise the tick. */
const REAP_BATCH_SIZE = 50;

/** How many expired runners to delete per DB round-trip. */
const DELETE_BATCH_SIZE = 500;

/** Terminal statuses safe to delete — never touch PENDING/RUNNING. */
const TERMINAL_STATUSES = [
  RunnerStatus.COMPLETED,
  RunnerStatus.WARNING,
  RunnerStatus.ERROR,
];

/**
 * Nightly maintenance job that keeps scan history bounded.
 *
 * 1. Deletes scan runs (`Runner` rows, cascading to `runner_assets`) older than
 *    the retention window, after removing their persisted S3 logs.
 * 2. Sweeps orphaned S3 log objects — logs whose runner row no longer exists
 *    (e.g. left behind by a `Source` cascade delete that bypassed S3).
 *
 * Configuration:
 *   RUNNER_RETENTION_DAYS  — retention window in days (default 14)
 *   RUNNER_CLEANUP_CRON    — cron expression in UTC (default "0 3 * * *")
 */
@Injectable()
export class RunnerCleanupService {
  private readonly logger = new Logger(RunnerCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
    private readonly runnerLogStorage: RunnerLogStorageService,
    private readonly k8sJobs: KubernetesCliJobService,
  ) {}

  /**
   * Registers this worker on the CURRENT namespace's pg-boss (invoked by the
   * NamespaceWorkerManager inside the namespace's CLS context). Job handlers
   * are re-wrapped in that context by {@link PgBossService.work}.
   */
  async registerForNamespace(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    // pg-boss 12.x requires the queue to exist before work()/schedule().
    await boss.createQueue(CLEANUP_QUEUE);
    await this.pgBoss.work(CLEANUP_QUEUE, { localConcurrency: 1 }, (jobs) =>
      this.handleCleanupJob(jobs as Job[]),
    );

    const cron = process.env.RUNNER_CLEANUP_CRON || DEFAULT_CRON;
    // schedule() is an upsert keyed by name, so this is idempotent across boots.
    await boss.schedule(CLEANUP_QUEUE, cron, {}, { tz: 'UTC' });

    await boss.createQueue(REAP_QUEUE);
    await this.pgBoss.work(REAP_QUEUE, { localConcurrency: 1 }, (jobs) =>
      this.handleReapJob(jobs as Job[]),
    );
    const reapCron = process.env.CLI_JOB_REAP_CRON || DEFAULT_REAP_CRON;
    await boss.schedule(REAP_QUEUE, reapCron, {}, { tz: 'UTC' });

    this.logger.log(
      `Registered nightly runner cleanup: "${cron}" (UTC), retention ${this.resolveRetentionDays()}d; ` +
        `orphaned CLI Job reaper: "${reapCron}" (UTC)`,
    );
  }

  private resolveRetentionDays(): number {
    const raw = process.env.RUNNER_RETENTION_DAYS;
    if (!raw) return DEFAULT_RETENTION_DAYS;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_RETENTION_DAYS;
  }

  /** pg-boss delivers the scheduled job (possibly batched); one pass suffices. */
  private async handleCleanupJob(_jobs: Job[]): Promise<void> {
    await this.runCleanup();
  }

  /** pg-boss delivers the scheduled job (possibly batched); one pass suffices. */
  private async handleReapJob(_jobs: Job[]): Promise<void> {
    await this.reapOrphanedJobs();
  }

  /**
   * Delete Kubernetes Jobs whose runner already reached a terminal state.
   *
   * The two can drift apart: the API marks a runner ERROR the moment a CLI
   * call fails, but nothing makes the pod exit, and
   * `K8S_CLI_JOB_CLEANUP_POLICY=failed` only reaps a Job after the POD fails —
   * which never happens if the process keeps running. Observed on a dev
   * cluster: three runners marked ERROR within one second of starting, their
   * extract pods still running forty minutes later, one of them holding
   * 1.9 CPU and 2.3 GB.
   *
   * These orphans are worse than wasted capacity, because they are invisible
   * to the concurrency cap: `canStartNewRunner` counts runner ROWS in RUNNING,
   * so a pod whose row says ERROR consumes the node without occupying a slot.
   * MAX_CONCURRENT_RUNNERS is only a real limit if this drift is corrected.
   */
  async reapOrphanedJobs(): Promise<{ reaped: number }> {
    const cutoff = new Date(Date.now() - REAP_GRACE_MS);

    const candidates = await this.prisma.runner.findMany({
      where: {
        status: { in: TERMINAL_STATUSES },
        jobName: { not: null },
        completedAt: { not: null, lt: cutoff },
      },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        status: true,
        jobName: true,
        jobNamespace: true,
        completedAt: true,
      },
      take: REAP_BATCH_SIZE,
    });
    if (candidates.length === 0) return { reaped: 0 };

    let reaped = 0;
    for (const runner of candidates) {
      const jobName = runner.jobName;
      if (!jobName) continue;
      try {
        // Ask Kubernetes before deleting: the overwhelming majority of these
        // rows are ordinary finished runs whose Job is long gone, and this
        // sweep runs every few minutes.
        const active = await this.k8sJobs.isJobActive(
          jobName,
          runner.jobNamespace ?? undefined,
        );
        if (!active) continue;

        await this.k8sJobs.stopRunnerJob(runner.id, {
          jobName,
          ...(runner.jobNamespace ? { namespace: runner.jobNamespace } : {}),
        });
        reaped++;
        this.logger.warn(
          `Reaped orphaned CLI Job ${jobName} for runner ${runner.id}: the run ` +
            `has been ${runner.status} since ${runner.completedAt?.toISOString()} ` +
            `but its pod was still active.`,
        );
      } catch (err) {
        // Never let one unreachable Job stop the sweep — the next tick retries.
        this.logger.warn(
          `Failed to reap CLI Job ${jobName} for runner ${runner.id}: ${String(err)}`,
        );
      }
    }

    if (reaped > 0) {
      this.logger.log(`Orphaned CLI Job reaper: deleted ${reaped} Job(s).`);
    }
    return { reaped };
  }

  /** Public entrypoint so the cleanup can also be triggered/tested directly. */
  async runCleanup(): Promise<{
    deletedRunners: number;
    deletedOrphans: number;
  }> {
    const retentionDays = this.resolveRetentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    this.logger.log(
      `Runner cleanup started: removing runs triggered before ${cutoff.toISOString()} (${retentionDays}d).`,
    );

    const deletedRunners = await this.deleteExpiredRunners(cutoff);
    const deletedOrphans = await this.sweepOrphanedLogs(cutoff);

    this.logger.log(
      `Runner cleanup complete: deleted ${deletedRunners} expired run(s); removed ${deletedOrphans} orphaned log object(s).`,
    );

    return { deletedRunners, deletedOrphans };
  }

  /**
   * Delete terminal runs older than the cutoff, in batches. S3 logs are removed
   * first so a successful DB delete can never orphan the object.
   */
  private async deleteExpiredRunners(cutoff: Date): Promise<number> {
    let totalDeleted = 0;

    for (;;) {
      const expired = await this.prisma.runner.findMany({
        where: {
          triggeredAt: { lt: cutoff },
          status: { in: TERMINAL_STATUSES },
        },
        orderBy: { triggeredAt: 'asc' },
        select: { id: true, sourceId: true },
        take: DELETE_BATCH_SIZE,
      });
      if (expired.length === 0) break;

      for (const runner of expired) {
        await this.runnerLogStorage
          .deleteRunnerLogs(runner.sourceId, runner.id)
          .catch((err) =>
            this.logger.warn(
              `Failed to delete logs for runner ${runner.id}: ${String(err)}`,
            ),
          );
      }

      // Cascades to runner_assets via onDelete: Cascade.
      const result = await this.prisma.runner.deleteMany({
        where: { id: { in: expired.map((r) => r.id) } },
      });
      totalDeleted += result.count;

      if (expired.length < DELETE_BATCH_SIZE) break;
    }

    return totalDeleted;
  }

  /**
   * Remove stored log objects (S3 or local files) that no longer have a
   * matching runner row. Only objects older than the cutoff are considered,
   * so logs for freshly-started runs (whose row may not be committed yet)
   * are never touched.
   */
  private async sweepOrphanedLogs(cutoff: Date): Promise<number> {
    if (!this.runnerLogStorage.isPersistenceEnabled) return 0;

    const objects = await this.runnerLogStorage.listStoredLogObjects();
    const candidates = objects.filter(
      (o) => !o.lastModified || o.lastModified < cutoff,
    );
    if (candidates.length === 0) return 0;

    const existing = new Set(
      (await this.prisma.runner.findMany({ select: { id: true } })).map(
        (r) => r.id,
      ),
    );

    let removed = 0;
    for (const obj of candidates) {
      if (existing.has(obj.runnerId)) continue;
      try {
        await this.runnerLogStorage.deleteRunnerLogs(
          obj.sourceId,
          obj.runnerId,
        );
        removed += 1;
      } catch (err) {
        this.logger.warn(
          `Failed to delete orphaned log ${obj.key}: ${String(err)}`,
        );
      }
    }

    return removed;
  }
}
