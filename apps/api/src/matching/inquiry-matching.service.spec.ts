import { Test, TestingModule } from '@nestjs/testing';
import { InquiryMatchingService } from './inquiry-matching.service';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { NotificationsService } from '../notifications.service';

describe('InquiryMatchingService', () => {
  let service: InquiryMatchingService;

  /**
   * The run anchor these tests are measured against: source `s1` completed a
   * run at ANCHOR_AT, so a finding created at or after that is NEW and one
   * created before it is ONGOING.
   */
  const ANCHOR_AT = new Date('2026-09-20T10:00:00Z');
  const BEFORE_ANCHOR = new Date('2026-09-19T10:00:00Z');
  const AFTER_ANCHOR = new Date('2026-09-20T11:00:00Z');

  const mockPrisma = {
    inquiry: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    finding: { findMany: jest.fn(), count: jest.fn() },
    runner: { findUnique: jest.fn() },
    source: { findMany: jest.fn() },
    caseInquiry: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const mockPgBoss = {};
  const mockNotifications = { create: jest.fn().mockResolvedValue({}) };

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
    goneMatchCount: 0,
    matchesSeenAt: null,
    ...over,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InquiryMatchingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PgBossService, useValue: mockPgBoss },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(InquiryMatchingService);
    jest.clearAllMocks();
    mockPrisma.inquiry.update.mockResolvedValue({});
    mockPrisma.runner.findUnique.mockResolvedValue(null);
    mockPrisma.source.findMany.mockResolvedValue([{ id: 's1' }]);
    mockPrisma.caseInquiry.findMany.mockResolvedValue([]);
    // One completed run for s1 — the anchor every NEW/GONE answer is measured
    // against. Returned by the DISTINCT ON in runAnchors().
    mockPrisma.$queryRaw.mockResolvedValue([
      { sourceId: 's1', runnerId: 'run-anchor', startedAt: ANCHOR_AT },
    ]);
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

  // GENESIS journal §13: a standing question warned no one until an operator
  // opened it. New unseen matches now raise one notification per run.
  describe('new-match notifications', () => {
    const started = new Date('2026-07-15T12:00:00Z');
    const fresh = () =>
      finding({ createdAt: new Date('2026-07-15T13:00:00Z') });

    it('notifies when the run created a matching finding, even for an inquiry never opened', async () => {
      // matchesSeenAt null: newMatchCount stays 0 for such an inquiry, which is
      // why notifications cannot be derived from it.
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({ findingTypes: ['email'], matchesSeenAt: null }),
      ]);
      mockPrisma.runner.findUnique.mockResolvedValue({ startedAt: started });
      mockPrisma.finding.findMany.mockResolvedValue([fresh()]);

      await service.processSourceCompletion('s1', 'run-1');

      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'inquiry.new_matches',
          actionUrl: '/investigations/inquiries/q1',
          metadata: expect.objectContaining({ added: 1 }),
        }),
      );
    });

    it('stays quiet when the run created nothing that matches', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({ findingTypes: ['ssn'] }),
      ]);
      mockPrisma.runner.findUnique.mockResolvedValue({ startedAt: started });
      mockPrisma.finding.findMany.mockResolvedValue([fresh()]);

      await service.processSourceCompletion('s1', 'run-1');

      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it("does not notify for the autopilot's own inquiries", async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({ findingTypes: ['email'], createdBy: 'ai-autopilot' }),
      ]);
      mockPrisma.runner.findUnique.mockResolvedValue({ startedAt: started });
      mockPrisma.finding.findMany.mockResolvedValue([fresh()]);

      await service.processSourceCompletion('s1', 'run-1');

      expect(mockNotifications.create).not.toHaveBeenCalled();
    });
  });

  // G-033. newMatchCount used to increment by every finding the run touched,
  // including ones merely re-detected, while /matches derived "new" from
  // createdAt > matchesSeenAt. The counters contradicted the endpoint.
  //
  // Both halves now read the same run anchor instead, so the older question
  // ("has the operator looked") cannot come back as a second definition.
  describe('newMatchCount agrees with the /matches definition (G-033)', () => {
    it('does not count re-detected findings created before the latest run', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({ findingTypes: ['email'], matchCount: 1 }),
      ]);
      // Re-detected by this run, but first seen by an earlier one. Its
      // createdAt predates the anchor, so it is not new.
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ createdAt: BEFORE_ANCHOR }),
      ]);

      const result = await service.processSourceCompletion('s1', 'run-1');

      expect(result.landed).toBe(0);
      expect(mockPrisma.inquiry.update).not.toHaveBeenCalled();
    });

    it('counts findings the latest run created', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({ findingTypes: ['email'], matchCount: 1 }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ id: 'f1', createdAt: BEFORE_ANCHOR }),
        finding({ id: 'f2', createdAt: AFTER_ANCHOR }),
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
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({ findingTypes: ['email'], newMatchCount: 99 }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ createdAt: AFTER_ANCHOR }),
      ]);

      await service.processSourceCompletion('s1', 'run-1');

      const data = mockPrisma.inquiry.update.mock.calls.at(-1)?.[0]?.data;
      expect(data.newMatchCount).toBe(1);
      expect(data).not.toHaveProperty('newMatchCount.increment');
    });

    it('reports new matches on an inquiry nobody has opened', async () => {
      // The old definition could not: it measured against matchesSeenAt, which
      // stays null until someone opens the inquiry, so a standing question
      // could never announce its first answer.
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({ findingTypes: ['email'], matchesSeenAt: null }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ createdAt: AFTER_ANCHOR }),
      ]);

      const result = await service.processSourceCompletion('s1', 'run-1');

      expect(result.landed).toBe(1);
    });

    it('reports zero new when no source in scope has completed a run', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({ findingTypes: ['email'], matchCount: 1 }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ createdAt: AFTER_ANCHOR }),
      ]);

      const result = await service.processSourceCompletion('s1', 'run-1');

      expect(result.landed).toBe(0);
    });

    it('leaves an already-correct inquiry untouched', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({ findingTypes: ['email'], matchCount: 1 }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ createdAt: BEFORE_ANCHOR }),
      ]);

      await service.processSourceCompletion('s1', 'run-1');

      expect(mockPrisma.inquiry.update).not.toHaveBeenCalled();
    });

    it('builds the run anchor once per pass, not once per inquiry', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({ id: 'q1', findingTypes: ['email'] }),
        inquiry({ id: 'q2', findingTypes: ['email'] }),
        inquiry({ id: 'q3', findingTypes: ['email'] }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ createdAt: AFTER_ANCHOR }),
      ]);

      await service.processSourceCompletion('s1', 'run-1');

      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
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
    it('returns an inquiry only when this runner produced a matching new finding', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({
          title: 'Board travel',
          findingTypes: ['email'],
          newMatchCount: 50,
        }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ createdAt: AFTER_ANCHOR }),
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

    it('ignores a globally fresh inquiry when this runner has no new match', async () => {
      // Stored newMatchCount is corpus-wide, so it cannot decide whether THIS
      // run is worth an express slot.
      mockPrisma.inquiry.findMany.mockResolvedValue([
        inquiry({ findingTypes: ['email'], newMatchCount: 50 }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ createdAt: BEFORE_ANCHOR }),
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
        inquiry({ findingTypes: ['ssn'], newMatchCount: 1 }),
      ]);
      mockPrisma.finding.findMany.mockResolvedValue([
        finding({ findingType: 'email', createdAt: AFTER_ANCHOR }),
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

  // A rematch used to write newMatchCount: 0 as "the fresh baseline". Under the
  // run anchor there is no baseline to reset — NEW is a pure function of the
  // corpus and the latest run — and create() plus every matcher edit come
  // through here, so zeroing made an inquiry report no new matches at exactly
  // the moment its answers were freshest.
  it('recomputes all three counters on rematch instead of zeroing new', async () => {
    mockPrisma.inquiry.findUnique.mockResolvedValue(inquiry());
    mockPrisma.finding.findMany.mockResolvedValue([
      finding({ id: 'f1', createdAt: AFTER_ANCHOR }),
      finding({ id: 'f2', createdAt: BEFORE_ANCHOR }),
    ]);

    await service.rematchInquiry('q1');

    expect(mockPrisma.inquiry.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { matchCount: 2, newMatchCount: 1, goneMatchCount: 0 },
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
