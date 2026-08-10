import { AgentSearchService } from './agent-search.service';

describe('AgentSearchService — open hypotheses', () => {
  const prisma = {
    case: { findMany: jest.fn() },
    caseThreadEntry: { findMany: jest.fn() },
  };
  const service = new AgentSearchService(prisma as never, {} as never);
  const hypothesis = (over: Record<string, unknown> = {}) => ({
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Key reuse',
    testablePredicate: 'A key-shaped token appears after rotation.',
    createdBy: 'ai-autopilot',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    entries: [{ body: 'Newest statement' }],
    ...over,
  });
  const investigation = (over: Record<string, unknown> = {}) => ({
    id: 'case-1',
    title: 'Leaked credentials',
    severity: 'HIGH',
    createdBy: 'ai-autopilot',
    threads: [hypothesis()],
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.caseThreadEntry.findMany.mockResolvedValue([]);
  });

  it('queries only proposed zero-support hypotheses and reads newest statements', async () => {
    prisma.case.findMany.mockResolvedValue([investigation()]);

    const result = await service.openHypotheses();

    expect(prisma.case.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          threads: {
            some: expect.objectContaining({
              kind: 'HYPOTHESIS',
              status: 'PROPOSED',
              support: { none: {} },
            }),
          },
        }),
        select: expect.objectContaining({
          threads: expect.objectContaining({
            select: expect.objectContaining({
              entries: expect.objectContaining({
                where: { entryType: 'STATEMENT' },
                orderBy: { createdAt: 'desc' },
                take: 1,
              }),
            }),
          }),
        }),
      }),
    );
    expect(result.items[0].statement).toBe('Newest statement');
  });

  it('excludes probed hypotheses by default and counts them', async () => {
    prisma.case.findMany.mockResolvedValue([investigation()]);
    prisma.caseThreadEntry.findMany.mockResolvedValue([
      {
        threadId: '11111111-1111-4111-8111-111111111111',
        metadata: {
          probe: { customDetectorKey: 'cust_probe', detectorId: 'det-1' },
        },
        createdAt: new Date('2026-07-03T00:00:00Z'),
      },
    ]);

    const hidden = await service.openHypotheses();
    const included = await service.openHypotheses(true);

    expect(hidden.items).toEqual([]);
    expect(hidden.probedExcluded).toBe(1);
    expect(included.items[0].probes).toEqual([
      {
        customDetectorKey: 'cust_probe',
        detectorId: 'det-1',
        createdAt: new Date('2026-07-03T00:00:00Z'),
      },
    ]);
  });

  it('orders operator cases, then operator hypotheses, severity, predicate and age', async () => {
    prisma.case.findMany.mockResolvedValue([
      investigation({
        id: 'ai-case',
        severity: 'CRITICAL',
        threads: [hypothesis({ id: 'ai-thread' })],
      }),
      investigation({
        id: 'operator-case',
        createdBy: null,
        severity: 'LOW',
        threads: [
          hypothesis({ id: 'operator-thread', createdBy: null }),
          hypothesis({
            id: 'ai-thread-in-operator',
            createdBy: 'ai-autopilot',
          }),
        ],
      }),
    ]);

    const result = await service.openHypotheses();

    expect(result.items.map((item) => item.threadId)).toEqual([
      'operator-thread',
      'ai-thread-in-operator',
      'ai-thread',
    ]);
  });

  it('caps the ranked queue at twenty and returns it in complete pages', async () => {
    prisma.case.findMany.mockResolvedValue([
      investigation({
        threads: Array.from({ length: 25 }, (_, index) =>
          hypothesis({
            id: `thread-${index.toString().padStart(2, '0')}`,
            createdAt: new Date(2026, 6, index + 1),
          }),
        ),
      }),
    ]);

    const result = await service.openHypotheses();

    expect(result.shown).toBe(5);
    expect(result.omitted).toBe(20);
    expect(result.nextOffset).toBe(5);

    const secondPage = await service.openHypotheses(false, { offset: 5 });
    expect(secondPage.items[0].threadId).toBe('thread-05');
    expect(secondPage.offset).toBe(5);
  });

  it('keeps a maximum-shaped default page below the observation cap', async () => {
    prisma.case.findMany.mockResolvedValue([
      investigation({
        title: 'c'.repeat(500),
        threads: Array.from({ length: 5 }, (_, index) =>
          hypothesis({
            id: `thread-${index}`,
            title: 'h'.repeat(500),
            testablePredicate: 'p'.repeat(2_000),
            entries: [{ body: 's'.repeat(2_000) }],
          }),
        ),
      }),
    ]);

    const result = await service.openHypotheses();

    expect(JSON.stringify(result).length).toBeLessThan(8_000);
  });
});
