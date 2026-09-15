import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  DetectorType,
  FindingBulkOperationKind,
  FindingBulkOperationStatus,
  Prisma,
  type FindingBulkOperation,
} from '@prisma/client';

import type { CorrelationJobScheduler } from '../correlation/correlation-job-scheduler.service';
import type { InquiryMatchingService } from '../matching/inquiry-matching.service';
import type { PrismaService } from '../prisma.service';
import type { FindingStatsScheduler } from '../stats/finding-stats-scheduler.service';
import { RETIRE_SCAN_BLOCKS } from './finding-bulk-operation.constants';
import type { FindingBulkOperationService } from './finding-bulk-operation.service';
import { buildRetirePlan, type CandidateRow } from './retire-out-of-scope.plan';
import {
  RetireOutOfScopeService,
  type RetireCounts,
} from './retire-out-of-scope.service';

const DETECTOR = {
  id: 'det-1',
  key: 'at_company_ids',
  name: 'AT company ids',
  version: 2,
  pipelineSchema: {
    type: 'REGEX',
    scope: { asset_kinds: ['record', 'document'] },
    patterns: { LEI: {}, AT_FIRMENBUCHNUMMER: {} },
  },
};
const PLAN = buildRetirePlan(DETECTOR);

const row = (id: string, over: Partial<CandidateRow> = {}): CandidateRow => ({
  id,
  sourceId: 'src-register',
  detectorType: DetectorType.CUSTOM,
  findingType: 'regex:AT_FIRMENBUCHNUMMER',
  customDetectorKey: 'at_company_ids',
  matchedContent: 'FN 123456a',
  assetKind: 'page',
  ...over,
});

