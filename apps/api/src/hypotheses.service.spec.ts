import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { HypothesesService } from './hypotheses.service';
import { PrismaService } from './prisma.service';

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
    caseEvidence: { findUnique: jest.fn() },
    hypothesisEvidence: {
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
    mockPrisma.finding.findMany.mockResolvedValue([]);
  });

  it('computes supporting and contradicting counts from links', async () => {
    mockPrisma.hypothesis.findUnique.mockResolvedValue({ caseId: 'c1' });
    mockPrisma.caseEvidence.findUnique.mockResolvedValue({ caseId: 'c1' });
    mockPrisma.hypothesisEvidence.upsert.mockResolvedValue({});
    // getOne re-fetch with include
    mockPrisma.hypothesis.findUnique.mockResolvedValueOnce({ caseId: 'c1' });
    mockPrisma.hypothesis.findUnique.mockResolvedValueOnce({
      id: 'h1',
      caseId: 'c1',
      statement: 'Customer PII exported',
      status: 'PROPOSED',
      confidence: '0.40',
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      links: [
        {
          id: 'l1',
          caseEvidenceId: 'ev1',
          stance: 'SUPPORTS',
          weight: null,
          note: null,
          caseEvidence: { entityType: 'asset', entityId: 'a1' },
        },
        {
          id: 'l2',
          caseEvidenceId: 'ev2',
          stance: 'CONTRADICTS',
          weight: null,
          note: null,
          caseEvidence: { entityType: 'finding', entityId: 'f1' },
        },
      ],
    });
    mockPrisma.asset.findMany.mockResolvedValue([{ id: 'a1', name: 'customer.csv' }]);
    mockPrisma.finding.findMany.mockResolvedValue([{ id: 'f1', findingType: 'ssn' }]);

    const result = await service.linkEvidence('h1', { caseEvidenceId: 'ev1' });

    expect(result.supportingCount).toBe(1);
    expect(result.contradictingCount).toBe(1);
    expect(result.confidence).toBe(0.4);
    expect(result.links[0].evidenceLabel).toBe('customer.csv');
    expect(result.links[1].evidenceLabel).toBe('ssn');
  });

  it('rejects linking evidence from a different case', async () => {
    mockPrisma.hypothesis.findUnique.mockResolvedValue({ caseId: 'c1' });
    mockPrisma.caseEvidence.findUnique.mockResolvedValue({ caseId: 'other' });

    await expect(
      service.linkEvidence('h1', { caseEvidenceId: 'ev1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
