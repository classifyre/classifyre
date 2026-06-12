import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CasesService } from './cases.service';
import { PrismaService } from './prisma.service';
import { GraphService } from './graph.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';
import { CaseActivityService } from './case-activity.service';
import { AgentMemoryService } from './autopilot/memory/agent-memory.service';

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
    inquiry: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
    caseInquiry: {
      createMany: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    caseEvidence: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      delete: jest.fn(),
    },
    caseFinding: { upsert: jest.fn(), createMany: jest.fn() },
    hypothesis: { findMany: jest.fn() },
    hypothesisSupport: { createMany: jest.fn() },
    asset: { findUnique: jest.fn() },
    finding: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const mockGraph = { inferEdgesForAsset: jest.fn(), caseGraph: jest.fn() };
  const mockMatching = { getMatchingFindingIds: jest.fn() };
  const mockActivity = { record: jest.fn() };
  const mockAgentMemory = { recordEntityDeletion: jest.fn() };

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
        { provide: InquiryMatchingService, useValue: mockMatching },
        { provide: CaseActivityService, useValue: mockActivity },
        { provide: AgentMemoryService, useValue: mockAgentMemory },
      ],
    }).compile();
    service = module.get(CasesService);
    jest.clearAllMocks();
  });

  it('creates a case', async () => {
    mockPrisma.case.create.mockResolvedValue(caseRow());
    const result = await service.create({
      title: 'Customer data exposure',
      severity: 'HIGH',
    });
    expect(result.id).toBe('c1');
    expect(mockPrisma.inquiry.updateMany).not.toHaveBeenCalled();
  });

  it('links inquiries when created with inquiryIds (m2m join rows)', async () => {
    mockPrisma.case.create.mockResolvedValue(caseRow());
    mockPrisma.inquiry.findMany.mockResolvedValue([
      { id: 'q1', title: 'Q1' },
      { id: 'q2', title: 'Q2' },
    ]);
    mockPrisma.case.findUnique.mockResolvedValue({
      ...caseRow(),
      evidence: [],
      inquiryLinks: [],
    });
    await service.create({ title: 'Case', inquiryIds: ['q1', 'q2'] });
    expect(mockPrisma.caseInquiry.createMany).toHaveBeenCalledWith({
      data: [
        { caseId: 'c1', inquiryId: 'q1' },
        { caseId: 'c1', inquiryId: 'q2' },
      ],
      skipDuplicates: true,
    });
  });

  it('links additional inquiries to an existing case', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({
      ...caseRow(),
      evidence: [],
      inquiryLinks: [],
    });
    mockPrisma.inquiry.findMany.mockResolvedValue([
      { id: 'q9', title: 'Extra' },
    ]);
    mockPrisma.caseInquiry.findMany.mockResolvedValue([]);
    await service.linkInquiries('c1', { inquiryIds: ['q9'] });
    expect(mockPrisma.caseInquiry.createMany).toHaveBeenCalledWith({
      data: [{ caseId: 'c1', inquiryId: 'q9' }],
      skipDuplicates: true,
    });
  });

  it('unlinks an inquiry without touching the inquiry row', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({
      ...caseRow(),
      evidence: [],
      inquiryLinks: [],
    });
    mockPrisma.caseInquiry.findUnique.mockResolvedValue({
      id: 'link1',
      inquiry: { title: 'Q' },
    });
    await service.unlinkInquiry('c1', 'q1');
    expect(mockPrisma.caseInquiry.delete).toHaveBeenCalledWith({
      where: { id: 'link1' },
    });
    expect(mockPrisma.inquiry.delete).not.toHaveBeenCalled();
  });

  it('rejects creating a case with unknown inquiries', async () => {
    mockPrisma.inquiry.findMany.mockResolvedValue([]);
    await expect(
      service.create({ title: 'Case', inquiryIds: ['ghost'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('attaches asset evidence and seeds edges', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    mockPrisma.asset.findUnique.mockResolvedValue({
      name: 'customer.csv',
      assetType: 'file',
      sourceType: 'S3_COMPATIBLE_STORAGE',
    });
    const ev = {
      id: 'ev1',
      caseId: 'c1',
      entityType: 'asset',
      entityId: 'a1',
      label: 'customer.csv',
      assetType: 'file',
      sourceType: 'S3_COMPATIBLE_STORAGE',
      note: null,
      addedBy: null,
      createdAt: new Date(),
      findings: [],
    };
    mockPrisma.caseEvidence.upsert.mockResolvedValue(ev);
    mockPrisma.caseEvidence.findUniqueOrThrow.mockResolvedValue(ev);

    const result = await service.addEvidence('c1', {
      entityType: 'asset',
      entityId: 'a1',
    });
    expect(mockGraph.inferEdgesForAsset).toHaveBeenCalledWith('a1');
    expect(result.entity?.label).toBe('customer.csv');
  });

  it('rejects finding evidence', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    await expect(
      service.addEvidence('c1', { entityType: 'finding', entityId: 'f1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("pulls an inquiry's live matches into the case as evidence + findings", async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    mockPrisma.inquiry.findUnique.mockResolvedValue({ id: 'q1' });
    mockMatching.getMatchingFindingIds.mockResolvedValue(['f1', 'f2']);
    mockPrisma.finding.findMany.mockResolvedValue([
      {
        id: 'f1',
        assetId: 'a1',
        findingType: 'ssn',
        severity: 'HIGH',
        detectorType: 'PII',
        matchedContent: 'x',
        asset: {
          name: 'a.csv',
          assetType: 'file',
          sourceType: 'S3_COMPATIBLE_STORAGE',
        },
      },
      {
        id: 'f2',
        assetId: 'a1',
        findingType: 'email',
        severity: 'LOW',
        detectorType: 'PII',
        matchedContent: 'y',
        asset: {
          name: 'a.csv',
          assetType: 'file',
          sourceType: 'S3_COMPATIBLE_STORAGE',
        },
      },
    ]);
    mockPrisma.caseEvidence.upsert.mockResolvedValue({ id: 'ev1' });
    mockPrisma.caseFinding.createMany.mockResolvedValue({ count: 2 });

    const result = await service.pullFromInquiry('c1', { inquiryId: 'q1' });
    expect(result.pulled).toBe(2);
    // One evidence row for the shared asset, two finding rows.
    expect(mockPrisma.caseEvidence.upsert).toHaveBeenCalledTimes(1);
    expect(
      mockPrisma.caseFinding.createMany.mock.calls[0][0].data,
    ).toHaveLength(2);
  });

  it('batch-attaches findings, creating asset evidence as needed', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    mockPrisma.finding.findMany.mockResolvedValue([
      {
        id: 'f1',
        assetId: 'a1',
        findingType: 'ssn',
        severity: 'HIGH',
        detectorType: 'PII',
        customDetectorName: null,
        matchedContent: 'x',
        asset: {
          name: 'a.csv',
          assetType: 'file',
          sourceType: 'S3_COMPATIBLE_STORAGE',
        },
      },
    ]);
    mockPrisma.caseEvidence.upsert.mockResolvedValue({ id: 'ev1' });
    mockPrisma.caseFinding.createMany.mockResolvedValue({ count: 1 });

    const result = await service.attachFindings('c1', { findingIds: ['f1'] });
    expect(result.attached).toBe(1);
    expect(mockGraph.inferEdgesForAsset).toHaveBeenCalledWith('a1');
  });

  it('closes a case and archives only inquiries with no other open case', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({
      ...caseRow({ status: 'CLOSED', conclusion: 'It was the wiki.' }),
      evidence: [],
      inquiryLinks: [],
    });
    mockPrisma.case.update.mockResolvedValue(caseRow({ status: 'CLOSED' }));
    mockPrisma.inquiry.findMany.mockResolvedValue([
      // only linked to this case → archivable
      { id: 'q1', caseLinks: [{ case: { id: 'c1', status: 'CLOSED' } }] },
      // also drives an open case → must stay active
      {
        id: 'q2',
        caseLinks: [
          { case: { id: 'c1', status: 'CLOSED' } },
          { case: { id: 'c2', status: 'OPEN' } },
        ],
      },
    ]);
    mockPrisma.inquiry.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.close('c1', {
      conclusion: 'It was the wiki.',
    });
    expect(result.archivedInquiries).toBe(1);
    expect(mockPrisma.inquiry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['q1'] } },
      data: { status: 'ARCHIVED' },
    });
  });

  it('refuses to close a case without a conclusion', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    await expect(
      service.close('c1', { conclusion: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.case.update).not.toHaveBeenCalled();
  });

  it('throws NotFound for a missing case on update', async () => {
    mockPrisma.case.findUnique.mockResolvedValue(null);
    await expect(
      service.update('missing', { title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
