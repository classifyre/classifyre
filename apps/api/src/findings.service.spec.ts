import { Test, TestingModule } from '@nestjs/testing';
import { FindingsService } from './findings.service';
import { PrismaService } from './prisma.service';
import { FindingStatus, Severity } from '@prisma/client';
import { HistoryEventType } from './types/finding-history.types';
import { lastEntryOfType, renderHistory } from './types/finding-history';
import { EmbeddingService } from './embedding/embedding.service';
import { QueryEmbeddingService } from './embedding/query-embedding.service';
import { CorrelationJobScheduler } from './correlation/correlation-job-scheduler.service';

describe('FindingsService', () => {
  let service: FindingsService;
  const correlationJobs = {
    scheduleAssets: jest.fn(),
    scheduleFull: jest.fn(),
  };

  const mockPrismaService = {
    finding: {
      findUnique: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    asset: {
      findMany: jest.fn(),
    },
    runner: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FindingsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EmbeddingService,
          useValue: { semanticFindingIds: jest.fn() },
        },
        {
          provide: QueryEmbeddingService,
          useValue: { embed: jest.fn(), embedIfAvailable: jest.fn() },
        },
        { provide: CorrelationJobScheduler, useValue: correlationJobs },
      ],
    }).compile();

    service = module.get<FindingsService>(FindingsService);

    jest.clearAllMocks();
  });

  it('tracks status changes and sets status overrides', async () => {
    const finding = {
      id: 'finding-1',
      assetId: 'asset-1',
      status: FindingStatus.OPEN,
      severity: Severity.LOW,
      history: [],
      runnerId: 'runner-1',
      resolvedAt: null,
      resolutionReason: null,
    } as any;

    mockPrismaService.finding.findUnique.mockResolvedValue(finding);
    mockPrismaService.finding.update.mockResolvedValue({
      ...finding,
      status: FindingStatus.RESOLVED,
    });

    await service.update(
      'finding-1',
      { status: FindingStatus.RESOLVED },
      'user-1',
    );

    const updateCall = mockPrismaService.finding.update.mock.calls[0][0];
    const history = updateCall.data.history;

    expect(updateCall.data.status).toBe(FindingStatus.RESOLVED);
    expect(updateCall.data.resolvedAt).toBeInstanceOf(Date);
    expect(history).toHaveLength(1);
    // Stored compact — `e` is the event code. renderHistory turns it back into
    // the shape the API returns; see types/finding-history.ts.
    expect(history[0].e).toBe('SC');
    expect(renderHistory(history)[0].eventType).toBe(
      HistoryEventType.STATUS_CHANGED,
    );
    expect(correlationJobs.scheduleAssets).toHaveBeenCalledWith(
      ['asset-1'],
      'finding status changed',
    );
  });

  it('tracks severity changes and sets severity overrides', async () => {
    const finding = {
      id: 'finding-2',
      assetId: 'asset-2',
      status: FindingStatus.OPEN,
      severity: Severity.MEDIUM,
      history: [],
      runnerId: 'runner-2',
    } as any;

    mockPrismaService.finding.findUnique.mockResolvedValue(finding);
    mockPrismaService.finding.update.mockResolvedValue({
      ...finding,
      severity: Severity.HIGH,
    });

    await service.update('finding-2', { severity: Severity.HIGH }, 'user-2');

    const updateCall = mockPrismaService.finding.update.mock.calls[0][0];
    const history = updateCall.data.history;

    expect(updateCall.data.severity).toBe(Severity.HIGH);
    expect(history).toHaveLength(1);
    expect(history[0].e).toBe('SV');
    expect(renderHistory(history)[0].eventType).toBe(
      HistoryEventType.SEVERITY_CHANGED,
    );
    expect(correlationJobs.scheduleAssets).not.toHaveBeenCalled();
  });

  it('ranks discovery top assets by severity before total findings', async () => {
    // Dispatch on `by` rather than call order: the live discovery path issues
    // several groupBys in one Promise.all, and keying on position means adding
    // one silently hands another query's rows to the wrong reader.
    mockPrismaService.finding.groupBy.mockImplementation(
      (args: { by: string[] }) => {
        const by = args.by.join(',');
        if (by === 'severity,status') return Promise.resolve([]);
        if (by === 'status')
          return Promise.resolve([
            { status: FindingStatus.OPEN, _count: { _all: 6 } },
            { status: FindingStatus.RESOLVED, _count: { _all: 2 } },
            { status: FindingStatus.FALSE_POSITIVE, _count: { _all: 1 } },
          ]);
        if (by === 'assetId')
          return Promise.resolve([
            {
              assetId: 'asset-low',
              _count: { _all: 5 },
              _max: { detectedAt: new Date('2026-02-20T00:00:00.000Z') },
            },
            {
              assetId: 'asset-critical',
              _count: { _all: 1 },
              _max: { detectedAt: new Date('2026-02-20T00:00:00.000Z') },
            },
          ]);
        if (by === 'assetId,severity')
          return Promise.resolve([
            {
              assetId: 'asset-low',
              severity: Severity.LOW,
              _count: { _all: 5 },
            },
            {
              assetId: 'asset-critical',
              severity: Severity.CRITICAL,
              _count: { _all: 1 },
            },
          ]);
        return Promise.resolve([]);
      },
    );

    mockPrismaService.finding.count.mockResolvedValue(0);
    mockPrismaService.runner.findMany.mockResolvedValue([]);
    mockPrismaService.asset.findMany.mockResolvedValue([
      {
        id: 'asset-low',
        name: 'Low asset',
        hash: null,
        externalUrl: null,
        links: null,
        assetType: 'OTHER',
        source: null,
      },
      {
        id: 'asset-critical',
        name: 'Critical asset',
        hash: null,
        externalUrl: null,
        links: null,
        assetType: 'OTHER',
        source: null,
      },
    ]);

    const result = await service.getDiscoveryOverview({ windowDays: 30 });

    expect(result.topAssets).toHaveLength(2);
    expect(result.topAssets[0]?.assetId).toBe('asset-critical');
    expect(result.topAssets[1]?.assetId).toBe('asset-low');
    // Ranking data survives to the response now; the canvas rail draws a bar
    // from it, and it was already computed to do the sort above.
    expect(result.topAssets[0]?.severityCounts).toEqual({
      critical: 1,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
  });

  // `totals` counts only OPEN findings, so it can never describe review state.
  // statusMix is a second, unfiltered read for exactly that reason — without it
  // the dashboard's resolved and false-positive counts are structurally zero.
  it('counts review state without the open-only filter totals applies', async () => {
    mockPrismaService.finding.groupBy.mockImplementation(
      (args: { by: string[] }) => {
        const by = args.by.join(',');
        if (by === 'status')
          return Promise.resolve([
            { status: FindingStatus.OPEN, _count: { _all: 6 } },
            { status: FindingStatus.RESOLVED, _count: { _all: 2 } },
            { status: FindingStatus.FALSE_POSITIVE, _count: { _all: 1 } },
            { status: FindingStatus.IGNORED, _count: { _all: 3 } },
          ]);
        return Promise.resolve([]);
      },
    );
    mockPrismaService.finding.count.mockResolvedValue(0);
    mockPrismaService.runner.findMany.mockResolvedValue([]);
    mockPrismaService.asset.findMany.mockResolvedValue([]);

    const result = await service.getDiscoveryOverview({ windowDays: 30 });

    expect(result.statusMix).toEqual({
      total: 12,
      open: 6,
      resolved: 2,
      falsePositive: 1,
      ignored: 3,
    });
    // The headline number keeps its open-only meaning.
    expect(result.totals.byStatus.resolved).toBe(0);
  });
});

