import { Test, TestingModule } from '@nestjs/testing';
import { FindingsService } from './findings.service';
import { PrismaService } from './prisma.service';
import { FindingStatus, Severity } from '@prisma/client';
import { HistoryEventType } from './types/finding-history.types';

describe('FindingsService', () => {
  let service: FindingsService;

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
      ],
    }).compile();

    service = module.get<FindingsService>(FindingsService);

    jest.clearAllMocks();
  });

  it('tracks status changes and sets status overrides', async () => {
    const finding = {
      id: 'finding-1',
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
  });

  it('tracks severity changes and sets severity overrides', async () => {
    const finding = {
      id: 'finding-2',
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
  });

  it('ranks discovery top assets by severity before total findings', async () => {
    mockPrismaService.finding.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([
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
  });
});
