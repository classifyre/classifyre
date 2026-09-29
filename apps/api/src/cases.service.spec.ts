import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CasesService } from './cases.service';
import { PrismaService } from './prisma.service';
import { GraphService } from './graph.service';
import { InquiryMatchingService } from './matching/inquiry-matching.service';
import { CaseActivityService } from './case-activity.service';
import { InquiryActivityService } from './inquiry-activity.service';
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
    caseFinding: {
      upsert: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(() => Promise.resolve([])),
      groupBy: jest.fn(() => Promise.resolve([])),
    },
    caseBoardThumbnail: { findMany: jest.fn(() => Promise.resolve([])) },
    caseBoardItem: { findMany: jest.fn(() => Promise.resolve([])) },
    caseFindingFilter: { count: jest.fn(() => Promise.resolve(0)) },
    asset: { findUnique: jest.fn() },
    finding: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const mockGraph = { inferEdgesForAsset: jest.fn(), caseGraph: jest.fn() };
  const mockMatching = { getMatchingFindingIds: jest.fn() };
  const mockActivity = { record: jest.fn(), recordEdit: jest.fn() };
  const mockInquiryActivity = { record: jest.fn(), tryRecord: jest.fn() };
  const mockAgentMemory = {
    recordEntityDeletion: jest.fn(),
    syncEntityMap: jest.fn(),
  };

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
    _count: { evidence: 0, threads: 0, inquiries: 0 },
    removeGoneFindings: false,
    removeResolvedFindings: false,
    removeGoneAssets: false,
    findingFilters: [],
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
        { provide: InquiryActivityService, useValue: mockInquiryActivity },
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
    expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('case', 'c1');
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
        { caseId: 'c1', inquiryId: 'q1', autoPull: false },
        { caseId: 'c1', inquiryId: 'q2', autoPull: false },
      ],
      skipDuplicates: true,
    });
    expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('case', 'c1');
    expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('inquiry', 'q1');
    expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('inquiry', 'q2');
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
      data: [{ caseId: 'c1', inquiryId: 'q9', autoPull: false }],
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
    // One timeline entry for the pull, naming what came in.
    const pulled = mockActivity.record.mock.calls.filter(
      (call) => call[1] === 'INQUIRY_PULLED',
    );
    expect(pulled).toHaveLength(1);
    expect(
      (pulled[0][2] as { findings: Array<{ findingId: string }> }).findings.map(
        (f) => f.findingId,
      ),
    ).toEqual(['f1', 'f2']);
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

    const result = await service.attachFindings('c1', {
      findingIds: ['f1'],
      addedBy: 'genesis-productionisation',
    });
    expect(result.attached).toBe(1);
    // The actor reaches the evidence row the attach creates (field report P14).
    expect(mockPrisma.caseEvidence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          addedBy: 'genesis-productionisation',
        }),
      }),
    );
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
    mockPrisma.caseInquiry.findMany.mockResolvedValue([
      { inquiryId: 'q1' },
      { inquiryId: 'q2' },
    ]);

    const result = await service.close('c1', {
      conclusion: 'It was the wiki.',
    });
    expect(result.archivedInquiries).toBe(1);
    expect(mockPrisma.inquiry.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['q1'] } },
      data: { status: 'ARCHIVED' },
    });
    expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('case', 'c1');
    expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('inquiry', 'q1');
    expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('inquiry', 'q2');
  });

  // An answered case can have standing checks behind it: the non-additivity
  // check catches next year's mismatch only while its inquiry stays active
  // (GENESIS field report P14).
  it('keeps the linked inquiries active when asked to', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({
      ...caseRow({ status: 'CLOSED', conclusion: 'Answered.' }),
      evidence: [],
      inquiryLinks: [],
    });
    mockPrisma.case.update.mockResolvedValue(caseRow({ status: 'CLOSED' }));
    mockPrisma.caseInquiry.findMany.mockResolvedValue([{ inquiryId: 'q1' }]);

    const result = await service.close('c1', {
      conclusion: 'Answered; the checks keep running.',
      keepInquiries: true,
    });

    expect(result.archivedInquiries).toBe(0);
    expect(mockPrisma.inquiry.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.inquiry.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to close a case without a conclusion', async () => {
    mockPrisma.case.findUnique.mockResolvedValue({ id: 'c1' });
    await expect(
      service.close('c1', { conclusion: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockPrisma.case.update).not.toHaveBeenCalled();
  });

  it('reopens a case and reactivates the inquiries archived with it', async () => {
    mockPrisma.case.findUnique
      // ensureExists
      .mockResolvedValueOnce({ id: 'c1' })
      // findOne at the end
      .mockResolvedValueOnce({
        ...caseRow({ status: 'OPEN' }),
        evidence: [],
        inquiryLinks: [],
      });
    mockPrisma.case.update.mockResolvedValue(caseRow({ status: 'OPEN' }));
    mockPrisma.inquiry.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.caseInquiry.findMany.mockResolvedValue([
      { inquiryId: 'q1' },
      { inquiryId: 'q2' },
    ]);

    const result = await service.reopen('c1', { note: 'It recurred.' });

    expect(result.reactivatedInquiries).toBe(2);
    expect(mockPrisma.case.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'OPEN' },
    });
    expect(mockPrisma.inquiry.updateMany).toHaveBeenCalledWith({
      where: { status: 'ARCHIVED', caseLinks: { some: { caseId: 'c1' } } },
      data: { status: 'ACTIVE' },
    });
    expect(mockActivity.record).toHaveBeenCalled();
    expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('case', 'c1');
    expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('inquiry', 'q1');
    expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('inquiry', 'q2');
  });

  describe('list', () => {
    beforeEach(() => {
      mockPrisma.case.findMany.mockResolvedValue([
        caseRow({ id: 'c1' }),
        caseRow({ id: 'c2' }),
      ]);
      mockPrisma.case.count.mockResolvedValue(2);
    });

    it('narrows to, and leaves out, cases by id', async () => {
      await service.list({ ids: ['c1', 'c2'], excludeIds: 'c3' as never });
      const where = mockPrisma.case.findMany.mock.calls[0][0].where;
      expect(where.id).toEqual({ in: ['c1', 'c2'], notIn: ['c3'] });
      expect(mockPrisma.case.count).toHaveBeenCalledWith({ where });
    });

    it('drops id values that are not ids', async () => {
      await service.list({ ids: [{ evil: 1 }, '', 'c1'] as never });
      const where = mockPrisma.case.findMany.mock.calls[0][0].where;
      expect(where.id).toEqual({ in: ['c1'] });
    });

    it('adds finding counts, new watch matches and the board sketch for cards', async () => {
      mockPrisma.caseFinding.groupBy.mockResolvedValue([
        { caseId: 'c1', _count: { _all: 12 } },
      ]);
      mockPrisma.caseInquiry.findMany.mockResolvedValue([
        { caseId: 'c1', inquiry: { newMatchCount: 3 } },
        { caseId: 'c1', inquiry: { newMatchCount: 2 } },
        { caseId: 'c2', inquiry: { newMatchCount: 0 } },
      ]);
      const updatedAt = new Date('2026-09-29T10:00:00Z');
      const sketch = { v: 1, w: 10, h: 10, nodes: [], edges: [] };
      mockPrisma.caseBoardThumbnail.findMany.mockResolvedValue([
        { sketch, updatedAt, board: { caseId: 'c2' } },
      ]);

      const result = await service.list({ withCardDetails: 'true' as never });

      expect(result.items[0]).toMatchObject({
        id: 'c1',
        findingCount: 12,
        newMatchCount: 5,
        thumbnail: null,
      });
      expect(result.items[1]).toMatchObject({
        id: 'c2',
        findingCount: 0,
        newMatchCount: 0,
        thumbnail: { sketch, updatedAt },
      });
    });

    it('leaves card details out unless asked', async () => {
      const result = await service.list({});
      expect(result.items[0]).not.toHaveProperty('thumbnail');
      expect(mockPrisma.caseBoardThumbnail.findMany).not.toHaveBeenCalled();
    });
  });

  it('throws NotFound for a missing case on update', async () => {
    mockPrisma.case.findUnique.mockResolvedValue(null);
    await expect(
      service.update('missing', { title: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('update timeline (the case file autosaves)', () => {
    const stored = caseRow({ aiMode: 'INHERIT' });
    const patch = async (dto: Record<string, unknown>) => {
      mockPrisma.case.findUnique.mockResolvedValue(stored);
      mockPrisma.case.update.mockResolvedValue({ ...stored, ...dto });
      await service.update('c1', dto, 'maria');
    };

    it('folds edits of the case description into one entry per stretch', async () => {
      await patch({ title: 'Renamed', description: 'Wider scope' });
      expect(mockActivity.recordEdit).toHaveBeenCalledTimes(1);
      const [caseId, type, payload, actor, key, merge] =
        mockActivity.recordEdit.mock.calls[0];
      expect([caseId, type, actor, key]).toEqual([
        'c1',
        'CASE_UPDATED',
        'maria',
        'details',
      ]);
      expect(payload).toMatchObject({
        fields: ['title', 'description'],
        title: 'Renamed',
        previousTitle: 'Customer data exposure',
      });
      // A later save adds its fields; the title it started from stays.
      expect(
        merge(payload, { fields: ['severity'], previousTitle: 'Renamed' }),
      ).toMatchObject({
        fields: ['title', 'description', 'severity'],
        previousTitle: 'Customer data exposure',
      });
      expect(mockActivity.record).not.toHaveBeenCalled();
      expect(mockAgentMemory.syncEntityMap).toHaveBeenCalledWith('case', 'c1');
    });

    it('writes nothing for a field sent back unchanged', async () => {
      await patch({ title: stored.title, assignee: '' });
      expect(mockActivity.recordEdit).not.toHaveBeenCalled();
      expect(mockActivity.record).not.toHaveBeenCalled();
      expect(mockAgentMemory.syncEntityMap).not.toHaveBeenCalled();
    });

    it('keeps a status change as its own entry', async () => {
      await patch({ status: 'IN_PROGRESS' });
      expect(mockActivity.record).toHaveBeenCalledWith(
        'c1',
        'CASE_UPDATED',
        { status: 'IN_PROGRESS', previousStatus: 'OPEN' },
        'maria',
      );
      expect(mockActivity.recordEdit).not.toHaveBeenCalled();
    });

    it('folds conclusion drafts and leaves the entity map alone', async () => {
      await patch({ conclusion: 'Draft one' });
      expect(mockActivity.recordEdit).toHaveBeenCalledWith(
        'c1',
        'CONCLUSION_UPDATED',
        { draft: true, length: 9 },
        'maria',
        'conclusion',
        expect.any(Function),
      );
      expect(mockAgentMemory.syncEntityMap).not.toHaveBeenCalled();
    });
  });
});
