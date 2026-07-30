import { Injectable, Logger } from '@nestjs/common';
import { DataTransferKind, DataTransferStatus } from '@prisma/client';
import type { Job } from 'pg-boss';

import { PgBossService } from '../scheduler/pg-boss.service';
import { PrismaService } from '../prisma.service';
import { ArchiveStorageService } from './archive-storage.service';
import { DataTransferService } from './data-transfer.service';
import { NamespaceExportService } from './namespace-export.service';
import { NamespaceImportService } from './namespace-import.service';
import { DATA_TRANSFER_QUEUE } from './data-transfer.constants';

interface DataTransferJobPayload {
  jobId: string;
}

/** Purge expired archives roughly once an hour per namespace. */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Runs one export or import at a time for the namespace it was registered in.
 *
 * `localConcurrency: 1` is the resource guard the whole feature leans on: a
 * transfer reads or writes most of a tenant's tables, so the only sane number
 * of them to run at once is one. Combined with the per-batch pause in the
 * export/import services, a transfer stays firmly in the background even on a
 * namespace that is actively scanning.
 */
@Injectable()
export class DataTransferWorker {
  private readonly logger = new Logger(DataTransferWorker.name);
  private readonly purgeTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly prisma: PrismaService,
    private readonly transfers: DataTransferService,
    private readonly exporter: NamespaceExportService,
    private readonly importer: NamespaceImportService,
    private readonly storage: ArchiveStorageService,
  ) {}

  /**
   * Registered by NamespaceWorkerManager inside the namespace's CLS context.
   */
  async registerForNamespace(): Promise<void> {
    await this.transfers
      .recoverStaleJobs()
      .catch((error) =>
        this.logger.warn(`Stale transfer recovery failed: ${String(error)}`),
      );
    await this.transfers.purgeExpired().catch(() => undefined);

    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(DATA_TRANSFER_QUEUE);
    await this.pgBoss.work(
      DATA_TRANSFER_QUEUE,
      { localConcurrency: 1 },
      (jobs) => this.handle(jobs as Job<DataTransferJobPayload>[]),
    );

    this.logger.log(`Registered worker for queue ${DATA_TRANSFER_QUEUE}`);
  }

  /** Stop the archive-purge timer and drop the namespace's staged archives. */
  async stopForSchema(schema: string): Promise<void> {
    const timer = this.purgeTimers.get(schema);
    if (timer) {
      clearInterval(timer);
      this.purgeTimers.delete(schema);
    }
    await this.storage.removeSchema(schema);
  }

  /** Schedule the recurring archive purge for the current namespace. */
  schedulePurge(schema: string): void {
    if (this.purgeTimers.has(schema)) return;
    const timer = setInterval(() => {
      void this.transfers.purgeExpired().catch(() => undefined);
    }, PURGE_INTERVAL_MS);
    timer.unref();
    this.purgeTimers.set(schema, timer);
  }

  private async handle(jobs: Job<DataTransferJobPayload>[]): Promise<void> {
    for (const pgJob of jobs) {
      const jobId = pgJob.data?.jobId;
      if (!jobId) continue;

      const job = await this.prisma.dataTransferJob.findUnique({
        where: { id: jobId },
      });
      if (!job) {
        this.logger.warn(`Transfer job ${jobId} no longer exists; skipping`);
        continue;
      }
      if (job.status !== DataTransferStatus.PENDING) {
        // A redelivery after the job already ran, or one cancelled while queued.
        continue;
      }
      if (job.cancelRequested) {
        await this.markCancelled(jobId);
        continue;
      }

      try {
        if (job.kind === DataTransferKind.EXPORT) {
          await this.exporter.run(job);
        } else {
          await this.importer.run(job);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Transfer job ${jobId} (${job.kind}) failed: ${message}`,
        );
        await this.prisma.dataTransferJob
          .update({
            where: { id: jobId },
            data: {
              status: DataTransferStatus.FAILED,
              errorMessage: message,
              currentTable: null,
              finishedAt: new Date(),
            },
          })
          .catch(() => undefined);
      }
    }
  }

  private async markCancelled(jobId: string): Promise<void> {
    await this.prisma.dataTransferJob
      .update({
        where: { id: jobId },
        data: {
          status: DataTransferStatus.CANCELLED,
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined);
  }
}
