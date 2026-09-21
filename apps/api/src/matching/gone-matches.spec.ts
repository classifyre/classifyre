import { Test, TestingModule } from '@nestjs/testing';
import { InquiryMatchingService } from './inquiry-matching.service';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';

/**
 * Retired matches must stay where they were asked for.
 *
 * `getLiveMatches` is not only a page of rows for a human: it feeds case lead
 * generation, the agent's evidence sampler and — through `getMatchingFindingIds`
 * — the pull into a case. If the widened status scope leaked into any of those,
 * an investigation would quietly acquire evidence the scan no longer finds.
 * `preview` is worse still: with no regex dimension it answers with a COUNT(*)
 * over the same `where`, so a leak there returns a wrong NUMBER rather than a
 * wide set, and nothing downstream could tell.
 */
describe('retired matches stay opt-in', () => {
  let service: InquiryMatchingService;

  const ANCHOR_AT = new Date('2026-09-20T10:00:00Z');

  const mockPrisma = {
    inquiry: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    finding: { findMany: jest.fn(), count: jest.fn() },
    source: { findMany: jest.fn() },
    caseInquiry: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };

  const inquiry = {
    id: 'q1',
    matchAllSources: false,
    sourceIds: ['s1'],
    detectorTypes: [],
    customDetectorKeys: [],
    findingTypes: [],
    findingTypeRegex: [],
    findingValueRegex: [],
    matchCount: 0,
    newMatchCount: 0,
    goneMatchCount: 7,
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
    mockPrisma.source.findMany.mockResolvedValue([{ id: 's1' }]);
    mockPrisma.caseInquiry.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([
      { sourceId: 's1', runnerId: 'run-latest', startedAt: ANCHOR_AT },
    ]);
    mockPrisma.inquiry.findUnique.mockResolvedValue(inquiry);
    mockPrisma.finding.findMany.mockResolvedValue([]);
    mockPrisma.finding.count.mockResolvedValue(0);
  });

  /** Every status filter the service asked the database for. */
  const statusesAsked = () =>
    mockPrisma.finding.findMany.mock.calls.map(
      ([args]: [{ where?: Record<string, unknown> }]) => args.where?.status,
    );

  it('asks only for OPEN findings when pulling into a case', async () => {
    await service.getMatchingFindingIds('q1');
    expect(statusesAsked().every((s) => s === 'OPEN')).toBe(true);
  });

  it('asks only for OPEN findings when probing for the evidence floor', async () => {
    await service.probeMatches(inquiry);
    expect(statusesAsked().every((s) => s === 'OPEN')).toBe(true);
  });

  it('counts only OPEN findings in a matcher preview', async () => {
    await service.preview(inquiry);
    const countWheres = mockPrisma.finding.count.mock.calls.map(
      ([args]: [{ where?: Record<string, unknown> }]) => args.where?.status,
    );
    expect(
      [...countWheres, ...statusesAsked()].every((s) => s === 'OPEN'),
    ).toBe(true);
  });

  it('asks only for OPEN findings on a default match listing', async () => {
    await service.getLiveMatches('q1');
    expect(statusesAsked().every((s) => s === 'OPEN')).toBe(true);
  });

  it('reports the stored gone count without walking for it', async () => {
    const page = await service.getLiveMatches('q1');
    expect(page.goneCount).toBe(7);
  });

  it('widens the status scope only when GONE is asked for by name', async () => {
    await service.getLiveMatches('q1', { state: ['GONE'] });
    // The retired walk composes its predicate under AND, so the top-level
    // `status` is the widened `{ in: [...] }` rather than a bare 'OPEN'.
    expect(
      mockPrisma.finding.findMany.mock.calls.some(
        ([args]: [{ where?: { AND?: unknown[] } }]) =>
          Array.isArray(args.where?.AND),
      ),
    ).toBe(true);
  });
});
