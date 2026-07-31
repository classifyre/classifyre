import { Logger } from '@nestjs/common';
import { DataTransferStatus } from '@prisma/client';

import type { PrismaService } from '../prisma.service';
import { MAX_WARNINGS, PROGRESS_FLUSH_MS } from './data-transfer.constants';

/**
 * Accumulates a running transfer's progress in memory and writes it to the job
 * row at most once every {@link PROGRESS_FLUSH_MS}.
 *
 * A transfer processes hundreds of batches; writing progress per batch would
 * put more load on the database than the transfer itself. The same write reads
 * back `cancelRequested`, so cancellation costs no extra query — the worker
 * checks {@link cancelled} between batches and stops at a clean boundary.
 */
export class TransferProgress {
  private readonly logger = new Logger(TransferProgress.name);

  private processed = 0;
  private skipped = 0;
  private total = 0;
  private currentTable: string | null = null;
  private readonly counts: Record<string, number> = {};
  private readonly warnings: string[] = [];
  private suppressedWarnings = 0;
  private lastFlush = 0;
  private cancelledFlag = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobId: string,
  ) {}

  get cancelled(): boolean {
    return this.cancelledFlag;
  }

  get processedRows(): number {
    return this.processed;
  }

  get skippedRows(): number {
    return this.skipped;
  }

  get tableCounts(): Record<string, number> {
    return { ...this.counts };
  }

  get collectedWarnings(): string[] {
    return this.suppressedWarnings > 0
      ? [
          ...this.warnings,
          `…and ${this.suppressedWarnings} more warnings (see the API log).`,
        ]
      : [...this.warnings];
  }

  setTotal(total: number): void {
    this.total = total;
  }

  setTable(table: string | null): void {
    this.currentTable = table;
  }

  advance(table: string, rows: number): void {
    this.processed += rows;
    this.counts[table] = (this.counts[table] ?? 0) + rows;
  }

  skip(rows: number): void {
    this.skipped += rows;
  }

  warn(message: string): void {
    if (this.warnings.includes(message)) return;
    if (this.warnings.length >= MAX_WARNINGS) {
      this.suppressedWarnings += 1;
      this.logger.warn(`[job ${this.jobId}] ${message}`);
      return;
    }
    this.warnings.push(message);
  }

  /** Percent complete, clamped — the total is an estimate taken up front. */
  get percent(): number {
    if (this.total <= 0) return this.processed > 0 ? 99 : 0;
    return Math.max(
      0,
      Math.min(99, Math.round((this.processed / this.total) * 100)),
    );
  }

  /**
   * Persist progress if the throttle window has elapsed (or `force`). Refreshes
   * {@link cancelled} from the same statement.
   */
  async flush(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastFlush < PROGRESS_FLUSH_MS) return;
    this.lastFlush = now;

    try {
      const row = await this.prisma.dataTransferJob.update({
        where: { id: this.jobId },
        data: {
          status: DataTransferStatus.RUNNING,
          totalRows: this.total,
          processedRows: this.processed,
          skippedRows: this.skipped,
          percent: this.percent,
          currentTable: this.currentTable,
          counts: this.counts,
          warnings: this.collectedWarnings,
        },
        select: { cancelRequested: true },
      });
      this.cancelledFlag = row.cancelRequested;
    } catch (error) {
      // Progress is advisory: a lost update must never abort the transfer.
      this.logger.warn(
        `Progress flush failed for job ${this.jobId}: ${String(error)}`,
      );
    }
  }
}
