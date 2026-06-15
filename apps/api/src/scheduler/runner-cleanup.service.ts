import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job } from 'pg-boss';
import { RunnerStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PgBossService } from './pg-boss.service';
import { RunnerLogStorageService } from '../cli-runner/runner-log-storage.service';

/** pg-boss queue + schedule name for the nightly cleanup job. */
const CLEANUP_QUEUE = 'cleanup-old-runners';

/** Default retention window: scan runs older than this are removed. */
const DEFAULT_RETENTION_DAYS = 14;

/** Default cron: 03:00 every day (UTC), off-peak. */
const DEFAULT_CRON = '0 3 * * *';

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
export class RunnerCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RunnerCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
    private readonly runnerLogStorage: RunnerLogStorageService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    // pg-boss 12.x requires the queue to exist before work()/schedule().
    await boss.createQueue(CLEANUP_QUEUE);
    await boss.work(CLEANUP_QUEUE, { localConcurrency: 1 }, (jobs: Job[]) =>
      this.handleCleanupJob(jobs),
    );

    const cron = process.env.RUNNER_CLEANUP_CRON || DEFAULT_CRON;
    // schedule() is an upsert keyed by name, so this is idempotent across boots.
    await boss.schedule(CLEANUP_QUEUE, cron, {}, { tz: 'UTC' });

    this.logger.log(
      `Registered nightly runner cleanup: "${cron}" (UTC), retention ${this.resolveRetentionDays()}d`,
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
   * Remove S3 log objects that no longer have a matching runner row. Only
   * objects older than the cutoff are considered, so logs for freshly-started
   * runs (whose row may not be committed yet) are never touched.
   */
  private async sweepOrphanedLogs(cutoff: Date): Promise<number> {
    if (!this.runnerLogStorage.isS3Enabled) return 0;

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
