import { BadRequestException } from '@nestjs/common';
import { CaseLeadsService } from './case-leads.service';

describe('CaseLeadsService', () => {
  const lead = {
    id: 'lead-1',
    caseId: 'case-1',
    findingId: 'finding-1',
    assetId: 'asset-1',
    origin: 'INQUIRY',
    status: 'PROPOSED',
    rationale: 'Relevant',
    title: 'email: jane@example.com',
    importance: 0.9,
    similarity: null,
    proposedBy: 'agent',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const prisma = {
    caseLead: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    finding: { findUnique: jest.fn() },
    caseEvidence: { upsert: jest.fn() },
    caseFinding: { createMany: jest.fn(), findMany: jest.fn() },
    caseInquiry: { findMany: jest.fn() },
    case: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const activity = { record: jest.fn() };
  const embeddings = { similarFindings: jest.fn() };
  const matching = { getLiveMatches: jest.fn() };
  const agentMemory = { writeMany: jest.fn() };
  const graph = { inferEdgesForAsset: jest.fn() };
  const service = new CaseLeadsService(
    prisma as never,
    activity as never,
    embeddings as never,
    matching as never,
    agentMemory as never,
    graph as never,
  );

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.caseLead.findUnique.mockResolvedValue({ ...lead });
    prisma.caseLead.updateMany.mockResolvedValue({ count: 1 });
    prisma.finding.findUnique.mockResolvedValue({
      id: 'finding-1',
      status: 'OPEN',
      assetId: 'asset-1',
      findingType: 'email',
      severity: 'HIGH',
      detectorType: 'PII',
      customDetectorName: null,
      matchedContent: 'jane@example.com',
      asset: { name: 'mail.csv', assetType: 'FILE', sourceType: 'S3' },
    });
    prisma.caseEvidence.upsert.mockResolvedValue({ id: 'evidence-1' });
    prisma.caseFinding.createMany.mockResolvedValue({ count: 1 });
    graph.inferEdgesForAsset.mockResolvedValue(undefined);
  });

  it('rejects a reviewed finding in direct proposal paths', async () => {
    prisma.finding.findUnique.mockResolvedValue({
      id: 'finding-1',
      status: 'FALSE_POSITIVE',
      assetId: 'asset-1',
      evidenceAnalysis: null,
    });

    await expect(
      service.propose('case-1', {
        findingId: 'finding-1',
        rationale: 'candidate',
        origin: 'MANUAL',
        proposedBy: 'analyst',
      }),
    ).rejects.toThrow('has already been reviewed');
  });

  it('claims acceptance and attaches evidence in one transaction', async () => {
    const result = await service.review(
      'case-1',
      'lead-1',
      'ACCEPT',
      'analyst',
    );

    expect(result).toEqual({ updated: true, status: 'ACCEPTED' });
    expect(prisma.caseLead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1', caseId: 'case-1', status: 'PROPOSED' },
      }),
    );
    expect(prisma.caseFinding.createMany).toHaveBeenCalled();
    expect(activity.record).toHaveBeenCalledWith(
      'case-1',
      'LEAD_ACCEPTED',
      expect.anything(),
      'analyst',
      prisma,
    );
  });

  it('leaves a stale lead proposed when its finding no longer exists', async () => {
    prisma.finding.findUnique.mockResolvedValue(null);

    await expect(
      service.review('case-1', 'lead-1', 'ACCEPT'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.caseLead.updateMany).not.toHaveBeenCalled();
  });

  it('rejects unknown actions instead of treating them as dismissal', async () => {
    await expect(
      service.review('case-1', 'lead-1', 'TYPO' as never),
    ).rejects.toThrow('action must be ACCEPT or DISMISS');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('excludes reviewed findings from semantic lead generation', async () => {
    prisma.case.findUnique.mockResolvedValue({ id: 'case-1' });
    prisma.caseFinding.findMany
      .mockResolvedValueOnce([{ findingId: 'seed', label: 'seed evidence' }])
      .mockResolvedValueOnce([{ findingId: 'seed' }]);
    prisma.caseLead.findMany.mockResolvedValue([]);
    prisma.caseInquiry.findMany.mockResolvedValue([]);
    embeddings.similarFindings.mockResolvedValue([
      {
        id: 'reviewed',
        status: 'FALSE_POSITIVE',
        similarity: 0.99,
        evidenceAnalysis: { importanceScore: 1 },
      },
      {
        id: 'open',
        status: 'OPEN',
        similarity: 0.9,
        evidenceAnalysis: { importanceScore: 0.8 },
      },
    ]);
    const propose = jest
      .spyOn(service, 'propose')
      .mockResolvedValue({ created: true } as never);

    const result = await service.generate('case-1');

    expect(result).toEqual({ proposed: 1, considered: 1 });
    expect(propose).toHaveBeenCalledWith(
      'case-1',
      expect.objectContaining({ findingId: 'open' }),
    );
  });
});
