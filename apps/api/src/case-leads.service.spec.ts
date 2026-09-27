import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
    viaFindingId: null,
    viaAssetId: null,
    viaInquiryId: null,
    details: null,
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
      deleteMany: jest.fn(),
      createManyAndReturn: jest.fn(),
    },
    finding: { findUnique: jest.fn(), findMany: jest.fn() },
    asset: { findUnique: jest.fn(), findMany: jest.fn() },
    caseEvidence: { upsert: jest.fn(), findMany: jest.fn() },
    caseFinding: { createMany: jest.fn(), findMany: jest.fn() },
    caseInquiry: { findMany: jest.fn() },
    case: { findUnique: jest.fn() },
    edge: { findMany: jest.fn() },
    correlationPairVerdict: { findMany: jest.fn(), updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const activity = { record: jest.fn(), recordCoalesced: jest.fn() };
  const embeddings = { similarFindings: jest.fn() };
  const matching = { getLiveMatches: jest.fn() };
  const agentMemory = { writeMany: jest.fn() };
  const graph = { inferEdgesForAsset: jest.fn() };
  const escalation = { escalateArrivals: jest.fn() };
  const duplicates = { isEnabled: jest.fn() };
  const service = new CaseLeadsService(
    prisma as never,
    activity as never,
    embeddings as never,
    matching as never,
    agentMemory as never,
    graph as never,
    undefined,
    escalation as never,
    duplicates as never,
  );

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.caseLead.findUnique.mockResolvedValue({ ...lead });
    prisma.caseLead.updateMany.mockResolvedValue({ count: 1 });
    prisma.caseLead.findMany.mockResolvedValue([]);
    prisma.caseLead.createManyAndReturn.mockImplementation(
      ({ data }: { data: Array<{ origin: string; title: string }> }) =>
        Promise.resolve(
          data.map((d) => ({ origin: d.origin, title: d.title })),
        ),
    );
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
    prisma.finding.findMany.mockResolvedValue([]);
    prisma.asset.findMany.mockResolvedValue([]);
    prisma.caseEvidence.upsert.mockResolvedValue({ id: 'evidence-1' });
    prisma.caseEvidence.findMany.mockResolvedValue([]);
    prisma.caseFinding.createMany.mockResolvedValue({ count: 1 });
    prisma.caseFinding.findMany.mockResolvedValue([]);
    prisma.caseInquiry.findMany.mockResolvedValue([]);
    prisma.case.findUnique.mockResolvedValue({ id: 'case-1', status: 'OPEN' });
    prisma.edge.findMany.mockResolvedValue([]);
    prisma.correlationPairVerdict.findMany.mockResolvedValue([]);
    prisma.correlationPairVerdict.updateMany.mockResolvedValue({ count: 1 });
    prisma.$queryRaw.mockResolvedValue([]);
    graph.inferEdgesForAsset.mockResolvedValue(undefined);
    duplicates.isEnabled.mockResolvedValue(true);
    embeddings.similarFindings.mockResolvedValue([]);
  });

  describe('review', () => {
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

    it('runs the escalation rules over a finding a lead brought in', async () => {
      prisma.caseFinding.findMany.mockResolvedValue([
        {
          id: 'cf-1',
          findingId: 'finding-1',
          label: 'email',
          matchedContent: 'jane@example.com',
          severity: 'HIGH',
          escalatedAt: null,
          caseEvidence: { entityId: 'asset-1', label: 'mail.csv' },
        },
      ]);

      await service.review('case-1', 'lead-1', 'ACCEPT', 'analyst');

      expect(escalation.escalateArrivals).toHaveBeenCalledWith(
        'case-1',
        null,
        [expect.objectContaining({ findingId: 'finding-1' })],
        { trigger: 'ATTACHED', actor: 'analyst' },
      );
    });

    it('does not escalate a finding that was in the case already', async () => {
      prisma.caseFinding.createMany.mockResolvedValue({ count: 0 });

      await service.review('case-1', 'lead-1', 'ACCEPT', 'analyst');

      expect(escalation.escalateArrivals).not.toHaveBeenCalled();
    });

    it('accepts a look-alike document by adding the asset, and marks its confirmed verdict used', async () => {
      prisma.caseLead.findUnique.mockResolvedValue({
        ...lead,
        findingId: null,
        assetId: 'copy-9',
        viaAssetId: 'asset-1',
        origin: 'DUPLICATE',
        title: 'copy.pdf',
      });
      prisma.asset.findUnique.mockResolvedValue({
        id: 'copy-9',
        name: 'copy.pdf',
        assetType: 'FILE',
        sourceType: 'S3',
      });

      const result = await service.review('case-1', 'lead-1', 'ACCEPT', 'ana');

      expect(result).toEqual({ updated: true, status: 'ACCEPTED' });
      expect(prisma.caseEvidence.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            entityType: 'asset',
            entityId: 'copy-9',
            label: 'copy.pdf',
          }),
        }),
      );
      expect(prisma.caseFinding.createMany).not.toHaveBeenCalled();
      expect(graph.inferEdgesForAsset).toHaveBeenCalledWith('copy-9');
      // Stored in canonical order, like the edges the pair came from.
      expect(prisma.correlationPairVerdict.updateMany).toHaveBeenCalledWith({
        where: {
          aId: 'asset-1',
          bId: 'copy-9',
          verdict: 'CONFIRMED',
          caseId: null,
        },
        data: { caseId: 'case-1' },
      });
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

    it('reviews many leads and counts the ones that could not be', async () => {
      const review = jest
        .spyOn(service, 'review')
        .mockResolvedValueOnce({ updated: true, status: 'DISMISSED' } as never)
        .mockRejectedValueOnce(new BadRequestException('gone'));

      const result = await service.reviewMany(
        'case-1',
        ['a', 'b', 'a'],
        'DISMISS',
        'ana',
      );

      expect(review).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ updated: 1, failed: 1 });
    });
  });

  describe('generate', () => {
    const seed = {
      id: 'seed',
      findingType: 'IBAN',
      matchedContent: 'DE89 3704 0044 0532 0130 00',
      assetId: 'asset-1',
      asset: { name: 'invoice.pdf' },
    };

    it('passes quietly over a deleted case when automatic, and says so when asked', async () => {
      prisma.case.findUnique.mockResolvedValue(null);

      await expect(
        service.generate('case-1', 'case-leads', { automatic: true }),
      ).resolves.toEqual(expect.objectContaining({ proposed: 0 }));
      await expect(service.generate('case-1')).rejects.toThrow('not found');
    });

    it('suggests nothing for a closed case', async () => {
      prisma.case.findUnique.mockResolvedValue({
        id: 'case-1',
        status: 'CLOSED',
      });

      const result = await service.generate('case-1');

      expect(result.proposed).toBe(0);
      expect(prisma.caseLead.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('proposes open neighbours of the evidence and says when a value is the same', async () => {
      prisma.$queryRaw.mockResolvedValue([{ finding_id: 'seed' }]);
      prisma.finding.findMany.mockResolvedValue([seed]);
      prisma.caseFinding.findMany.mockResolvedValue([{ findingId: 'seed' }]);
      embeddings.similarFindings.mockResolvedValue([
        {
          id: 'reviewed',
          status: 'FALSE_POSITIVE',
          similarity: 0.99,
          findingType: 'IBAN',
          matchedContent: 'x',
          assetId: 'a2',
          evidenceAnalysis: { importanceScore: 1 },
        },
        {
          id: 'same',
          status: 'OPEN',
          similarity: 0.97,
          findingType: 'IBAN',
          // Case and spacing aside, the very value of the seed.
          matchedContent: ' de89 3704  0044 0532 0130 00',
          assetId: 'a3',
          evidenceAnalysis: { importanceScore: 0.5 },
        },
        {
          id: 'similar',
          status: 'OPEN',
          similarity: 0.81,
          findingType: 'IBAN',
          matchedContent: 'GB29 NWBK 6016 1331 9268 19',
          assetId: 'a4',
          evidenceAnalysis: { importanceScore: 0.8 },
        },
      ]);

      const result = await service.generate('case-1', 'ana');

      const data = prisma.caseLead.createManyAndReturn.mock.calls[0][0].data;
      expect(data.map((d: { findingId: string }) => d.findingId)).toEqual([
        'same',
        'similar',
      ]);
      expect(data[0]).toEqual(
        expect.objectContaining({
          origin: 'SEMANTIC_NEIGHBOR',
          viaFindingId: 'seed',
          viaAssetId: 'asset-1',
          details: { sameValue: true },
          rationale: 'Same IBAN value as the evidence in "invoice.pdf"',
        }),
      );
      expect(data[1].rationale).toContain('81% similar to');
      expect(result).toEqual(
        expect.objectContaining({
          proposed: 2,
          byOrigin: { SEMANTIC_NEIGHBOR: 2 },
        }),
      );
    });

    it('stops asking for neighbours once embeddings turn out to be off', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { finding_id: 'seed' },
        { finding_id: 'seed-2' },
      ]);
      prisma.finding.findMany.mockResolvedValue([
        seed,
        { ...seed, id: 'seed-2' },
      ]);
      embeddings.similarFindings.mockRejectedValue(
        new ServiceUnavailableException('off'),
      );

      await service.generate('case-1');

      expect(embeddings.similarFindings).toHaveBeenCalledTimes(1);
    });

    it('proposes look-alike documents, skipping pairs rejected in Duplicate review', async () => {
      prisma.caseEvidence.findMany.mockResolvedValue([
        { entityId: 'asset-1', label: 'invoice.pdf' },
      ]);
      prisma.edge.findMany.mockResolvedValue([
        {
          fromType: 'asset',
          fromId: 'asset-1',
          toType: 'asset',
          toId: 'rejected',
          relationType: 'identical_content',
          confidence: 1,
          metadata: null,
        },
        {
          fromType: 'asset',
          fromId: 'look-alike',
          toType: 'asset',
          toId: 'asset-1',
          relationType: 'likely_duplicate',
          confidence: 0.72,
          metadata: { sharedByLabel: { EMAIL: 1, IBAN: 3 } },
        },
      ]);
      prisma.correlationPairVerdict.findMany.mockResolvedValue([
        {
          aId: 'asset-1',
          bId: 'rejected',
          verdict: 'REJECTED',
          scoreAtVerdict: 1,
        },
        {
          aId: 'asset-1',
          bId: 'confirmed',
          verdict: 'CONFIRMED',
          scoreAtVerdict: 0.4,
        },
      ]);
      prisma.asset.findMany.mockResolvedValue([
        { id: 'look-alike', name: 'invoice (1).pdf' },
        { id: 'confirmed', name: 'scan.pdf' },
      ]);

      await service.generate('case-1');

      const data = prisma.caseLead.createManyAndReturn.mock.calls[0][0].data;
      expect(
        data.map((d: { assetId: string; findingId: string | null }) => [
          d.assetId,
          d.findingId,
        ]),
      ).toEqual([
        ['confirmed', null],
        ['look-alike', null],
      ]);
      expect(data[0]).toEqual(
        expect.objectContaining({
          origin: 'DUPLICATE',
          viaAssetId: 'asset-1',
          details: { relation: 'confirmed', verdict: 'CONFIRMED' },
        }),
      );
      expect(data[1].rationale).toBe(
        'Shares IBAN, EMAIL with "invoice.pdf" · match weight 72%',
      );
    });

    it('skips look-alikes while duplicate detection is off', async () => {
      duplicates.isEnabled.mockResolvedValue(false);
      prisma.caseEvidence.findMany.mockResolvedValue([
        { entityId: 'asset-1', label: 'invoice.pdf' },
      ]);

      await service.generate('case-1');

      expect(prisma.edge.findMany).not.toHaveBeenCalled();
    });

    it('settles waiting leads already in the case and removes gone ones', async () => {
      prisma.caseLead.findMany.mockResolvedValueOnce([
        { id: 'in-case', findingId: 'f-in', assetId: 'a', origin: 'INQUIRY' },
        {
          id: 'resolved',
          findingId: 'f-res',
          assetId: 'a',
          origin: 'SEMANTIC_NEIGHBOR',
        },
        { id: 'bookmark', findingId: 'f-res', assetId: 'a', origin: 'MANUAL' },
        {
          id: 'deleted-doc',
          findingId: null,
          assetId: 'gone',
          origin: 'DUPLICATE',
        },
      ]);
      prisma.finding.findMany.mockResolvedValueOnce([
        { id: 'f-in', status: 'OPEN', findingType: 't', matchedContent: 'v' },
        {
          id: 'f-res',
          status: 'RESOLVED',
          findingType: 't',
          matchedContent: 'v',
        },
      ]);
      prisma.caseFinding.findMany.mockResolvedValueOnce([
        { findingId: 'f-in' },
      ]);

      const result = await service.generate('case-1');

      expect(prisma.caseLead.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['in-case'] }, status: 'PROPOSED' },
        data: expect.objectContaining({
          status: 'ACCEPTED',
          reviewedBy: 'case-leads',
        }),
      });
      // A person's bookmark of a resolved finding stays; resolved evidence is
      // still evidence.
      expect(prisma.caseLead.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['resolved', 'deleted-doc'] }, status: 'PROPOSED' },
      });
      expect(result.settled).toBe(3);
    });

    it('proposes nothing more once the case holds too many waiting leads', async () => {
      const waiting = Array.from({ length: 60 }, (_, i) => ({
        findingId: `f-${i}`,
        assetId: 'a',
        status: 'PROPOSED',
      }));
      prisma.caseLead.findMany
        .mockResolvedValueOnce([]) // settle
        .mockResolvedValueOnce(waiting);

      const result = await service.generate('case-1');

      expect(result.full).toBe(true);
      expect(prisma.caseLead.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('folds automatic refreshes into one timeline entry', async () => {
      prisma.caseInquiry.findMany.mockResolvedValue([
        { inquiryId: 'q-1', inquiry: { title: 'Payments' } },
      ]);
      matching.getLiveMatches.mockResolvedValue({
        items: [
          {
            findingId: 'answer',
            assetId: 'a5',
            label: 'IBAN',
            matchedContent: 'DE00',
            isNew: true,
            ranking: { importance: 0.91 },
          },
          {
            findingId: 'minor',
            assetId: 'a6',
            label: 'IBAN',
            matchedContent: 'DE01',
            ranking: { importance: 0.4 },
          },
        ],
      });

      const result = await service.generate('case-1', 'case-leads', {
        automatic: true,
      });

      expect(result.byOrigin).toEqual({ INQUIRY: 1 });
      const data = prisma.caseLead.createManyAndReturn.mock.calls[0][0].data;
      expect(data[0]).toEqual(
        expect.objectContaining({
          findingId: 'answer',
          viaInquiryId: 'q-1',
          details: { isNew: true },
        }),
      );
      expect(activity.record).not.toHaveBeenCalled();
      expect(activity.recordCoalesced).toHaveBeenCalledWith(
        'case-1',
        'LEADS_GENERATED',
        expect.objectContaining({ proposed: 1, automatic: true }),
        'case-leads',
        expect.objectContaining({ key: 'leads' }),
      );
    });
  });
});
