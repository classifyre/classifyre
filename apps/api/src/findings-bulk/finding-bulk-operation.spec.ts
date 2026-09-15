import { Test, TestingModule } from '@nestjs/testing';
import {
  FindingBulkOperationKind,
  FindingBulkOperationStatus,
  FindingStatus,
  Prisma,
  type FindingBulkOperation,
} from '@prisma/client';

import { CorrelationJobScheduler } from '../correlation/correlation-job-scheduler.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { QueryEmbeddingService } from '../embedding/query-embedding.service';
import { FindingStatsScheduler } from '../stats/finding-stats-scheduler.service';
import { FindingsService } from '../findings.service';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { renderHistory } from '../types/finding-history';
import { HistoryEventType } from '../types/finding-history.types';
import {
  BULK_OPERATION_PAGE_SIZE,
  BULK_UPDATE_SYNC_LIMIT,
  FINDING_BULK_OPERATION_QUEUE,
} from './finding-bulk-operation.constants';
import { FindingBulkOperationService } from './finding-bulk-operation.service';
import { FindingBulkOperationWorker } from './finding-bulk-operation.worker';
import { RetireOutOfScopeService } from './retire-out-of-scope.service';

const operation = (
  over: Partial<FindingBulkOperation> = {},
): FindingBulkOperation => ({
  id: 'op-1',
  kind: FindingBulkOperationKind.STATUS_CHANGE,
  status: FindingBulkOperationStatus.RUNNING,
  filters: { findingType: ['regex:EUID'] },
  target: { status: FindingStatus.RESOLVED, comment: 'EUID is not a key' },
  cursor: null,
  totalEstimate: 37428,
  expectedCount: null,
  processed: 0,
  changed: 0,
  exempted: 0,
  counts: {},
  warnings: [],
  errorMessage: null,
  cancelRequested: false,
  leaseUntil: null,
  startedAt: new Date(),
  finishedAt: null,
  createdBy: 'operator',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  sourceId: 'source-1',
  detectorType: 'CUSTOM',
  customDetectorId: 'det-1',
  customDetectorKey: 'at_company_ids',
  customDetectorName: 'AT company ids',
  findingType: 'regex:EUID',
  matchedContent: 'ATBRA.008316-000',
  ...over,
});

/** The full statement of a mocked tagged $executeRaw, nested fragments included. */
const rawSql = (call: unknown[]) =>
  Prisma.sql(call[0] as TemplateStringsArray, ...call.slice(1));