const op = (
  over: Partial<FindingBulkOperation> = {},
): FindingBulkOperation => ({
  id: 'op-dry',
  kind: FindingBulkOperationKind.RETIRE_OUT_OF_SCOPE,
  status: FindingBulkOperationStatus.RUNNING,
  filters: { mode: 'dry_run', plan: PLAN } as unknown as Prisma.JsonValue,
  target: {},
  cursor: null,
  totalEstimate: 0,
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
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const completedDryRun = (counts: Partial<RetireCounts>, over = {}) =>
  op({
    status: FindingBulkOperationStatus.COMPLETED,
    finishedAt: new Date(Date.now() - 60_000),
    counts: counts as unknown as Prisma.JsonValue,
    ...over,
  });

/** Which raw statement a `$queryRaw` call is, from its SQL text. */
function sqlText(first: unknown): string {
  if (Array.isArray(first)) return first.join('?');
  // A composed Prisma.sql fragment: `Sql` is a type here, not a class to test.
  if (first && typeof first === 'object' && 'sql' in first) {
    return String(first.sql);
  }
  return String(first);
}

describe('RetireOutOfScopeService', () => {
  let prisma: {
    customDetector: { findUnique: jest.Mock };
    findingBulkOperation: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    inquiry: { findMany: jest.Mock };
    customDetectorFeedback: { createMany: jest.Mock };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let operations: { create: jest.Mock; get: jest.Mock };
  let inquiryMatching: { processSourceCompletion: jest.Mock };
  let correlationJobs: { scheduleFull: jest.Mock };
  let statsJobs: { scheduleFull: jest.Mock };
  let service: RetireOutOfScopeService;

  /** Candidate pages by starting block; `relationBlocks` blocks in the table. */
  let pages: Map<number, CandidateRow[]>;
  let relationBlocks: number;
  let citedIds: string[];

  beforeEach(() => {
    pages = new Map();
    relationBlocks = RETIRE_SCAN_BLOCKS;
    citedIds = [];
    prisma = {
      customDetector: { findUnique: jest.fn().mockResolvedValue(DETECTOR) },
      findingBulkOperation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ cancelRequested: false }),
        update: jest.fn().mockResolvedValue({}),
      },
      inquiry: { findMany: jest.fn().mockResolvedValue([]) },
      customDetectorFeedback: { createMany: jest.fn() },
      $queryRaw: jest.fn((first: unknown, ...values: unknown[]) => {
        const text = sqlText(first);
        if (text.includes('pg_relation_size')) {
          return Promise.resolve([{ blocks: relationBlocks }]);
        }
        if (text.includes('case_findings')) {
          const ids = values[0] as string[];
          return Promise.resolve(
            citedIds
              .filter((id) => ids.includes(id))
              .map((findingId) => ({ findingId })),
          );
        }
        if (text.includes('f.ctid >=')) {
          const from = Number(
            /\((\d+),0\)/.exec(String((first as Prisma.Sql).values[0]))?.[1],
          );
          return Promise.resolve(pages.get(from) ?? []);
        }
        return Promise.resolve([]);
      }),
      $executeRaw: jest.fn((_strings: unknown, ...values: unknown[]) =>
        Promise.resolve((values.find(Array.isArray) as string[]).length),
      ),
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
    };
    operations = {
      create: jest.fn((input: Record<string, unknown>) =>
        Promise.resolve(op({ id: 'op-new', ...input })),
      ),
      get: jest.fn(),
    };
    inquiryMatching = {
      processSourceCompletion: jest.fn().mockResolvedValue({ landed: 0 }),
    };
    correlationJobs = { scheduleFull: jest.fn().mockResolvedValue(true) };
    statsJobs = { scheduleFull: jest.fn().mockResolvedValue(undefined) };
    service = new RetireOutOfScopeService(
      prisma as unknown as PrismaService,
      operations as unknown as FindingBulkOperationService,
      inquiryMatching as unknown as InquiryMatchingService,
      correlationJobs as unknown as CorrelationJobScheduler,
      statsJobs as unknown as FindingStatsScheduler,
    );
  });

  describe('startDryRun', () => {
    it('queues a walk carrying the plan and empty counts', async () => {
      await service.startDryRun('det-1', { sourceIds: ['src-register'] });

      expect(operations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: FindingBulkOperationKind.RETIRE_OUT_OF_SCOPE,
          filters: {
            mode: 'dry_run',
            plan: expect.objectContaining({
              customDetectorKey: 'at_company_ids',
              detectorVersion: 2,
              sourceIds: ['src-register'],
            }),
          },
          counts: expect.objectContaining({ candidates: 0, wouldRetire: 0 }),
        }),
      );
    });

    it('404s an unknown detector and 400s a malformed source list', async () => {
      prisma.customDetector.findUnique.mockResolvedValueOnce(null);
      await expect(service.startDryRun('nope', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.startDryRun('det-1', { sourceIds: 'src-register' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('startRetire', () => {
    const reviewed = { wouldRetire: 37, wouldRetireIncludingWatched: 99 };
    const valid = {
      fromOperationId: 'op-dry',
      expectedCount: 37,
      confirm: true,
    };
    const operator = { allowInquiryOverride: true };

    beforeEach(() => {
      operations.get.mockResolvedValue(completedDryRun(reviewed));
    });

    it('carries out a reviewed dry run, capped at what it reported', async () => {
      await service.startRetire('det-1', valid, operator);

      expect(operations.create).toHaveBeenCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({
            mode: 'retire',
            fromOperationId: 'op-dry',
            includeInquiryWatched: false,
          }),
          target: { status: 'RESOLVED', cap: 37 },
        }),
      );
    });

    it('caps an operator override at the watched-inclusive count', async () => {
      await service.startRetire(
        'det-1',
        { ...valid, expectedCount: 99, includeInquiryWatched: true },
        operator,
      );

      expect(operations.create).toHaveBeenCalledWith(
        expect.objectContaining({ target: { status: 'RESOLVED', cap: 99 } }),
      );
    });

    it('refuses the inquiry override to a caller that may not make it', async () => {
      await expect(
        service.startRetire(
          'det-1',
          { ...valid, expectedCount: 99, includeInquiryWatched: true },
          { allowInquiryOverride: false },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(operations.create).not.toHaveBeenCalled();
    });

    it.each([
      ['no dry run', { ...valid, fromOperationId: undefined }],
      ['no confirmation', { ...valid, confirm: undefined }],
    ])('400s a retire with %s', async (_label, input) => {
      await expect(
        service.startRetire('det-1', input, operator),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('409s when the caller reviewed a different number', async () => {
      await expect(
        service.startRetire('det-1', { ...valid, expectedCount: 36 }, operator),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('409s when the detector changed after the dry run', async () => {
      prisma.customDetector.findUnique.mockResolvedValue({
        ...DETECTOR,
        version: 3,
      });
      await expect(
        service.startRetire('det-1', valid, operator),
      ).rejects.toThrow(/changed after the dry run/);
    });

    it('409s a dry run that did not complete, or is a day old', async () => {
      operations.get.mockResolvedValueOnce(
        completedDryRun(reviewed, {
          status: FindingBulkOperationStatus.CANCELLED,
        }),
      );
      await expect(
        service.startRetire('det-1', valid, operator),
      ).rejects.toBeInstanceOf(ConflictException);

      operations.get.mockResolvedValueOnce(
        completedDryRun(reviewed, {
          finishedAt: new Date(Date.now() - 25 * 60 * 60_000),
        }),
      );
      await expect(
        service.startRetire('det-1', valid, operator),
      ).rejects.toThrow(/24 hours/);
    });

    it('400s a dry run of another detector', async () => {
      await expect(
        service.startRetire('det-other', valid, operator),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets one dry run authorize exactly one retire', async () => {
      prisma.findingBulkOperation.findFirst.mockResolvedValue({
        id: 'op-earlier',
        status: FindingBulkOperationStatus.COMPLETED,
      });
      await expect(
        service.startRetire('det-1', valid, operator),
      ).rejects.toThrow(/already used/);
    });

    it('is blocked by a retire already running, not by a dry run', async () => {
      await service.startRetire('det-1', valid, operator);
      const where =
        prisma.findingBulkOperation.findFirst.mock.calls[0][0].where;
      expect(where.OR[1]).toEqual({
        status: { in: ['PENDING', 'RUNNING'] },
        AND: [
          { filters: { path: ['mode'], equals: 'retire' } },
          { filters: { path: ['plan', 'detectorId'], equals: 'det-1' } },
        ],
      });

      prisma.findingBulkOperation.findFirst.mockResolvedValue({
        id: 'op-running',
        status: FindingBulkOperationStatus.RUNNING,
      });
      await expect(
        service.startRetire('det-1', valid, operator),
      ).rejects.toThrow(/already running/);
    });

    it('400s when there is nothing to retire', async () => {
      operations.get.mockResolvedValue(
        completedDryRun({ wouldRetire: 0, wouldRetireIncludingWatched: 0 }),
      );
      await expect(
        service.startRetire('det-1', { ...valid, expectedCount: 0 }, operator),
      ).rejects.toThrow(/nothing to retire/);
    });
  });

  describe('runChunk', () => {
    const watchingInquiry = {
      id: 'inq-unmonitored',
      title: 'Unmonitored Firmenbuch Number Findings',
      matchAllSources: true,
      sourceIds: [],
      detectorTypes: [],
      customDetectorKeys: ['at_company_ids'],
      findingTypes: ['regex:AT_FIRMENBUCHNUMMER'],
      findingTypeRegex: [],
      findingValueRegex: [],
    };

    beforeEach(() => {
      pages.set(0, [
        row('f-cited'),
        row('f-watched'),
        row('f-euid', { findingType: 'regex:EUID', assetKind: 'record' }),
        row('f-table', { findingType: 'regex:LEI', assetKind: 'table' }),
      ]);
      citedIds = ['f-cited'];
      prisma.inquiry.findMany.mockResolvedValue([watchingInquiry]);
    });

    const lastCounts = (): RetireCounts =>
      prisma.findingBulkOperation.update.mock.calls.at(-1)[0].data.counts;

    it('dry run: counts reasons and exemptions, writes nothing', async () => {
      const result = await service.runChunk(op(), 60_000);

      expect(result).toEqual({ done: true });
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(lastCounts()).toMatchObject({
        scan: {
          blocksScanned: RETIRE_SCAN_BLOCKS,
          blocksTotal: RETIRE_SCAN_BLOCKS,
        },
        candidates: 4,
        byReason: {
          'asset_kind:page': 2,
          'pattern_removed:EUID': 1,
          'asset_kind:table': 1,
        },
        citedByCase: 1,
        watchedByInquiries: 1,
        inquiries: [
          {
            id: 'inq-unmonitored',
            title: 'Unmonitored Firmenbuch Number Findings',
            count: 1,
          },
        ],
        wouldRetire: 2,
        wouldRetireIncludingWatched: 3,
        sampleIds: ['f-euid', 'f-table'],
      });
    });

    const retireOp = (includeInquiryWatched: boolean, cap: number) =>
      op({
        id: 'op-retire',
        filters: {
          mode: 'retire',
          plan: PLAN,
          fromOperationId: 'op-dry',
          includeInquiryWatched,
        } as unknown as Prisma.JsonValue,
        target: { status: 'RESOLVED', cap },
      });

    /** The finding ids each retire UPDATE was given. */
    const retiredIds = () =>
      prisma.$executeRaw.mock.calls.flatMap(
        // Past the template strings, which are an array too.
        (call: unknown[]) => call.slice(1).find(Array.isArray) as string[],
      );

    it('retire: resolves only unexempted findings, as RESOLVED, with no feedback', async () => {
      await service.runChunk(retireOp(false, 2), 60_000);

      expect(retiredIds().sort()).toEqual(['f-euid', 'f-table']);
      const [strings, ...values] = prisma.$executeRaw.mock.calls[0];
      expect((strings as string[]).join('?')).toContain(
        `AND status = 'OPEN'::"FindingStatus"`,
      );
      const entry = JSON.parse(
        values.find(
          (value: unknown) =>
            typeof value === 'string' && value.startsWith('[{'),
        ) as string,
      )[0];
      // RESOLVED, not STATUS_CHANGED: not a manual override, so widening the
      // scope again lets re-detection reopen the finding.
      expect(entry).toMatchObject({ e: 'R', s: 'RESOLVED' });
      expect(prisma.customDetectorFeedback.createMany).not.toHaveBeenCalled();
      const pageWrite = prisma.findingBulkOperation.update.mock.calls
        .map((call: [{ data: Record<string, unknown> }]) => call[0].data)
        .find((data: Record<string, unknown>) => 'changed' in data);
      expect(pageWrite).toMatchObject({
        changed: { increment: 2 },
        exempted: { increment: 2 },
        cursor: String(RETIRE_SCAN_BLOCKS),
      });
    });

    it('retire with the operator override still never touches cited evidence', async () => {
      await service.runChunk(retireOp(true, 3), 60_000);

      expect(retiredIds().sort()).toEqual(['f-euid', 'f-table', 'f-watched']);
    });

    it('stops at the reviewed count even when more became retirable', async () => {
      const result = await service.runChunk(retireOp(false, 1), 60_000);

      expect(result).toEqual({ done: true });
      expect(retiredIds()).toHaveLength(1);
      expect(lastCounts().capReached).toBe(true);
    });

    it('walks every block range, including blocks appended mid-walk', async () => {
      relationBlocks = RETIRE_SCAN_BLOCKS * 2;
      pages.set(RETIRE_SCAN_BLOCKS, [
        row('f-later', { findingType: 'regex:EUID', assetKind: 'record' }),
      ]);

      await service.runChunk(op(), 60_000);

      expect(lastCounts()).toMatchObject({
        candidates: 5,
        wouldRetire: 3,
        scan: { blocksScanned: RETIRE_SCAN_BLOCKS * 2 },
      });
    });

    it('resumes from its cursor rather than rescanning', async () => {
      relationBlocks = RETIRE_SCAN_BLOCKS * 2;

      await service.runChunk(
        op({ cursor: String(RETIRE_SCAN_BLOCKS) }),
        60_000,
      );

      const pageCalls = prisma.$queryRaw.mock.calls.filter((call: unknown[]) =>
        sqlText(call[0]).includes('f.ctid >='),
      );
      expect(pageCalls).toHaveLength(1);
      expect((pageCalls[0][0] as Prisma.Sql).values[0]).toBe(
        `(${RETIRE_SCAN_BLOCKS},0)`,
      );
    });

    it('fails rather than walk on when the detector changed underneath it', async () => {
      prisma.customDetector.findUnique.mockResolvedValue({
        key: 'at_company_ids',
        version: 3,
      });

      await expect(service.runChunk(op(), 60_000)).rejects.toThrow(
        /changed while this operation ran/,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('skips the walk for an unscoped non-REGEX detector with no stale regex findings', async () => {
      const llmPlan = buildRetirePlan({
        ...DETECTOR,
        pipelineSchema: { type: 'LLM' },
      });
      prisma.customDetector.findUnique.mockResolvedValue(DETECTOR);

      const result = await service.runChunk(
        op({
          filters: {
            mode: 'dry_run',
            plan: llmPlan,
          } as unknown as Prisma.JsonValue,
        }),
        60_000,
      );

      expect(result).toEqual({ done: true });
      expect(
        prisma.$queryRaw.mock.calls.some((call: unknown[]) =>
          sqlText(call[0]).includes('f.ctid >='),
        ),
      ).toBe(false);
    });
  });

  describe('afterOperation', () => {
    it('rebuilds derived state once after a retire that changed something', async () => {
      await service.afterOperation(
        op({
          filters: {
            mode: 'retire',
            plan: PLAN,
            includeInquiryWatched: false,
          } as unknown as Prisma.JsonValue,
          changed: 5,
          counts: { bySource: { 'src-register': 7 } },
        }),
      );

      expect(correlationJobs.scheduleFull).toHaveBeenCalledTimes(1);
      expect(statsJobs.scheduleFull).toHaveBeenCalledTimes(1);
      // No watched finding changed, so no inquiry count can have moved.
      expect(inquiryMatching.processSourceCompletion).not.toHaveBeenCalled();
    });

    it('refreshes inquiry counts only when the override was used', async () => {
      await service.afterOperation(
        op({
          filters: {
            mode: 'retire',
            plan: PLAN,
            includeInquiryWatched: true,
          } as unknown as Prisma.JsonValue,
          changed: 5,
          counts: { bySource: { 'src-register': 7 } },
        }),
      );

      expect(inquiryMatching.processSourceCompletion).toHaveBeenCalledWith(
        'src-register',
        null,
      );
    });

    it('does nothing after a dry run', async () => {
      await service.afterOperation(op({ changed: 0 }));

      expect(correlationJobs.scheduleFull).not.toHaveBeenCalled();
    });
  });
});
