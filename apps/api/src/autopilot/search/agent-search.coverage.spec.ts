import { Test, TestingModule } from '@nestjs/testing';
import { AgentSearchService } from './agent-search.service';
import { PrismaService } from '../../prisma.service';
import { InquiryMatchingService } from '../../matching/inquiry-matching.service';

/**
 * `corpus.coverage` and the system brief must report the same number.
 *
 * Both used to divide by every source row, which made coverage a one-way
 * ratchet: a source that can never scan sat in the denominator for good, held
 * the ratio under the sample threshold, and left the agents permanently told to
 * defer rather than act. Fixing one and not the other would be worse than
 * neither — the agent would read 99% in its brief and 8% from its own tool.
 */
describe('AgentSearchService — corpusCoverage', () => {
  let service: AgentSearchService;

  const mockPrisma = {
    source: { findMany: jest.fn() },
    finding: { count: jest.fn() },
  };

  const source = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    name: 'Mailbox',
    lastRunAt: new Date(),
    lastRunStatus: 'COMPLETED',
    runnerStatus: 'COMPLETED',
    consecutiveFailures: 0,
    scheduleMode: 'AUTO',
    autoPhase: 'STEADY',
    runners: [
      {
        completedAt: new Date(),
        status: 'COMPLETED',
        assetsWithoutText: 0,
        textCoverage: null,
      },
    ],
    ...over,
  });

  /** Never successfully scanned, and nothing will ever try again. */
  const dead = (over: Record<string, unknown> = {}) =>
    source({
      lastRunAt: null,
      lastRunStatus: 'ERROR',
      runnerStatus: 'ERROR',
      consecutiveFailures: 9,
      runners: [],
      ...over,
    });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentSearchService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InquiryMatchingService, useValue: {} },
      ],
    }).compile();
    service = module.get(AgentSearchService);
    jest.clearAllMocks();
    mockPrisma.finding.count.mockResolvedValue(0);
  });

  it('divides by reachable sources, not by every source row', async () => {
    mockPrisma.source.findMany.mockResolvedValue([
      source({ id: 'a' }),
      source({ id: 'b' }),
      dead({ id: 'c' }),
      dead({ id: 'd' }),
    ]);

    const out = await service.corpusCoverage();

    expect(out.totalSources).toBe(4);
    expect(out.unavailableSources).toBe(2);
    expect(out.reachableSources).toBe(2);
    // 2/2, not 2/4 — the difference between acting and deferring.
    expect(out.coverageRatio).toBe(1);
  });

  it('flags each unavailable source, so the config agent can see which', async () => {
    mockPrisma.source.findMany.mockResolvedValue([
      source({ id: 'a' }),
      dead({ id: 'c' }),
    ]);

    const out = await service.corpusCoverage();

    expect(out.sources.find((s) => s.sourceId === 'a')!.unavailable).toBe(
      false,
    );
    expect(out.sources.find((s) => s.sourceId === 'c')!.unavailable).toBe(true);
    expect(out.note).toMatch(/cannot be scanned at all/);
  });

  it('counts a source with scheduling switched off and no successful run', async () => {
    mockPrisma.source.findMany.mockResolvedValue([
      dead({ id: 'off', consecutiveFailures: 0, scheduleMode: 'OFF' }),
    ]);

    const out = await service.corpusCoverage();

    expect(out.unavailableSources).toBe(1);
  });

  it('counts a paused adaptive schedule', async () => {
    mockPrisma.source.findMany.mockResolvedValue([
      dead({
        id: 'paused',
        consecutiveFailures: 0,
        scheduleMode: 'AUTO',
        autoPhase: 'PAUSED',
      }),
    ]);

    const out = await service.corpusCoverage();

    expect(out.unavailableSources).toBe(1);
  });

  it('keeps a source it has read in the ratio, however broken it is now', async () => {
    // Failing hard today, but it produced a completed run — we HAVE read it,
    // so it is coverage, not a gap.
    mockPrisma.source.findMany.mockResolvedValue([
      source({ id: 'a', consecutiveFailures: 20, scheduleMode: 'OFF' }),
      source({ id: 'b' }),
    ]);

    const out = await service.corpusCoverage();

    expect(out.unavailableSources).toBe(0);
    expect(out.coverageRatio).toBe(1);
  });

  it('does not count a source that is simply waiting its turn', async () => {
    // Never scanned, but scheduled and healthy: a real gap, still coming.
    mockPrisma.source.findMany.mockResolvedValue([
      source({ id: 'a' }),
      dead({ id: 'pending', consecutiveFailures: 0, autoPhase: 'CATCH_UP' }),
    ]);

    const out = await service.corpusCoverage();

    expect(out.unavailableSources).toBe(0);
    expect(out.coverageRatio).toBe(0.5);
  });

  it('reports 0%, not full coverage, when nothing readable has been read', async () => {
    mockPrisma.source.findMany.mockResolvedValue([
      dead({ id: 'c' }),
      dead({ id: 'd' }),
    ]);

    const out = await service.corpusCoverage();

    expect(out.reachableSources).toBe(0);
    expect(out.coverageRatio).toBe(0);
  });

  it('says nothing about unavailable sources when there are none', async () => {
    mockPrisma.source.findMany.mockResolvedValue([source({ id: 'a' })]);

    const out = await service.corpusCoverage();

    expect(out.note).not.toMatch(/cannot be scanned/);
  });
});
