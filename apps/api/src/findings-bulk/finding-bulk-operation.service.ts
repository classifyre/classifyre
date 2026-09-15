import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  FindingBulkOperationKind,
  FindingBulkOperationStatus,
  Prisma,
  type FindingBulkOperation,
} from '@prisma/client';

import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import {
  BULK_OPERATION_LEASE_MS,
  FINDING_BULK_OPERATION_QUEUE,
} from './finding-bulk-operation.constants';
import { FindingBulkOperationDto } from './finding-bulk-operation.dto';

const ACTIVE_STATUSES: FindingBulkOperationStatus[] = [
  FindingBulkOperationStatus.PENDING,
  FindingBulkOperationStatus.RUNNING,
];

/**
 * Durable state and lifecycle of background bulk finding operations.
 *
 * Deliberately knows nothing about how findings are matched or changed — that
 * lives with the findings query code in FindingsService. This owns the row: who
 * may run the next chunk (a lease, so two workers never walk the same pages),
 * progress, cancellation, and handing the next chunk to pg-boss.
 */
@Injectable()
export class FindingBulkOperationService {
  private readonly logger = new Logger(FindingBulkOperationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pgBoss: PgBossService,
  ) {}

  async create(input: {
    kind: FindingBulkOperationKind;
    filters: Record<string, unknown>;
    target: Record<string, unknown>;
    totalEstimate: number;
    expectedCount?: number | null;
    counts?: Record<string, unknown>;
    createdBy?: string | null;
  }): Promise<FindingBulkOperation> {
    const operation = await this.prisma.findingBulkOperation.create({
      data: {
        kind: input.kind,
        filters: input.filters as Prisma.InputJsonValue,
        target: input.target as Prisma.InputJsonValue,
        totalEstimate: input.totalEstimate,
        expectedCount: input.expectedCount ?? null,
        ...(input.counts
          ? { counts: input.counts as Prisma.InputJsonValue }
          : {}),
        createdBy: input.createdBy ?? null,
      },
    });
    await this.enqueue(operation.id);
    return operation;
  }

  async get(id: string): Promise<FindingBulkOperation> {
    const operation = await this.prisma.findingBulkOperation.findUnique({
      where: { id },
    });
    if (!operation) {
      throw new NotFoundException(`Bulk operation ${id} not found`);
    }
    return operation;
  }

