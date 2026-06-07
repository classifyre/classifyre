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
      update: jest.fn(),
      delete: jest.fn(),
    },
    caseEvidence: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    asset: { findMany: jest.fn() },
    finding: { findMany: jest.fn(), findUnique: jest.fn() },
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

  it('creates a case and maps counts', async () => {
    mockPrisma.case.create.mockResolvedValue({
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
      _count: { evidence: 0, hypotheses: 0 },
    });

    const result = await service.create({ title: 'Leak', severity: 'HIGH' as never });
    expect(result.id).toBe('c1');
    expect(result.evidenceCount).toBe(0);
    expect(result.hypothesisCount).toBe(0);
  });

  it('attaches asset evidence and seeds inferred edges', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    mockPrisma.caseEvidence.upsert.mockResolvedValue({
      id: 'ev1',
      caseId: 'c1',
      entityType: 'asset',
      entityId: 'a1',
      note: null,
      addedBy: null,
      createdAt: new Date(),
    });
    mockPrisma.asset.findMany.mockResolvedValue([
      { id: 'a1', name: 'customer.csv', assetType: 'file', sourceType: 'S3_COMPATIBLE_STORAGE' },
    ]);
    mockPrisma.finding.findMany.mockResolvedValue([]);

    const result = await service.addEvidence('c1', {
      entityType: 'asset',
      entityId: 'a1',
    });

    expect(mockGraph.inferEdgesForAsset).toHaveBeenCalledWith('a1');
    expect(result.entity?.label).toBe('customer.csv');
  });

  it('throws when removing evidence not in the case', async () => {
    mockPrisma.caseEvidence.findUnique.mockResolvedValue({
      id: 'ev1',
      caseId: 'other',
    });
    await expect(service.removeEvidence('c1', 'ev1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFound for a missing case on update', async () => {
    mockPrisma.case.findUnique.mockResolvedValue(null);
    await expect(service.update('missing', { title: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
