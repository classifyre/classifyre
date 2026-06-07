import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CasesService } from './cases.service';
import { PrismaService } from './prisma.service';
import { GraphService } from './graph.service';

describe('CasesService', () => {
  let service: CasesService;

  const mockPrisma = {
    case: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    hypothesis: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    caseHypothesisSupport: {
      createMany: jest.fn(),
    },
    caseEvidence: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      delete: jest.fn(),
    },
    caseFinding: {
      createMany: jest.fn(),
    },
    asset: { findMany: jest.fn() },
    finding: { findMany: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const mockGraph = {
    inferEdgesForAsset: jest.fn(),
    caseGraph: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CasesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GraphService, useValue: mockGraph },
      ],
    }).compile();
    service = module.get<CasesService>(CasesService);
    jest.clearAllMocks();
  });

  it('creates a case atomically with an initial hypothesis', async () => {
    const caseRow = {
      id: 'c1',
      title: 'Leak',
      description: null,
      status: 'OPEN',
      severity: 'HIGH',
      assignee: null,
      createdBy: null,
      conclusion: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { evidence: 0, hypotheses: 1 },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockPrisma) => Promise<typeof caseRow>) =>
      cb(mockPrisma),
    );
    mockPrisma.case.create.mockResolvedValue(caseRow);
    mockPrisma.hypothesis.create.mockResolvedValue({});
    mockPrisma.case.findUniqueOrThrow.mockResolvedValue(caseRow);

    const result = await service.create({ title: 'Leak', hypothesis: 'Data was exfiltrated', severity: 'HIGH' as never });
    expect(result.id).toBe('c1');
    expect(result.hypothesisCount).toBe(1);
    expect(mockPrisma.hypothesis.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statement: 'Data was exfiltrated' }) }),
    );
  });

  it('attaches asset evidence and seeds inferred edges', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    const evidenceRow = {
      id: 'ev1',
      caseId: 'c1',
      entityType: 'asset',
      entityId: 'a1',
      note: null,
      addedBy: null,
      createdAt: new Date(),
      findings: [],
    };
    mockPrisma.caseEvidence.upsert.mockResolvedValue(evidenceRow);
    mockPrisma.caseEvidence.findUniqueOrThrow.mockResolvedValue(evidenceRow);
    mockPrisma.hypothesis.findMany.mockResolvedValue([{ id: 'h1' }]);
    mockPrisma.caseHypothesisSupport.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.finding.findMany.mockResolvedValue([]);
    mockPrisma.caseFinding.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.asset.findMany.mockResolvedValue([
      { id: 'a1', name: 'customer.csv', assetType: 'file', sourceType: 'S3_COMPATIBLE_STORAGE' },
    ]);

    const result = await service.addEvidence('c1', {
      entityType: 'asset',
      entityId: 'a1',
      hypothesisIds: ['h1'],
    });

    expect(mockGraph.inferEdgesForAsset).toHaveBeenCalledWith('a1');
    expect(result.entity?.label).toBe('customer.csv');
  });

  it('rejects finding evidence (only assets allowed)', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    const { BadRequestException } = await import('@nestjs/common');
    await expect(
      service.addEvidence('c1', { entityType: 'finding', entityId: 'f1', hypothesisIds: ['h1'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects evidence without a hypothesis', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    const { BadRequestException } = await import('@nestjs/common');
    await expect(
      service.addEvidence('c1', { entityType: 'asset', entityId: 'a1', hypothesisIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when removing evidence not in the case', async () => {
    mockPrisma.caseEvidence.findUnique.mockResolvedValue({ id: 'ev1', caseId: 'other' });
    await expect(service.removeEvidence('c1', 'ev1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFound for a missing case on update', async () => {
    mockPrisma.case.findUnique.mockResolvedValue(null);
    await expect(service.update('missing', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