/**
 * The select-all bulk update, and the manual decision it used to throw away.
 *
 * A filter-mode bulk update takes `updateMany`, which cannot append to a JSONB
 * array — so it wrote no history. `findingHasManualStatusOverride` decides
 * whether a resolution was deliberate by looking for the last STATUS_CHANGED
 * entry, and ingest re-opens a RESOLVED finding it re-detects unless it finds
 * one (`shouldReopen = wasResolved && !statusOverride`). So "select all →
 * resolve" survived exactly until the next scan, silently.
 *
 * Reachable from the findings table and from the `bulk_update_findings` MCP
 * tool, which accepts the same `filters`.
 */ describe('FindingsService bulk update by filter', () => {
  const prisma = {
    finding: { findMany: jest.fn(), updateMany: jest.fn() },
    customDetectorFeedback: { createMany: jest.fn() },
    $executeRaw: jest.fn(),
  };
  let service: FindingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FindingsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: EmbeddingService,
          useValue: { semanticFindingIds: jest.fn() },
        },
        {
          provide: QueryEmbeddingService,
          useValue: { embed: jest.fn(), embedIfAvailable: jest.fn() },
        },
        {
          provide: CorrelationJobScheduler,
          useValue: { scheduleFull: jest.fn(), scheduleAssets: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(FindingsService);
    jest.clearAllMocks();
    prisma.finding.findMany.mockResolvedValue([]);
    prisma.finding.updateMany.mockResolvedValue({ count: 0 });
    prisma.customDetectorFeedback.createMany.mockResolvedValue({ count: 0 });
    prisma.$executeRaw.mockResolvedValue(1);
  });

  /** The SQL text of an $executeRaw call, template strings joined. */
  const rawText = (call: unknown[]) =>
    Array.isArray(call[0]) ? (call[0] as string[]).join('?') : String(call[0]);

  /** A row shaped as the walk's projection returns it. */
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    sourceId: 'source-1',
    detectorType: 'REGEX',
    customDetectorId: null,
    customDetectorKey: null,
    customDetectorName: null,
    findingType: 'regex:AT_FIRMENBUCHNUMMER',
    matchedContent: 'FN 123456a',
    ...over,
  });

  /** A custom-detector row, which is what actually produces a feedback entry. */
  const customRow = (id: string) =>
    row(id, {
      detectorType: 'CUSTOM',
      customDetectorId: 'det-1',
      customDetectorKey: 'insolvenzgefahr',
      customDetectorName: 'Insolvenzgefahr',
      findingType: 'insolvenzgefahr_hoch',
    });

  const bulkResolve = (over: Record<string, unknown> = {}) =>
    service.bulkUpdate({
      filters: { statuses: [FindingStatus.OPEN] },
      status: FindingStatus.RESOLVED,
      ...over,
    } as never);

  it('stamps STATUS_CHANGED on every finding it resolves', async () => {
    prisma.finding.findMany.mockResolvedValueOnce([row('f1'), row('f2')]);
    prisma.finding.updateMany.mockResolvedValue({ count: 2 });

    await bulkResolve({ comment: 'Reviewed as register noise' });

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [call] = prisma.$executeRaw.mock.calls;
    expect(rawText(call)).toMatch(/history\s*\|\|/);
    const stored = JSON.parse(call[1] as string);
    // Compact on the way in, the full shape on the way out.
    expect(stored[0]).toMatchObject({ e: 'SC', s: FindingStatus.RESOLVED });
    expect(renderHistory(stored)[0]).toMatchObject({
      eventType: HistoryEventType.STATUS_CHANGED,
      status: FindingStatus.RESOLVED,
      changeReason: 'Reviewed as register noise',
    });
    // This is what ingest reads to decide the resolution was deliberate.
    // Without it the next scan re-opens all of them.
    expect(
      lastEntryOfType(stored, HistoryEventType.STATUS_CHANGED)?.status,
    ).toBe(FindingStatus.RESOLVED);
    expect(call[2]).toEqual(['f1', 'f2']);
  });

  it('selects the rows before the update takes them out of the filter', async () => {
    prisma.finding.findMany.mockResolvedValueOnce([row('f1')]);

    await bulkResolve();

    // The append has to land before the update, or the filter it selects on no
    // longer matches the rows it is describing.
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.finding.updateMany.mock.invocationCallOrder[0],
    );
    // Only findings whose status is actually changing.
    expect(prisma.finding.findMany.mock.calls[0][0].where.AND[1]).toEqual({
      status: { not: FindingStatus.RESOLVED },
    });
  });

  it('writes no history when only severity changes', async () => {
    await service.bulkUpdate({
      filters: {},
      severity: Severity.LOW,
    });

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.finding.findMany).not.toHaveBeenCalled();
  });

  /**
   * The read this walk replaced had no `take` and no cursor. A select-all
   * resolve over ~607,000 findings materialised every matching row — including
   * `matchedContent` — in one array, which is the shape behind two previous
   * heap OOMs in this codebase.
   */
  describe('is bounded', () => {
    it('takes a bounded page and never reads history', async () => {
      prisma.finding.findMany.mockResolvedValueOnce([row('f1')]);

      await bulkResolve();

      const [args] = prisma.finding.findMany.mock.calls[0];
      expect(args.take).toBe(5000);
      expect(args.orderBy).toEqual({ id: 'asc' });
      // Reading history to append to it is the other half of the same mistake:
      // it averages 368 bytes a row and has no cap. The append is done in SQL.
      expect(args.select).not.toHaveProperty('history');
    });

    it('walks on by keyset cursor when a page comes back full', async () => {
      const full = Array.from({ length: 5000 }, (_, i) => row(`f${i}`));
      prisma.finding.findMany
        .mockResolvedValueOnce(full)
        .mockResolvedValueOnce([row('tail')])
        .mockResolvedValue([]);

      await bulkResolve();

      expect(prisma.finding.findMany).toHaveBeenCalledTimes(2);
      // Second page resumes after the last id of the first, not by offset —
      // OFFSET over a corpus-sized set degrades page by page.
      expect(prisma.finding.findMany.mock.calls[1][0]).toMatchObject({
        skip: 1,
        cursor: { id: 'f4999' },
        take: 5000,
      });
      // One statement per page, not one for the whole walk.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('stops without a further query when a page is short', async () => {
      prisma.finding.findMany.mockResolvedValueOnce([row('f1')]);

      await bulkResolve();

      expect(prisma.finding.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('custom-detector feedback', () => {
    it('records per page rather than once for the whole set', async () => {
      const full = Array.from({ length: 5000 }, (_, i) => customRow(`f${i}`));
      prisma.finding.findMany
        .mockResolvedValueOnce(full)
        .mockResolvedValueOnce([customRow('tail')])
        .mockResolvedValue([]);

      await bulkResolve();

      // Two calls, 5001 rows between them — the same rows one unbounded call
      // would have produced, without ever holding them all.
      expect(prisma.customDetectorFeedback.createMany).toHaveBeenCalledTimes(2);
      const written =
        prisma.customDetectorFeedback.createMany.mock.calls.flatMap(
          ([args]: [{ data: unknown[] }]) => args.data,
        );
      expect(written).toHaveLength(5001);
      expect(written[0]).toMatchObject({
        customDetectorKey: 'insolvenzgefahr',
        findingId: 'f0',
        status: FindingStatus.RESOLVED,
      });
    });

    it('is not recorded for a status that does not solicit it', async () => {
      prisma.finding.findMany.mockResolvedValueOnce([customRow('f1')]);

      await service.bulkUpdate({
        filters: {},
        status: FindingStatus.OPEN,
      });

      // Re-opening is not a judgement about the detector being wrong.
      expect(prisma.customDetectorFeedback.createMany).not.toHaveBeenCalled();
      // The history entry is still written.
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('skips rows that are not custom-detector findings', async () => {
      prisma.finding.findMany.mockResolvedValueOnce([
        row('f1'),
        customRow('f2'),
      ]);

      await bulkResolve();

      const [args] = prisma.customDetectorFeedback.createMany.mock.calls[0];
      expect(args.data.map((r: { findingId: string }) => r.findingId)).toEqual([
        'f2',
      ]);
    });
  });
});
