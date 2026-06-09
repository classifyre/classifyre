import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CasesService } from './cases.service';
import { PrismaService } from './prisma.service';
import { GraphService } from './graph.service';

describe('CasesService', () => {
  let service: CasesService;

  const mockPrisma = {
    case: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    inquiry: { updateMany: jest.fn(), findUnique: jest.fn() },
    caseEvidence: { upsert: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), delete: jest.fn() },
    caseFinding: { upsert: jest.fn(), createMany: jest.fn() },
    hypothesis: { findMany: jest.fn() },
    hypothesisSupport: { createMany: jest.fn() },
    asset: { findUnique: jest.fn() },
    finding: { findUnique: jest.fn(), findMany: jest.fn() },
    inquiryMatch: { findMany: jest.fn() },
  };
  const mockGraph = { inferEdgesForAsset: jest.fn(), caseGraph: jest.fn() };

  const caseRow = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    title: 'Customer data exposure',
    description: null,
    status: 'OPEN',
    severity: 'HIGH',
    assignee: null,
    createdBy: null,
    conclusion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { evidence: 0, hypotheses: 0, inquiries: 0 },
    ...over,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CasesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: GraphService, useValue: mockGraph },
      ],
    }).compile();
    service = module.get(CasesService);
    jest.clearAllMocks();
  });

  it('creates a case', async () => {
    mockPrisma.case.create.mockResolvedValue(caseRow());
    const result = await service.create({ title: 'Customer data exposure', severity: 'HIGH' as never });
    expect(result.id).toBe('c1');
    expect(mockPrisma.inquiry.updateMany).not.toHaveBeenCalled();
  });

  it('links inquiries when created with inquiryIds', async () => {
    mockPrisma.case.create.mockResolvedValue(caseRow());
    mockPrisma.case.findUnique.mockResolvedValue({ ...caseRow(), evidence: [], inquiries: [] });
    await service.create({ title: 'Case', inquiryIds: ['q1', 'q2'] });
    expect(mockPrisma.inquiry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['q1', 'q2'] } },
      data: { caseId: 'c1' },
    });
  });

  it('attaches asset evidence and seeds edges', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    mockPrisma.asset.findUnique.mockResolvedValue({ name: 'customer.csv', assetType: 'file', sourceType: 'S3_COMPATIBLE_STORAGE' });
    const ev = { id: 'ev1', caseId: 'c1', entityType: 'asset', entityId: 'a1', label: 'customer.csv', assetType: 'file', sourceType: 'S3_COMPATIBLE_STORAGE', note: null, addedBy: null, createdAt: new Date(), findings: [] };
    mockPrisma.caseEvidence.upsert.mockResolvedValue(ev);
    mockPrisma.caseEvidence.findUniqueOrThrow.mockResolvedValue(ev);

    const result = await service.addEvidence('c1', { entityType: 'asset', entityId: 'a1' });
    expect(mockGraph.inferEdgesForAsset).toHaveBeenCalledWith('a1');
    expect(result.entity?.label).toBe('customer.csv');
  });

  it('rejects finding evidence', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    await expect(service.addEvidence('c1', { entityType: 'finding', entityId: 'f1' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("pulls an inquiry's matches into the case as evidence + findings", async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    mockPrisma.inquiry.findUnique.mockResolvedValue({ id: 'q1' });
    mockPrisma.inquiryMatch.findMany.mockResolvedValue([{ findingId: 'f1' }, { findingId: 'f2' }]);
    mockPrisma.finding.findMany.mockResolvedValue([
      { id: 'f1', assetId: 'a1', findingType: 'ssn', severity: 'HIGH', detectorType: 'PII', matchedContent: 'x', asset: { name: 'a.csv', assetType: 'file', sourceType: 'S3_COMPATIBLE_STORAGE' } },
      { id: 'f2', assetId: 'a1', findingType: 'email', severity: 'LOW', detectorType: 'PII', matchedContent: 'y', asset: { name: 'a.csv', assetType: 'file', sourceType: 'S3_COMPATIBLE_STORAGE' } },
    ]);
    mockPrisma.caseEvidence.upsert.mockResolvedValue({ id: 'ev1' });
    mockPrisma.caseFinding.createMany.mockResolvedValue({ count: 2 });

    const result = await service.pullFromInquiry('c1', { inquiryId: 'q1' });
    expect(result.pulled).toBe(2);
    // One evidence row for the shared asset, two finding rows.
    expect(mockPrisma.caseEvidence.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.caseFinding.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it('throws NotFound for a missing case on update', async () => {
    mockPrisma.case.findUnique.mockResolvedValue(null);
    await expect(service.update('missing', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
