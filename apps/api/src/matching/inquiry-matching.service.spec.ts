import { Test, TestingModule } from '@nestjs/testing';
import { InquiryMatchingService } from './inquiry-matching.service';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';

describe('InquiryMatchingService', () => {
  let service: InquiryMatchingService;

  const mockPrisma = {
    inquiry: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    finding: { findMany: jest.fn(), count: jest.fn() },
  };
  const mockPgBoss = {};

  const inquiry = (over: Record<string, unknown> = {}) => ({
    id: 'q1',
    title: 'Board travel',
    matchAllSources: false,
    sourceIds: ['s1'],
    detectorTypes: [],
    customDetectorKeys: [],
    findingTypes: [],
    findingTypeRegex: [],
    findingValueRegex: [],
    matchCount: 0,
    newMatchCount: 0,
    matchesSeenAt: null,
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
    mockPrisma.inquiry.update.mockResolvedValue({});
  });

  it('does nothing when no active inquiry matches the source', async () => {
    mockPrisma.inquiry.findMany.mockResolvedValue([]);
    const result = await service.processSourceCompletion('s1', 'run-1');
    expect(result.landed).toBe(0);
    expect(mockPrisma.finding.findMany).not.toHaveBeenCalled();
  });

  const finding = (over: Record<string, unknown> = {}) => ({
    id: 'f1',
    assetId: 'a1',
    sourceId: 's1',
    detectorType: 'PII',
    customDetectorKey: null,
    findingType: 'email',
    severity: 'HIGH',
    matchedContent: 'a@b.com',
    createdAt: new Date('2026-07-15T10:00:00Z'),
    ...over,
  });

  it('refreshes matchCount from the live match set and filters non-matches', async () => {
    mockPrisma.inquiry.findMany.mockResolvedValue([
      inquiry({ findingTypes: ['email'] }),
    ]);
    mockPrisma.finding.findMany.mockResolvedValue([
      finding({ id: 'f1', findingType: 'email' }),
      finding({ id: 'f2', findingType: 'ssn' }), // does not match the inquiry
    ]);

    await service.processSourceCompletion('s1', 'run-1');

    expect(mockPrisma.inquiry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'q1' },
        data: expect.objectContaining({ matchCount: 1 }),
      }),
    );
  });

  // G-033. newMatchCount used to increment by every finding the run touched,
  // including ones merely re-detected, while /matches derived "new" from
  // createdAt > matchesSeenAt. The counters contradicted the endpoint.
  describe('newMatchCount agrees with the /matches definition (G-033)', () => {
    it('does not count re-detected findings created before matchesSeenAt', async () => {
      const seenAt = new Date('2026-07-15T12:00:00Z');
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({
          findingTypes: ['email'],
          matchCount: 1,
          matchesSeenAt: seenAt,
        }),
      ]);
      // Re-detected by this run, but created long before the operator last
      // looked — /matches calls this 0 new, so the counter must too.
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ createdAt: new Date('2026-07-15T09:00:00Z') }),
      ]);

      const result = await service.processSourceCompletion('s1', 'run-1');

      expect(result.landed).toBe(0);
      expect(mockPrisma.inquiry.update).not.toHaveBeenCalled();
    });

    it('counts findings created after matchesSeenAt', async () => {
      const seenAt = new Date('2026-07-15T12:00:00Z');
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({
          findingTypes: ['email'],
          matchCount: 1,
          matchesSeenAt: seenAt,
        }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ id: 'f1', createdAt: new Date('2026-07-15T09:00:00Z') }),
        finding({ id: 'f2', createdAt: new Date('2026-07-15T13:00:00Z') }),
      ]);

      const result = await service.processSourceCompletion('s1', 'run-1');

      expect(result.landed).toBe(1);
      expect(mockPrisma.inquiry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ matchCount: 2, newMatchCount: 1 }),
        }),
      );
    });

    it('assigns newMatchCount rather than incrementing it', async () => {
      // An accumulator drifts permanently once any run miscounts; assignment
      // lets every run reconcile against the live set.
      const seenAt = new Date('2026-07-15T12:00:00Z');
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({
          findingTypes: ['email'],
          newMatchCount: 99,
          matchesSeenAt: seenAt,
        }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ createdAt: new Date('2026-07-15T13:00:00Z') }),
      ]);

      await service.processSourceCompletion('s1', 'run-1');

      const data = mockPrisma.inquiry.update.mock.calls.at(-1)?.[0]?.data;
      expect(data.newMatchCount).toBe(1);
      expect(data).not.toHaveProperty('newMatchCount.increment');
    });

    it('reports zero new when the inquiry has never been seen', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({ findingTypes: ['email'], matchesSeenAt: null }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([finding()]);

      const result = await service.processSourceCompletion('s1', 'run-1');

      // Matches the endpoint: isNew is false when matchesSeenAt is null.
      expect(result.landed).toBe(0);
    });

    it('leaves an already-correct inquiry untouched', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({
          findingTypes: ['email'],
          matchCount: 1,
          matchesSeenAt: null,
        }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([finding()]);

      await service.processSourceCompletion('s1', 'run-1');

      expect(mockPrisma.inquiry.update).not.toHaveBeenCalled();
    });

    it('corrects a stale matchCount even with no new findings', async () => {
      // Findings resolved between runs leave the stored count too high.
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({
          findingTypes: ['email'],
          matchCount: 8,
          matchesSeenAt: null,
        }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([finding()]);

      await service.processSourceCompletion('s1', 'run-1');

      expect(mockPrisma.inquiry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ matchCount: 1, newMatchCount: 0 }),
        }),
      );
    });
  });

  describe('runner-scoped express inquiry matching', () => {
    const seenAt = new Date('2026-07-15T12:00:00Z');

    it('returns an inquiry only when this runner produced a matching new finding', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({
          title: 'Board travel',
          findingTypes: ['email'],
          matchesSeenAt: seenAt,
          newMatchCount: 50,
        }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ createdAt: new Date('2026-07-15T13:00:00Z') }),
      ]);

      await expect(
        service.findNewInquiryMatchForRunner({
          sourceId: 's1',
          runnerId: 'run-current',
          createdByNot: 'ai-autopilot',
        }),
      ).resolves.toEqual({ id: 'q1', title: 'Board travel' });

      expect(mockPrisma.inquiry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [
              {
                OR: [
                  { createdBy: null },
                  { createdBy: { not: 'ai-autopilot' } },
                ],
              },
              {
                OR: [{ matchAllSources: true }, { sourceIds: { has: 's1' } }],
              },
            ],
          }),
        }),
      );
      expect(mockPrisma.finding.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            sourceId: 's1',
            runnerId: 'run-current',
            status: 'OPEN',
          },
        }),
      );
    });

    it('ignores a globally unread inquiry when this runner has no new match', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({
          findingTypes: ['email'],
          matchesSeenAt: seenAt,
          newMatchCount: 50,
        }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ createdAt: new Date('2026-07-15T09:00:00Z') }),
      ]);

      await expect(
        service.findNewInquiryMatchForRunner({
          sourceId: 's1',
          runnerId: 'run-current',
          createdByNot: 'ai-autopilot',
        }),
      ).resolves.toBeNull();
    });

    it('uses the canonical matcher rather than treating every runner finding as a hit', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({
          findingTypes: ['ssn'],
          matchesSeenAt: seenAt,
          newMatchCount: 1,
        }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({
          findingType: 'email',
          createdAt: new Date('2026-07-15T13:00:00Z'),
        }),
      ]);

      await expect(
        service.findNewInquiryMatchForRunner({
          sourceId: 's1',
          runnerId: 'run-current',
          createdByNot: 'ai-autopilot',
        }),
      ).resolves.toBeNull();
    });
  });

  it('resets newMatchCount to 0 on rematch', async () => {
    mockPrisma.inquiry.findUnique.mockResolvedValue(inquiry());
    mockPrisma.finding.findMany.mockResolvedValue([
      {
        id: 'f1',
        assetId: 'a1',
        sourceId: 's1',
        detectorType: 'PII',
        customDetectorKey: null,
        findingType: 'email',
        severity: 'HIGH',
        matchedContent: 'x',
      },
    ]);

    await service.rematchInquiry('q1');

    expect(mockPrisma.inquiry.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { matchCount: 1, newMatchCount: 0 },
    });
  });

  it('preview returns total + a capped sample without persisting', async () => {
    // No regex dimensions configured, so the SQL where fully expresses the
    // matcher: the total comes from COUNT(*) rather than from materialising
    // and filtering every matching row.
    mockPrisma.finding.count.mockResolvedValue(1);
    mockPrisma.finding.findMany.mockResolvedValue([
      {
        id: 'f1',
        assetId: 'a1',
        sourceId: 's1',
        detectorType: 'PII',
        customDetectorKey: null,
        findingType: 'ssn',
        severity: 'HIGH',
        matchedContent: 'x',
        createdAt: new Date(),
        asset: { name: 'a.csv', sourceType: 'S3_COMPATIBLE_STORAGE' },
      },
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
    expect(result.sample[0]).toMatchObject({
      findingId: 'f1',
      label: 'ssn',
      assetName: 'a.csv',
    });
    expect(mockPrisma.inquiry.update).not.toHaveBeenCalled();
  });

  it('preview counts every regex match but only hydrates the capped sample', async () => {
    // A value regex cannot be pushed into SQL, so this path must scan. What it
    // must NOT do is materialise the whole match set: the total is counted as
    // rows stream past, and the expensive asset/evidence joins are fetched
    // only for the ids that will actually be rendered.
    const scanned = Array.from({ length: 120 }, (_, i) => ({
      id: `f${i}`,
      sourceId: 's1',
      detectorType: 'PII',
      customDetectorKey: null,
      findingType: 'ssn',
      // Half the rows match the value regex below.
      matchedContent: i % 2 === 0 ? 'hit-value' : 'miss',
    }));

    mockPrisma.finding.findMany
      // First call: the lean scan batch.
      .mockResolvedValueOnce(scanned)
      // Second call: hydration of the sampled ids only.
      .mockResolvedValueOnce(
        scanned
          .filter((_, i) => i % 2 === 0)
          .slice(0, 50)
          .map((row) => ({
            ...row,
            assetId: 'a1',
            severity: 'HIGH',
            createdAt: new Date(),
            asset: { name: 'a.csv', sourceType: 'S3_COMPATIBLE_STORAGE' },
          })),
      );

    const result = await service.preview({
      matchAllSources: true,
      sourceIds: [],
      detectorTypes: [],
      customDetectorKeys: [],
      findingTypes: [],
      findingTypeRegex: [],
      findingValueRegex: ['^hit-'],
    });

    // 60 of the 120 scanned rows match, and all 60 are counted...
    expect(result.total).toBe(60);
    // ...but only PREVIEW_CAP of them are hydrated and returned.
    expect(result.sample).toHaveLength(50);
    expect(result.sample[0]).toMatchObject({ findingId: 'f0' });

    // The count never went through COUNT(*) here — the regex forced a scan.
    expect(mockPrisma.finding.count).not.toHaveBeenCalled();
    // Hydration asked for exactly the sampled ids, not the whole match set.
    const hydrateArgs = mockPrisma.finding.findMany.mock.calls[1][0];
    expect(hydrateArgs.where.id.in).toHaveLength(50);
    expect(mockPrisma.inquiry.update).not.toHaveBeenCalled();
  });

  it('keeps importance ordering when paginating live matches', async () => {
    mockPrisma.inquiry.findUnique.mockResolvedValue(
      inquiry({ findingTypes: ['email'] }),
    );
    mockPrisma.finding.findMany.mockResolvedValue([
      finding({
        id: 'recent-low',
        createdAt: new Date('2026-07-17T12:00:00Z'),
        asset: { name: 'recent.csv', sourceType: 'S3' },
        evidenceAnalysis: {
          importanceScore: 0.2,
          qualityScore: 1,
          similarCount: 0,
          duplicateGroupHash: null,
          reasons: [],
        },
      }),
      finding({
        id: 'older-high',
        createdAt: new Date('2026-07-16T12:00:00Z'),
        asset: { name: 'older.csv', sourceType: 'S3' },
        evidenceAnalysis: {
          importanceScore: 0.9,
          qualityScore: 1,
          similarCount: 0,
          duplicateGroupHash: null,
          reasons: [],
        },
      }),
    ]);

    const result = await service.getLiveMatches('q1', { limit: 1 });

    expect(result.items[0].findingId).toBe('older-high');
  });
});