  async list(
    options: { activeOnly?: boolean; limit?: number } = {},
  ): Promise<FindingBulkOperation[]> {
    return this.prisma.findingBulkOperation.findMany({
      where: options.activeOnly ? { status: { in: ACTIVE_STATUSES } } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(options.limit ?? 20, 1), 100),
    });
  }

  /**
   * Ask a running operation to stop after its current page, or cancel a
   * queued one outright. Pages already committed stay committed — the
   * operation stops, it does not undo.
   */
  async requestCancel(id: string): Promise<FindingBulkOperation> {
    const operation = await this.get(id);
    if (!ACTIVE_STATUSES.includes(operation.status)) return operation;
    if (operation.status === FindingBulkOperationStatus.PENDING) {
      const cancelled = await this.prisma.findingBulkOperation.updateMany({
        where: { id, status: FindingBulkOperationStatus.PENDING },
        data: {
          status: FindingBulkOperationStatus.CANCELLED,
          cancelRequested: true,
          finishedAt: new Date(),
        },
      });
      if (cancelled.count > 0) return this.get(id);
    }
    return this.prisma.findingBulkOperation.update({
      where: { id },
      data: { cancelRequested: true },
    });
  }

  async enqueue(id: string): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(FINDING_BULK_OPERATION_QUEUE);
    // retryLimit 0: a failed chunk is recorded on the row and resumed from its
    // cursor by recovery, not replayed blind by pg-boss.
    await boss.send(
      FINDING_BULK_OPERATION_QUEUE,
      { operationId: id },
      { retryLimit: 0 },
    );
  }

  /**
   * Take the right to run the next chunk. False when the operation is finished,
   * cancelled, or another live handler holds it.
   */
  async claim(id: string): Promise<FindingBulkOperation | null> {
    const now = new Date();
    const claimed = await this.prisma.findingBulkOperation.updateMany({
      where: {
        id,
        status: { in: ACTIVE_STATUSES },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: {
        status: FindingBulkOperationStatus.RUNNING,
        leaseUntil: new Date(now.getTime() + BULK_OPERATION_LEASE_MS),
      },
    });
    if (claimed.count === 0) return null;
    const operation = await this.get(id);
    if (!operation.startedAt) {
      return this.prisma.findingBulkOperation.update({
        where: { id },
        data: { startedAt: now },
      });
    }
    return operation;
  }

  async release(id: string): Promise<void> {
    await this.prisma.findingBulkOperation.updateMany({
      where: { id },
      data: { leaseUntil: null },
    });
  }

  async finish(
    id: string,
    status: FindingBulkOperationStatus,
    errorMessage?: string,
  ): Promise<FindingBulkOperation> {
    return this.prisma.findingBulkOperation.update({
      where: { id },
      data: {
        status,
        leaseUntil: null,
        finishedAt: new Date(),
        ...(errorMessage ? { errorMessage: errorMessage.slice(0, 4000) } : {}),
      },
    });
  }

  /**
   * On worker start: resume what a restart interrupted. Safe because every page
   * is idempotent against its own predicate (a finding already changed no longer
   * matches) and the cursor only advances with a committed page.
   */
  async recoverInterrupted(): Promise<void> {
    const stale = await this.prisma.findingBulkOperation.findMany({
      where: {
        status: { in: ACTIVE_STATUSES },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      select: { id: true },
      take: 50,
    });
    for (const { id } of stale) {
      await this.enqueue(id).catch((error) =>
        this.logger.warn(
          `Could not resume bulk operation ${id}: ${String(error)}`,
        ),
      );
    }
    if (stale.length > 0) {
      this.logger.log(`Resumed ${stale.length} interrupted bulk operation(s)`);
    }
  }

  toDto(operation: FindingBulkOperation): FindingBulkOperationDto {
    const done =
      operation.status === FindingBulkOperationStatus.COMPLETED ||
      operation.status === FindingBulkOperationStatus.CANCELLED ||
      operation.status === FindingBulkOperationStatus.FAILED;
    // A retire walks physical blocks and cannot know its finding total up
    // front, so its progress is blocks scanned; a status change counts findings.
    const scan = scanProgress(operation.counts);
    const [part, total] = scan
      ? [scan.blocksScanned, scan.blocksTotal]
      : [
          operation.processed,
          Math.max(operation.totalEstimate, operation.processed),
        ];
    return {
      id: operation.id,
      kind: operation.kind,
      status: operation.status,
      totalEstimate: operation.totalEstimate,
      expectedCount: operation.expectedCount,
      processed: operation.processed,
      changed: operation.changed,
      exempted: operation.exempted,
      percent:
        operation.status === FindingBulkOperationStatus.COMPLETED
          ? 100
          : total > 0
            ? Math.min(done ? 100 : 99, Math.floor((part / total) * 100))
            : 0,
      counts: (operation.counts ?? {}) as Record<string, unknown>,
      warnings: Array.isArray(operation.warnings)
        ? (operation.warnings as string[])
        : [],
      filters: (operation.filters ?? {}) as Record<string, unknown>,
      target: (operation.target ?? {}) as Record<string, unknown>,
      errorMessage: operation.errorMessage,
      cancelRequested: operation.cancelRequested,
      createdBy: operation.createdBy,
      createdAt: operation.createdAt,
      startedAt: operation.startedAt,
      finishedAt: operation.finishedAt,
    };
  }
}

function scanProgress(
  counts: unknown,
): { blocksScanned: number; blocksTotal: number } | null {
  const scan =
    counts && typeof counts === 'object'
      ? (counts as Record<string, unknown>).scan
      : null;
  if (!scan || typeof scan !== 'object') return null;
  const { blocksScanned, blocksTotal } = scan as Record<string, unknown>;
  return typeof blocksScanned === 'number' &&
    typeof blocksTotal === 'number' &&
    blocksTotal > 0
    ? { blocksScanned: Math.min(blocksScanned, blocksTotal), blocksTotal }
    : null;
}
