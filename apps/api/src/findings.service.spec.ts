import { Test, TestingModule } from '@nestjs/testing';
import { FindingsService } from './findings.service';
import { PrismaService } from './prisma.service';
import { FindingStatus, Severity } from '@prisma/client';
import { HistoryEventType } from './types/finding-history.types';
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
    expect(history[0].eventType).toBe(HistoryEventType.STATUS_CHANGED);
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
    expect(history[0].eventType).toBe(HistoryEventType.SEVERITY_CHANGED);
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