describe('FindingsService background bulk operations', () => {
  const tx = {
    $executeRaw: jest.fn(),
    customDetectorFeedback: { createMany: jest.fn() },
    findingBulkOperation: { update: jest.fn() },
  };
  const prisma = {
    finding: { findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
    findingBulkOperation: { findUnique: jest.fn() },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    customDetectorFeedback: { createMany: jest.fn() },
  };
  const operations = { create: jest.fn() };
  const correlationJobs = {
    scheduleFull: jest.fn(),
    scheduleAssets: jest.fn(),
  };
  const statsJobs = {
    scheduleFull: jest.fn(),
  };
  let service: FindingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FindingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmbeddingService, useValue: {} },
        { provide: QueryEmbeddingService, useValue: {} },
        { provide: CorrelationJobScheduler, useValue: correlationJobs },
        { provide: FindingStatsScheduler, useValue: statsJobs },
        { provide: FindingBulkOperationService, useValue: operations },
      ],
    }).compile();
    service = module.get(FindingsService);
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn) => fn(tx));
    tx.$executeRaw.mockResolvedValue(0);
    prisma.findingBulkOperation.findUnique.mockResolvedValue({
      cancelRequested: false,
    });
    prisma.finding.findMany.mockResolvedValue([]);
  });

  describe('bulkUpdate hand-off', () => {
    it('queues a selection above the sync limit instead of walking it', async () => {
      prisma.finding.count.mockResolvedValue(BULK_UPDATE_SYNC_LIMIT + 1);
      operations.create.mockResolvedValue(operation({ id: 'op-queued' }));

      const result = await service.bulkUpdate(
        {
          filters: { findingType: ['regex:EUID'] },
          status: FindingStatus.RESOLVED,
          comment: 'EUID is not a key',
        },
        'operator',
      );

      expect(result).toMatchObject({
        operationId: 'op-queued',
        async: true,
        total: BULK_UPDATE_SYNC_LIMIT + 1,
        updatedCount: 0,
      });
      expect(operations.create).toHaveBeenCalledWith({
        kind: FindingBulkOperationKind.STATUS_CHANGE,
        filters: { findingType: ['regex:EUID'] },
        target: { status: 'RESOLVED', comment: 'EUID is not a key' },
        totalEstimate: BULK_UPDATE_SYNC_LIMIT + 1,
        // No dry run preceded this queue, so there is no reviewed count.
        expectedCount: null,
        createdBy: 'operator',
      });
      expect(prisma.finding.findMany).not.toHaveBeenCalled();
      expect(prisma.finding.updateMany).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('still refuses before queueing when more match than expected', async () => {
      prisma.finding.count.mockResolvedValue(686943);

      await expect(
        service.bulkUpdate({
          filters: { findingType: ['regex:EUID'] },
          status: FindingStatus.RESOLVED,
          expectedCount: 37428,
        }),
      ).rejects.toThrow(/686943/);
      expect(operations.create).not.toHaveBeenCalled();
    });

    it('keeps a small selection synchronous', async () => {
      prisma.finding.count.mockResolvedValue(12);
      prisma.finding.updateMany.mockResolvedValue({ count: 12 });

      const result = await service.bulkUpdate({
        filters: { findingType: ['regex:EUID'] },
        status: FindingStatus.RESOLVED,
      });

      expect(result.updatedCount).toBe(12);
      expect(operations.create).not.toHaveBeenCalled();
    });

    it('stores the reviewed count on the queued operation', async () => {
      prisma.finding.count.mockResolvedValue(BULK_UPDATE_SYNC_LIMIT + 1);
      operations.create.mockResolvedValue(operation({ id: 'op-queued' }));

      await service.bulkUpdate(
        {
          filters: { findingType: ['regex:EUID'] },
          status: FindingStatus.RESOLVED,
          expectedCount: BULK_UPDATE_SYNC_LIMIT + 1,
        },
        'operator',
      );

      expect(operations.create).toHaveBeenCalledWith(
        expect.objectContaining({ expectedCount: BULK_UPDATE_SYNC_LIMIT + 1 }),
      );
    });

    it('rejects an invalid status before counting or queueing', async () => {
      prisma.finding.count.mockResolvedValue(BULK_UPDATE_SYNC_LIMIT + 1);

      await expect(
        service.bulkUpdate({
          filters: { findingType: ['regex:EUID'] },
          status: 'RESOLVEDD',
          expectedCount: BULK_UPDATE_SYNC_LIMIT + 1,
        } as never),
      ).rejects.toThrow(/Invalid status/);
      expect(prisma.finding.count).not.toHaveBeenCalled();
      expect(operations.create).not.toHaveBeenCalled();
      expect(prisma.finding.findMany).not.toHaveBeenCalled();
      expect(prisma.finding.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('runBulkOperationChunk', () => {
    const fullPage = (prefix: string) =>
      Array.from({ length: BULK_OPERATION_PAGE_SIZE }, (_, i) =>
        row(`${prefix}${String(i).padStart(5, '0')}`),
      );

    it('changes a page, appends history and moves the cursor in one transaction', async () => {
      prisma.finding.findMany.mockResolvedValueOnce([row('f1'), row('f2')]);
      tx.$executeRaw.mockResolvedValueOnce(2);

      const result = await service.runBulkOperationChunk(operation(), 60_000);

      expect(result).toEqual({ done: true });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const statement = rawSql(tx.$executeRaw.mock.calls[0]);
      expect(statement.sql).toMatch(/status = \?::"FindingStatus"/);
      expect(statement.sql).toMatch(
        /history = COALESCE\(history, '\[\]'::jsonb\) \|\| \?::jsonb/,
      );
      // Rows already at the target are not rewritten.
      expect(statement.sql).toMatch(/status <> \?::"FindingStatus"/);
      const historyArg = statement.values.find(
        (arg: unknown) => typeof arg === 'string' && arg.startsWith('['),
      ) as string;
      expect(renderHistory(JSON.parse(historyArg))[0]).toMatchObject({
        eventType: HistoryEventType.STATUS_CHANGED,
        status: FindingStatus.RESOLVED,
        changeReason: 'EUID is not a key',
      });
      expect(tx.findingBulkOperation.update).toHaveBeenCalledWith({
        where: { id: 'op-1' },
        data: {
          cursor: 'f2',
          processed: { increment: 2 },
          changed: { increment: 2 },
        },
      });
      // Feedback rides the same transaction, so it cannot outlive a rollback.
      expect(tx.customDetectorFeedback.createMany).toHaveBeenCalledTimes(1);
      expect(prisma.customDetectorFeedback.createMany).not.toHaveBeenCalled();
    });

    it('resumes after the stored cursor, by keyset not offset', async () => {
      await service.runBulkOperationChunk(
        operation({ cursor: 'f1999' }),
        60_000,
      );

      const [args] = prisma.finding.findMany.mock.calls[0];
      expect(args.orderBy).toEqual({ id: 'asc' });
      expect(args.take).toBe(BULK_OPERATION_PAGE_SIZE);
      expect(args.where.AND).toContainEqual({ id: { gt: 'f1999' } });
      expect(args.where.AND).toContainEqual({
        status: { not: FindingStatus.RESOLVED },
      });
    });

    it('hands the rest to the next chunk once the budget is spent', async () => {
      prisma.finding.findMany
        .mockResolvedValueOnce(fullPage('a'))
        .mockResolvedValueOnce(fullPage('b'));

      const result = await service.runBulkOperationChunk(operation(), 0);

      expect(result).toEqual({ done: false });
      expect(prisma.finding.findMany).toHaveBeenCalledTimes(1);
    });

    it('stops between pages when a cancel was requested', async () => {
      prisma.finding.findMany
        .mockResolvedValueOnce(fullPage('a'))
        .mockResolvedValueOnce(fullPage('b'));
      prisma.findingBulkOperation.findUnique.mockResolvedValueOnce({
        cancelRequested: true,
      });

      const result = await service.runBulkOperationChunk(operation(), 60_000);

      expect(result).toEqual({ done: true });
      expect(prisma.finding.findMany).toHaveBeenCalledTimes(1);
    });

    it('writes no feedback and no history for a severity-only change', async () => {
      prisma.finding.findMany.mockResolvedValueOnce([row('f1')]);

      await service.runBulkOperationChunk(
        operation({ target: { severity: 'LOW' } }),
        60_000,
      );

      const { sql } = rawSql(tx.$executeRaw.mock.calls[0]);
      expect(sql).toMatch(/severity = \?::"Severity"/);
      expect(sql).not.toMatch(/history/);
      expect(tx.customDetectorFeedback.createMany).not.toHaveBeenCalled();
    });

    it('fails closed when more match than the reviewed count', async () => {
      prisma.finding.count.mockResolvedValue(100);

      await expect(
        service.runBulkOperationChunk(operation({ expectedCount: 10 }), 60_000),
      ).rejects.toThrow(/more than the 10 expected/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('proceeds when the recount is within the reviewed count', async () => {
      prisma.finding.count.mockResolvedValue(2);
      prisma.finding.findMany.mockResolvedValueOnce([row('f1'), row('f2')]);
      tx.$executeRaw.mockResolvedValueOnce(2);

      const result = await service.runBulkOperationChunk(
        operation({ expectedCount: 2 }),
        60_000,
      );

      expect(result).toEqual({ done: true });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('bounds the recount to what the cursor has not examined', async () => {
      prisma.finding.count.mockResolvedValue(7);

      await service.runBulkOperationChunk(
        operation({ cursor: 'f0001', processed: 3, expectedCount: 10 }),
        60_000,
      );

      const [args] = prisma.finding.count.mock.calls[0];
      expect(args.where.AND).toContainEqual({ id: { gt: 'f0001' } });
    });

    it('fails a stored target it does not recognise instead of touching updated_at', async () => {
      await expect(
        service.runBulkOperationChunk(
          operation({ target: { status: 'BOGUS' } }),
          60_000,
        ),
      ).rejects.toThrow(/Invalid bulk operation target/);
      expect(prisma.finding.count).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('fails an empty stored target rather than counting bare rewrites', async () => {
      await expect(
        service.runBulkOperationChunk(operation({ target: {} }), 60_000),
      ).rejects.toThrow(/no status, severity or comment/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('afterBulkOperation', () => {
    it('rebuilds derived state when severity changed too', async () => {
      await service.afterBulkOperation(
        operation({ target: { severity: 'LOW' }, changed: 5 }),
      );

      expect(correlationJobs.scheduleFull).toHaveBeenCalledTimes(1);
      expect(statsJobs.scheduleFull).toHaveBeenCalledTimes(1);
    });

    it('still rebuilds when status changed', async () => {
      await service.afterBulkOperation(operation({ changed: 37428 }));

      expect(correlationJobs.scheduleFull).toHaveBeenCalledTimes(1);
      expect(statsJobs.scheduleFull).toHaveBeenCalledTimes(1);
    });

    it('skips the rebuild when nothing changed', async () => {
      await service.afterBulkOperation(
        operation({ target: { severity: 'LOW' }, changed: 0 }),
      );

      expect(correlationJobs.scheduleFull).not.toHaveBeenCalled();
      expect(statsJobs.scheduleFull).not.toHaveBeenCalled();
    });

    it('tolerates a target that never validated', async () => {
      await service.afterBulkOperation(
        operation({ target: { status: 'BOGUS' }, changed: 3 }),
      );

      expect(correlationJobs.scheduleFull).not.toHaveBeenCalled();
      expect(statsJobs.scheduleFull).not.toHaveBeenCalled();
    });
  });
});

describe('FindingBulkOperationService', () => {
  const prisma = {
    findingBulkOperation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const boss = { createQueue: jest.fn(), send: jest.fn() };
  const pgBoss = { getBossAsync: jest.fn().mockResolvedValue(boss) };
  let service: FindingBulkOperationService;

  beforeEach(() => {
    jest.clearAllMocks();
    pgBoss.getBossAsync.mockResolvedValue(boss);
    service = new FindingBulkOperationService(
      prisma as unknown as PrismaService,
      pgBoss as unknown as PgBossService,
    );
  });

  it('creates the row and queues its first chunk without pg-boss retries', async () => {
    prisma.findingBulkOperation.create.mockResolvedValue(operation());

    await service.create({
      kind: FindingBulkOperationKind.STATUS_CHANGE,
      filters: {},
      target: {},
      totalEstimate: 5000,
    });

    expect(boss.send).toHaveBeenCalledWith(
      FINDING_BULK_OPERATION_QUEUE,
      { operationId: 'op-1' },
      { retryLimit: 0 },
    );
  });

  it('stores the reviewed count for the worker to re-check', async () => {
    prisma.findingBulkOperation.create.mockResolvedValue(operation());

    await service.create({
      kind: FindingBulkOperationKind.STATUS_CHANGE,
      filters: {},
      target: {},
      totalEstimate: 5000,
      expectedCount: 5000,
    });

    expect(prisma.findingBulkOperation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expectedCount: 5000 }),
    });
  });

  it('leaves the reviewed count null when no count was reviewed', async () => {
    prisma.findingBulkOperation.create.mockResolvedValue(operation());

    await service.create({
      kind: FindingBulkOperationKind.STATUS_CHANGE,
      filters: {},
      target: {},
      totalEstimate: 5000,
    });

    expect(prisma.findingBulkOperation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expectedCount: null }),
    });
  });

  it('exposes the reviewed count for operators polling the operation', () => {
    expect(
      service.toDto(operation({ expectedCount: 5000 })).expectedCount,
    ).toBe(5000);
    expect(service.toDto(operation()).expectedCount).toBeNull();
  });

  it('claims only an active operation whose lease is free or expired', async () => {
    prisma.findingBulkOperation.updateMany.mockResolvedValue({ count: 0 });

    expect(await service.claim('op-1')).toBeNull();

    const [args] = prisma.findingBulkOperation.updateMany.mock.calls[0];
    expect(args.where.status).toEqual({
      in: [
        FindingBulkOperationStatus.PENDING,
        FindingBulkOperationStatus.RUNNING,
      ],
    });
    expect(args.where.OR).toEqual([
      { leaseUntil: null },
      { leaseUntil: { lt: expect.any(Date) } },
    ]);
  });

  it('cancels a queued operation outright', async () => {
    prisma.findingBulkOperation.findUnique
      .mockResolvedValueOnce(
        operation({ status: FindingBulkOperationStatus.PENDING }),
      )
      .mockResolvedValueOnce(
        operation({ status: FindingBulkOperationStatus.CANCELLED }),
      );
    prisma.findingBulkOperation.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.requestCancel('op-1');

    expect(result.status).toBe(FindingBulkOperationStatus.CANCELLED);
    expect(prisma.findingBulkOperation.update).not.toHaveBeenCalled();
  });

  it('only flags a running operation, which stops after its current page', async () => {
    prisma.findingBulkOperation.findUnique.mockResolvedValueOnce(operation());
    prisma.findingBulkOperation.update.mockResolvedValue(
      operation({ cancelRequested: true }),
    );

    await service.requestCancel('op-1');

    expect(prisma.findingBulkOperation.update).toHaveBeenCalledWith({
      where: { id: 'op-1' },
      data: { cancelRequested: true },
    });
  });

  it('never reports 100% before completion', () => {
    expect(
      service.toDto(operation({ processed: 37428, totalEstimate: 37428 }))
        .percent,
    ).toBe(99);
    expect(
      service.toDto(
        operation({
          processed: 37428,
          status: FindingBulkOperationStatus.COMPLETED,
        }),
      ).percent,
    ).toBe(100);
  });
});

describe('FindingBulkOperationWorker', () => {
  const operations = {
    claim: jest.fn(),
    finish: jest.fn(),
    get: jest.fn(),
    release: jest.fn(),
    enqueue: jest.fn(),
    recoverInterrupted: jest.fn(),
  };
  const findings = {
    runBulkOperationChunk: jest.fn(),
    afterBulkOperation: jest.fn(),
  };
  const retire = {
    runChunk: jest.fn(),
    afterOperation: jest.fn(),
  };
  let worker: FindingBulkOperationWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    operations.finish.mockResolvedValue(undefined);
    operations.release.mockResolvedValue(undefined);
    operations.enqueue.mockResolvedValue(undefined);
    worker = new FindingBulkOperationWorker(
      {} as PgBossService,
      operations as unknown as FindingBulkOperationService,
      findings as unknown as FindingsService,
      retire as unknown as RetireOutOfScopeService,
    );
  });

  it('does nothing when another handler holds the operation', async () => {
    operations.claim.mockResolvedValue(null);

    await worker.runChunk('op-1');

    expect(findings.runBulkOperationChunk).not.toHaveBeenCalled();
  });

  it('queues the next chunk and gives the lease back when work remains', async () => {
    operations.claim.mockResolvedValue(operation());
    findings.runBulkOperationChunk.mockResolvedValue({ done: false });

    await worker.runChunk('op-1');

    expect(operations.release).toHaveBeenCalledWith('op-1');
    expect(operations.enqueue).toHaveBeenCalledWith('op-1');
    expect(operations.finish).not.toHaveBeenCalled();
  });

  it('completes and rebuilds derived state once, at the end', async () => {
    operations.claim.mockResolvedValue(operation());
    findings.runBulkOperationChunk.mockResolvedValue({ done: true });
    operations.get.mockResolvedValue(operation({ changed: 37428 }));

    await worker.runChunk('op-1');

    expect(operations.finish).toHaveBeenCalledWith(
      'op-1',
      FindingBulkOperationStatus.COMPLETED,
    );
    expect(findings.afterBulkOperation).toHaveBeenCalledTimes(1);
  });

  it('records a cancel that landed during the last chunk', async () => {
    operations.claim.mockResolvedValue(operation());
    findings.runBulkOperationChunk.mockResolvedValue({ done: true });
    operations.get.mockResolvedValue(operation({ cancelRequested: true }));

    await worker.runChunk('op-1');

    expect(operations.finish).toHaveBeenCalledWith(
      'op-1',
      FindingBulkOperationStatus.CANCELLED,
    );
  });

  it('hands a retire to its own walker and its own rebuild', async () => {
    const retireOp = operation({
      kind: FindingBulkOperationKind.RETIRE_OUT_OF_SCOPE,
    });
    operations.claim.mockResolvedValue(retireOp);
    retire.runChunk.mockResolvedValue({ done: true });
    operations.get.mockResolvedValue({ ...retireOp, changed: 5 });

    await worker.runChunk('op-1');

    expect(retire.runChunk).toHaveBeenCalledWith(retireOp, expect.any(Number));
    expect(retire.afterOperation).toHaveBeenCalledTimes(1);
    expect(findings.runBulkOperationChunk).not.toHaveBeenCalled();
    expect(findings.afterBulkOperation).not.toHaveBeenCalled();
  });

  it('fails the operation with the error rather than retrying blind', async () => {
    operations.claim.mockResolvedValue(operation());
    findings.runBulkOperationChunk.mockRejectedValue(new Error('deadlock'));

    await worker.runChunk('op-1');

    expect(operations.finish).toHaveBeenCalledWith(
      'op-1',
      FindingBulkOperationStatus.FAILED,
      'deadlock',
    );
    expect(operations.enqueue).not.toHaveBeenCalled();
  });

  it('rebuilds derived state when a cancel lands before the first chunk', async () => {
    const cancelled = operation({ cancelRequested: true, changed: 4 });
    operations.claim.mockResolvedValue(cancelled);
    operations.finish.mockResolvedValue(cancelled);

    await worker.runChunk('op-1');

    expect(operations.finish).toHaveBeenCalledWith(
      'op-1',
      FindingBulkOperationStatus.CANCELLED,
    );
    expect(findings.runBulkOperationChunk).not.toHaveBeenCalled();
    expect(findings.afterBulkOperation).toHaveBeenCalledWith(cancelled);
  });

  it('rebuilds derived state when the chunk fails', async () => {
    const op = operation({ changed: 4 });
    const failed = operation({
      changed: 4,
      status: FindingBulkOperationStatus.FAILED,
      errorMessage: 'deadlock',
    });
    operations.claim.mockResolvedValue(op);
    findings.runBulkOperationChunk.mockRejectedValue(new Error('deadlock'));
    operations.finish.mockResolvedValue(failed);

    await worker.runChunk('op-1');

    expect(operations.finish).toHaveBeenCalledWith(
      'op-1',
      FindingBulkOperationStatus.FAILED,
      'deadlock',
    );
    expect(findings.afterBulkOperation).toHaveBeenCalledWith(failed);
  });

  it('rebuilds a retire when the chunk fails', async () => {
    const retireOp = operation({
      kind: FindingBulkOperationKind.RETIRE_OUT_OF_SCOPE,
      changed: 2,
    });
    const failed = {
      ...retireOp,
      status: FindingBulkOperationStatus.FAILED,
    };
    operations.claim.mockResolvedValue(retireOp);
    retire.runChunk.mockRejectedValue(new Error('deadlock'));
    operations.finish.mockResolvedValue(failed);

    await worker.runChunk('op-1');

    expect(retire.afterOperation).toHaveBeenCalledWith(failed);
    expect(findings.afterBulkOperation).not.toHaveBeenCalled();
  });
});
