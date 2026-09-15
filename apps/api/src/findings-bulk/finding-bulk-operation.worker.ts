import { Injectable, Logger } from '@nestjs/common';
import {
  FindingBulkOperationKind,
  FindingBulkOperationStatus,
} from '@prisma/client';
import type { Job } from 'pg-boss';

import { FindingsService } from '../findings.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import {
  BULK_OPERATION_CHUNK_BUDGET_MS,
  FINDING_BULK_OPERATION_QUEUE,
} from './finding-bulk-operation.constants';
import { FindingBulkOperationService } from './finding-bulk-operation.service';
import { RetireOutOfScopeService } from './retire-out-of-scope.service';

interface BulkOperationJobPayload {
  operationId: string;
}

/**
 * Runs bulk finding operations one bounded chunk per job.
 *
 * A chunk works for at most BULK_OPERATION_CHUNK_BUDGET_MS, then queues the next
 * chunk and returns, giving its global worker slot back. The operation row —
 * not the job — carries the state, so a lost job, a restart or a duplicate
 * delivery costs nothing but a re-claim.
 */
@Injectable()
export class FindingBulkOperationWorker {
  private readonly logger = new Logger(FindingBulkOperationWorker.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly operations: FindingBulkOperationService,
    private readonly findings: FindingsService,
    private readonly retire: RetireOutOfScopeService,
  ) {}

  /** Registered by NamespaceWorkerManager inside the namespace's CLS context. */
  async registerForNamespace(): Promise<void> {
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(FINDING_BULK_OPERATION_QUEUE);
    await this.pgBoss.work(
      FINDING_BULK_OPERATION_QUEUE,
      { localConcurrency: 1 },
      (jobs) => this.handle(jobs as Job<BulkOperationJobPayload>[]),
    );
    await this.operations
      .recoverInterrupted()
      .catch((error) =>
        this.logger.warn(`Bulk operation recovery failed: ${String(error)}`),
      );
    this.logger.log(
      `Registered worker for queue ${FINDING_BULK_OPERATION_QUEUE}`,
    );
  }

  async handle(jobs: Job<BulkOperationJobPayload>[]): Promise<void> {
    for (const job of jobs) {
      const operationId = job.data?.operationId;
      if (operationId) await this.runChunk(operationId);
    }
  }

  async runChunk(operationId: string): Promise<void> {
    const operation = await this.operations.claim(operationId);
    // Finished, cancelled while queued, or held by a live handler elsewhere.
    if (!operation) return;

    if (operation.cancelRequested) {
      await this.operations.finish(
        operationId,
        FindingBulkOperationStatus.CANCELLED,
      );
      return;
    }

    const isRetire =
      operation.kind === FindingBulkOperationKind.RETIRE_OUT_OF_SCOPE;
    try {
      const { done } = isRetire
        ? await this.retire.runChunk(operation, BULK_OPERATION_CHUNK_BUDGET_MS)
        : await this.findings.runBulkOperationChunk(
            operation,
            BULK_OPERATION_CHUNK_BUDGET_MS,
          );
      if (done) {
        const latest = await this.operations.get(operationId);
        const finalStatus = latest.cancelRequested
          ? FindingBulkOperationStatus.CANCELLED
          : FindingBulkOperationStatus.COMPLETED;
        await this.operations.finish(operationId, finalStatus);
        if (isRetire) await this.retire.afterOperation(latest);
        else await this.findings.afterBulkOperation(latest);
        this.logger.log(
          `Bulk operation ${operationId} ${finalStatus.toLowerCase()}: ` +
            `${latest.changed} changed, ${latest.exempted} exempted, ` +
            `${latest.processed} examined`,
        );
        return;
      }
      // More to do: give the slot back and queue the rest.
      await this.operations.release(operationId);
      await this.operations.enqueue(operationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Bulk operation ${operationId} failed: ${message}`);
      await this.operations
        .finish(operationId, FindingBulkOperationStatus.FAILED, message)
        .catch(() => undefined);
    }
  }
}
