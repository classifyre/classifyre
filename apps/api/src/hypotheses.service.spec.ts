import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { HypothesesService } from './hypotheses.service';
import { PrismaService } from './prisma.service';

const makeHypRow = (support: object[] = []) => ({
  id: 'h1',
  caseId: 'c1',
  statement: 'Customer PII exported',
  status: 'PROPOSED',
  confidence: '0.40',
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  support,
});

describe('HypothesesService', () => {
  let service: HypothesesService;

  const mockPrisma = {
    hypothesis: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    caseEvidence: { findUnique: jest.fn(), findMany: jest.fn() },
    caseFinding: { findUnique: jest.fn(), findMany: jest.fn() },
    caseHypothesisSupport: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    case: { findUnique: jest.fn() },
    asset: { findMany: jest.fn() },
    finding: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HypothesesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<HypothesesService>(HypothesesService);
    jest.clearAllMocks();
    mockPrisma.asset.findMany.mockResolvedValue([]);
    mockPrisma.caseEvidence.findMany.mockResolvedValue([]);
    mockPrisma.caseFinding.findMany.mockResolvedValue([]);
  });

  it('computes supporting and contradicting counts from support links', async () => {
    const evRow = { id: 'ev1', entityId: 'a1', entityType: 'asset' };
    const cfRow = { id: 'cf1', finding: { findingType: 'Contains PII' } };

    // validateTarget calls
    mockPrisma.caseEvidence.findUnique.mockResolvedValue({ caseId: 'c1' });
    mockPrisma.caseHypothesisSupport.upsert.mockResolvedValue({});
    // hypothesis first findUnique (get caseId)
    mockPrisma.hypothesis.findUnique.mockResolvedValueOnce({ caseId: 'c1' });
    // getOne after link
    mockPrisma.hypothesis.findUnique.mockResolvedValueOnce(
      makeHypRow([
        { id: 'l1', targetType: 'evidence', targetId: 'ev1', stance: 'SUPPORTS', weight: null, note: null },
        { id: 'l2', targetType: 'finding', targetId: 'cf1', stance: 'CONTRADICTS', weight: null, note: null },
      ]),
    );
    mockPrisma.caseEvidence.findMany.mockResolvedValue([evRow]);
    mockPrisma.caseFinding.findMany.mockResolvedValue([cfRow]);
    mockPrisma.asset.findMany.mockResolvedValue([{ id: 'a1', name: 'customer.csv' }]);

    const result = await service.linkSupport('h1', { targetType: 'evidence', targetId: 'ev1' });

    expect(result.supportingCount).toBe(1);
    expect(result.contradictingCount).toBe(1);
    expect(result.confidence).toBe(0.4);
    expect(result.links[0].targetLabel).toBe('customer.csv');
    expect(result.links[1].targetLabel).toBe('Contains PII');
  });

  it('rejects linking evidence from a different case', async () => {
    mockPrisma.hypothesis.findUnique.mockResolvedValue({ caseId: 'c1' });
    mockPrisma.caseEvidence.findUnique.mockResolvedValue({ caseId: 'other' });

    await expect(
      service.linkSupport('h1', { targetType: 'evidence', targetId: 'ev1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects linking a case finding from a different case', async () => {
    mockPrisma.hypothesis.findUnique.mockResolvedValue({ caseId: 'c1' });
    mockPrisma.caseFinding.findUnique.mockResolvedValue({ caseId: 'other' });

    await expect(
      service.linkSupport('h1', { targetType: 'finding', targetId: 'cf1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
