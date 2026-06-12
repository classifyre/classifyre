import { Test, TestingModule } from '@nestjs/testing';
import { InquiryMatchingService } from './inquiry-matching.service';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';

describe('InquiryMatchingService', () => {
  let service: InquiryMatchingService;

  const mockPrisma = {
    inquiry: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    finding: { findMany: jest.fn() },
  };
  const mockPgBoss = {};

  const inquiry = (over: Record<string, unknown> = {}) => ({
    id: 'q1',
    matchAllSources: false,
    sourceIds: ['s1'],
    detectorTypes: [],
    customDetectorKeys: [],
    findingTypes: [],
    findingTypeRegex: [],
    findingValueRegex: [],
    matchCount: 0,
    ...over,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InquiryMatchingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PgBossService, useValue: mockPgBoss },
      ],
    }).compile();
    service = module.get(InquiryMatchingService);
    jest.clearAllMocks();
    mockPrisma.inquiry.update.mockResolvedValue({});
  });

  it('does nothing when no active inquiry matches the source', async () => {
    mockPrisma.inquiry.findMany.mockResolvedValue([]);
    const result = await service.processSourceCompletion('s1', 'run-1');
    expect(result.landed).toBe(0);
    expect(mockPrisma.finding.findMany).not.toHaveBeenCalled();
  });

  it('increments newMatchCount by hits from the run and refreshes matchCount', async () => {
    mockPrisma.inquiry.findMany.mockResolvedValue([
      inquiry({ findingTypes: ['email'] }),
    ]);
    // First call: run's new findings. Second call: all OPEN findings for matchCount recompute.
    mockPrisma.finding.findMany
      .mockResolvedValueOnce([
        {
          id: 'f1',
          assetId: 'a1',
          sourceId: 's1',
          detectorType: 'PII',
          customDetectorKey: null,
          findingType: 'email',
          severity: 'HIGH',
          matchedContent: 'a@b.com',
        },
        {
          id: 'f2',
          assetId: 'a1',
          sourceId: 's1',
          detectorType: 'PII',
          customDetectorKey: null,
          findingType: 'ssn',
          severity: 'HIGH',
          matchedContent: '...',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'f1',
          assetId: 'a1',
          sourceId: 's1',
          detectorType: 'PII',
          customDetectorKey: null,
          findingType: 'email',
          severity: 'HIGH',
          matchedContent: 'a@b.com',
        },
      ]);

    const result = await service.processSourceCompletion('s1', 'run-1');

    expect(result.landed).toBe(1);
    expect(mockPrisma.inquiry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q1' },
        data: expect.objectContaining({
          matchCount: 1,
          newMatchCount: { increment: 1 },
        }),
      }),
    );
  });

  it('resets newMatchCount to 0 on rematch', async () => {
    mockPrisma.inquiry.findUnique.mockResolvedValue(inquiry());
    mockPrisma.finding.findMany.mockResolvedValue([
      {
        id: 'f1',
        assetId: 'a1',
        sourceId: 's1',
        detectorType: 'PII',
        customDetectorKey: null,
        findingType: 'email',
        severity: 'HIGH',
        matchedContent: 'x',
      },
    ]);

    await service.rematchInquiry('q1');

    expect(mockPrisma.inquiry.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { matchCount: 1, newMatchCount: 0 },
    });
  });

  it('preview returns total + a capped sample without persisting', async () => {
    mockPrisma.finding.findMany.mockResolvedValue([
      {
        id: 'f1',
        assetId: 'a1',
        sourceId: 's1',
        detectorType: 'PII',
        customDetectorKey: null,
        findingType: 'ssn',
        severity: 'HIGH',
        matchedContent: 'x',
        createdAt: new Date(),
        asset: { name: 'a.csv', sourceType: 'S3_COMPATIBLE_STORAGE' },
      },
    ]);
    const result = await service.preview({
      matchAllSources: true,
      sourceIds: [],
      detectorTypes: [],
      customDetectorKeys: [],
      findingTypes: ['ssn'],
      findingTypeRegex: [],
      findingValueRegex: [],
    });
    expect(result.total).toBe(1);
    expect(result.sample[0]).toMatchObject({
      findingId: 'f1',
      label: 'ssn',
      assetName: 'a.csv',
    });
    expect(mockPrisma.inquiry.update).not.toHaveBeenCalled();
  });
});
