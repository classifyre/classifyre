import { Test, TestingModule } from '@nestjs/testing';
import { InquiryMatchingService } from './inquiry-matching.service';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';

/**
 * Candidate walks must page, and paging must not change any answer.
 *
 * The SQL half of a matcher is coarse — an inquiry watching "PII" prefilters to
 * `status = OPEN AND detector_type IN ('PII')`, which on a real corpus is
 * essentially the whole table. `candidateFindings` issued that as a single
 * `findMany` with no `take`, so the driver materialised every matching row
 * (6.7M findings × nine columns, `matched_content` among them) into a JS array
 * before the regex filter saw the first one. Captured on the desktop API with
 * exactly that statement in `pg_stat_activity`, carrying `OFFSET` and no
 * `LIMIT`:
 *
 *     18:34:16  rss=1461MB
 *     18:34:18  rss=1667MB
 *     18:34:20  rss=1952MB
 *     18:34:21  FATAL ERROR: Ineffective mark-compacts near heap limit
 *
 * The danger in fixing this is fixing it with a cap, which would silently
 * under-report matches. These tests exist to pin the opposite: every candidate
 * is still visited, every count is still exact, and the ranked page is the same
 * page a full in-memory sort would have produced.
 */
describe('candidate paging', () => {
  let service: InquiryMatchingService;

  const mockPrisma = {
    inquiry: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    finding: { findMany: jest.fn(), count: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InquiryMatchingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PgBossService, useValue: {} },
      ],
    }).compile();
    service = module.get(InquiryMatchingService);
    jest.clearAllMocks();
    mockPrisma.inquiry.update.mockResolvedValue({});
  });

  const inquiry = (over: Record<string, unknown> = {}) => ({
    id: 'q1',
    matchAllSources: true,
    sourceIds: [],
    detectorTypes: [],
    customDetectorKeys: [],
    findingTypes: [],
    findingTypeRegex: [],
    findingValueRegex: [],
    matchesSeenAt: null,
    ...over,
  });

  /** A corpus far larger than one page, served by a keyset-aware fake. */
  function corpus(
    size: number,
    decorate?: (i: number) => Record<string, unknown>,
  ) {
    const rows = Array.from({ length: size }, (_, i) => ({
      // Zero-padded so lexical id order matches numeric order, as uuid v7 /
      // cuid ordering does in practice.
      id: `f${String(i).padStart(6, '0')}`,
      assetId: `a${i}`,
      sourceId: 's1',
      detectorType: 'PII',
      customDetectorKey: null,
      findingType: 'email',
      severity: 'HIGH',
      matchedContent: `user${i}@example.com`,
      createdAt: new Date(Date.UTC(2026, 6, 1, 0, 0, i % 60)),
      ...decorate?.(i),
    }));

    const pageSizes: number[] = [];
    mockPrisma.finding.findMany.mockImplementation(
      (args: {
        where?: { id?: { gt?: string } };
        take?: number;
        select?: Record<string, unknown>;
      }) => {
        // The regression is a query with no bound at all.
        if (args.take == null) {
          throw new Error('candidate walk issued a findMany without `take`');
        }
        pageSizes.push(args.take);
        const after = args.where?.id?.gt;
        const start = after ? rows.findIndex((r) => r.id === after) + 1 : 0;
        return Promise.resolve(rows.slice(start, start + args.take));
      },
    );
    return { rows, pageSizes };
  }

  it('counts every match across many pages, not one page', async () => {
    const size = 7003;
    corpus(size);
    mockPrisma.inquiry.findUnique.mockResolvedValue(inquiry());

    const result = await service.rematchInquiry('q1');

    expect(result.landed).toBe(size);
    expect(mockPrisma.inquiry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { matchCount: size, newMatchCount: 0 },
      }),
    );
  });

  it('never asks for more than a page at a time', async () => {
    const { pageSizes } = corpus(7003);
    mockPrisma.inquiry.findUnique.mockResolvedValue(inquiry());

    await service.rematchInquiry('q1');

    expect(pageSizes.length).toBeGreaterThan(1);
    // The bound is what keeps the heap flat; a page far larger than this is
    // the old failure in a new costume.
    for (const take of pageSizes) expect(take).toBeLessThanOrEqual(5000);
  });

  it('walks with a keyset cursor rather than growing offsets', async () => {
    // OFFSET paging over a table being written to skips and repeats rows, and
    // deep pages get slower the further in they go.
    corpus(5000);
    mockPrisma.inquiry.findUnique.mockResolvedValue(inquiry());

    await service.rematchInquiry('q1');

    const calls = mockPrisma.finding.findMany.mock.calls.map(
      ([args]: [
        {
          skip?: number;
          orderBy?: unknown;
          where?: { id?: { gt?: string } };
        },
      ]) => args,
    );
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((args) => args.skip === undefined)).toBe(true);
    expect(calls.slice(1).every((args) => args.where?.id?.gt)).toBe(true);
    expect(calls.every((args) => args.orderBy)).toEqual(true);
  });

  it('returns exact counts and the correctly ranked page', async () => {
    // Importance ascends with the index, so the highest-importance rows are at
    // the very end of the walk — a top-K buffer that only kept early rows, or a
    // cap that stopped early, would both get this wrong.
    const size = 6000;
    corpus(size, (i) => ({
      evidenceAnalysis: {
        importanceScore: i,
        qualityScore: 1,
        similarCount: 0,
        duplicateGroupHash: null,
        reasons: [],
      },
    }));
    mockPrisma.inquiry.findUnique.mockResolvedValue(inquiry());

    const page = await service.getLiveMatches('q1', { skip: 0, limit: 3 });

    expect(page.total).toBe(size);
    expect(page.items.map((m) => m.findingId)).toEqual([
      `f${String(size - 1).padStart(6, '0')}`,
      `f${String(size - 2).padStart(6, '0')}`,
      `f${String(size - 3).padStart(6, '0')}`,
    ]);
    expect(page.items[0].ranking?.importance).toBe(size - 1);
  });

  it('honours skip without dropping the rows it skipped from the total', async () => {
    const size = 6000;
    corpus(size, (i) => ({
      evidenceAnalysis: {
        importanceScore: i,
        qualityScore: 1,
        similarCount: 0,
        duplicateGroupHash: null,
        reasons: [],
      },
    }));
    mockPrisma.inquiry.findUnique.mockResolvedValue(inquiry());

    const page = await service.getLiveMatches('q1', { skip: 2, limit: 2 });

    expect(page.total).toBe(size);
    expect(page.items.map((m) => m.ranking?.importance)).toEqual([
      size - 3,
      size - 4,
    ]);
  });

  it("counts 'new' against the whole match set, not the returned page", async () => {
    const seenAt = new Date(Date.UTC(2026, 6, 1, 0, 0, 30));
    const size = 6000;
    corpus(size);
    mockPrisma.inquiry.findUnique.mockResolvedValue(
      inquiry({ matchesSeenAt: seenAt }),
    );

    const page = await service.getLiveMatches('q1', { skip: 0, limit: 5 });

    // createdAt cycles through 60 seconds, so 29 of each 60 fall after seenAt.
    const expectedNew = Array.from({ length: size }).filter(
      (_, i) => i % 60 > 30,
    ).length;
    expect(page.newCount).toBe(expectedNew);
    expect(page.total).toBe(size);
    expect(page.items).toHaveLength(5);
  });

  it('applies severity and search filters to the total, not just the page', async () => {
    const size = 3000;
    corpus(size, (i) => ({
      severity: i % 2 === 0 ? 'HIGH' : 'LOW',
    }));
    mockPrisma.inquiry.findUnique.mockResolvedValue(inquiry());

    const page = await service.getLiveMatches('q1', {
      skip: 0,
      limit: 5,
      severity: ['LOW'] as never,
    });

    expect(page.total).toBe(size / 2);
    expect(page.items.every((m) => m.severity === 'LOW')).toBe(true);
  });

  it('reports every matching id, not the first page of them', async () => {
    const size = 4500;
    corpus(size);
    mockPrisma.inquiry.findUnique.mockResolvedValue(inquiry());

    const ids = await service.getMatchingFindingIds('q1');

    expect(ids).toHaveLength(size);
    expect(new Set(ids).size).toBe(size);
  });

  describe('probeMatches', () => {
    it('stops at the scan cap and reports the scan as not exhausted', async () => {
      corpus(50_000);

      const probe = await service.probeMatches(inquiry(), 3000);

      expect(probe.scanned).toBe(3000);
      expect(probe.exhausted).toBe(false);
      expect(probe.findingIds).toHaveLength(3000);
    });

    it('measures exhaustion in candidates scanned, not matches found', async () => {
      // The regex rejects almost everything. Comparing the *filtered* count
      // against the cap declared the scan exhausted, turning "no match in the
      // first N candidates" into a definitive zero — the precise confusion the
      // method's contract warns callers about.
      corpus(50_000);

      const probe = await service.probeMatches(
        inquiry({ findingValueRegex: ['user1@example\\.com$'] }),
        3000,
      );

      expect(probe.scanned).toBe(3000);
      expect(probe.exhausted).toBe(false);
      expect(probe.findingIds.length).toBeLessThan(3000);
    });

    it('reports exhaustion when the corpus runs out before the cap', async () => {
      corpus(120);

      const probe = await service.probeMatches(inquiry(), 3000);

      expect(probe.scanned).toBe(120);
      expect(probe.exhausted).toBe(true);
    });
  });
});
