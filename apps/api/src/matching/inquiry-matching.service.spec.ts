import { Test, TestingModule } from '@nestjs/testing';
import { InquiryMatchingService } from './inquiry-matching.service';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';

describe('InquiryMatchingService', () => {
  let service: InquiryMatchingService;

  const mockPrisma = {
    question: { findMany: jest.fn(), findUnique: jest.fn() },
    finding: { findMany: jest.fn() },
    inquiryMatch: { createMany: jest.fn() },
  };
  const mockPgBoss = {};

  const question = (over: Record<string, unknown> = {}) => ({
    id: 'q1',
    matchAllSources: false,
    sourceIds: ['s1'],
    detectorTypes: [],
    customDetectorKeys: [],
    findingTypes: [],
    findingTypeRegex: [],
    findingValueRegex: [],
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
    mockPrisma.inquiryMatch.createMany.mockResolvedValue({ count: 0 });
  });

  it('does nothing when no active question matches the source', async () => {
    mockPrisma.question.findMany.mockResolvedValue([]);
    const result = await service.processSourceCompletion('s1', 'run-1');
    expect(result.landed).toBe(0);
    expect(mockPrisma.finding.findMany).not.toHaveBeenCalled();
  });

  it('records matches for the run findings (no evidence created)', async () => {
    mockPrisma.question.findMany.mockResolvedValue([question({ findingTypes: ['email'] })]);
    mockPrisma.finding.findMany.mockResolvedValue([
      { id: 'f1', assetId: 'a1', sourceId: 's1', detectorType: 'PII', customDetectorKey: null, findingType: 'email', severity: 'HIGH', matchedContent: 'a@b.com' },
      { id: 'f2', assetId: 'a1', sourceId: 's1', detectorType: 'PII', customDetectorKey: null, findingType: 'ssn', severity: 'HIGH', matchedContent: '...' },
    ]);
    mockPrisma.inquiryMatch.createMany.mockResolvedValue({ count: 1 });

    const result = await service.processSourceCompletion('s1', 'run-1');

    expect(result.landed).toBe(1);
    expect(mockPrisma.finding.findMany.mock.calls[0][0]).toMatchObject({ where: { runnerId: 'run-1', status: 'OPEN' } });
    const data = mockPrisma.inquiryMatch.createMany.mock.calls[0][0].data;
    expect(data).toEqual([{ inquiryId: 'q1', findingId: 'f1' }]);
  });

  it('preview returns total + a capped sample without persisting', async () => {
    mockPrisma.finding.findMany.mockResolvedValue([
      { id: 'f1', assetId: 'a1', sourceId: 's1', detectorType: 'PII', customDetectorKey: null, findingType: 'ssn', severity: 'HIGH', matchedContent: 'x', asset: { name: 'a.csv', sourceType: 'S3_COMPATIBLE_STORAGE' } },
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
    expect(result.sample[0]).toMatchObject({ findingId: 'f1', label: 'ssn', assetName: 'a.csv' });
    expect(mockPrisma.inquiryMatch.createMany).not.toHaveBeenCalled();
  });
});
