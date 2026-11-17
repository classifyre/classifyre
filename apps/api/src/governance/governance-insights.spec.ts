import { GovernanceInsightsService } from './governance-insights.service';

/**
 * The Governance tab of the assets page (GOV §5.7): the raw SQL runs on the
 * dev stack; here, what the service makes of its rows.
 */
function service(rows: unknown[][], roles: unknown[] = []) {
  const queryRaw = jest.fn();
  for (const result of rows) queryRaw.mockResolvedValueOnce(result);
  const prisma = {
    $queryRaw: queryRaw,
    governanceRole: { findMany: jest.fn().mockResolvedValue(roles) },
  };
  return {
    insights: new GovernanceInsightsService(prisma as never),
    prisma,
  };
}

const today = new Date().toISOString().slice(0, 10);
const alice = { actorRef: 'user:alice', groupIds: ['g1'] };

describe('GovernanceInsightsService.dashboard', () => {
  const coverage = [
    {
      source_id: 's1',
      name: 'Sales',
      assets: 10n,
      owned: 6n,
      certified: 2n,
      failing: 1n,
    },
    {
      source_id: 's2',
      name: 'HR',
      assets: 4n,
      owned: 0n,
      certified: 0n,
      failing: 0n,
    },
  ];
  const failing = [
    {
      asset_id: 'a1',
      name: 'orders',
      source_id: 's1',
      source_name: 'Sales',
      failing: 2n,
      rank: 4,
    },
  ];
  const incomplete = [
    {
      asset_id: 'a2',
      name: 'customers',
      source_id: 's1',
      source_name: 'Sales',
      no_steward: true,
      no_description: false,
      not_certified: true,
      total: 3n,
    },
  ];
  const latest = [
    { dimension: 'completeness', severity: 'HIGH', passed: true },
    { dimension: 'completeness', severity: 'LOW', passed: false },
    { dimension: 'validity', severity: 'MEDIUM', passed: null },
  ];
  const perDay = [
    { day: new Date(`${today}T00:00:00Z`), passed: 5n, failed: 1n },
  ];

  it('falls back to all when the person answers for nothing', async () => {
    const { insights } = service([
      coverage,
      failing,
      incomplete,
      [],
      latest,
      perDay,
    ]);
    const result = await insights.dashboard(alice, {
      scope: 'mine',
      days: '7',
    });
    expect(result.scope).toBe('all');
    expect(result.days).toBe(7);
  });

  it('keeps mine when they own or steward something', async () => {
    const { insights, prisma } = service(
      [coverage, failing, incomplete, [], latest, perDay],
      [{ scopeType: 'SOURCE', scopeId: 's1' }],
    );
    const result = await insights.dashboard(alice, { scope: 'mine' });
    expect(result.scope).toBe('mine');
    expect(prisma.governanceRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          principalRef: { in: ['user:alice', 'group:g1'] },
        }),
      }),
    );
  });

  it('adds up totals, names the worst severity and the gaps', async () => {
    const { insights } = service([
      coverage,
      failing,
      incomplete,
      [],
      latest,
      perDay,
    ]);
    const result = await insights.dashboard(null, { days: 30 });
    expect(result.totals).toEqual({
      assets: 14,
      governed: 6,
      certified: 2,
      failing: 1,
      score: 80, // HIGH 4 passed of HIGH 4 + LOW 1
    });
    expect(result.failing[0]).toMatchObject({
      assetId: 'a1',
      failing: 2,
      severity: 'HIGH',
    });
    expect(result.incomplete[0].missing).toEqual(['steward', 'certification']);
    expect(result.incompleteCount).toBe(3);
    expect(result.quality.dimensions).toEqual([
      { dimension: 'completeness', rules: 2, score: 80 },
      { dimension: 'validity', rules: 1, score: null },
    ]);
    expect(result.quality.perDay).toHaveLength(30);
    expect(result.quality.perDay.at(-1)).toEqual({
      day: today,
      passed: 5,
      failed: 1,
    });
  });
});

describe('GovernanceInsightsService.workspaceUsage', () => {
  it('splits the period from the one before and fills every day', async () => {
    const { insights } = service([
      [
        {
          day: new Date(`${today}T00:00:00Z`),
          reads: 7n,
          exports: 1n,
          current: true,
        },
        { day: null, reads: 3n, exports: 0n, current: false },
      ],
      [
        {
          asset_id: 'a1',
          name: 'orders',
          source_id: 's1',
          source_name: 'Sales',
          reads: 7n,
          exports: 1n,
          readers: 2n,
          previous: 3n,
        },
      ],
    ]);
    const result = await insights.workspaceUsage(null, {
      days: 14,
      sort: 'rising',
    });
    expect(result).toMatchObject({
      days: 14,
      sort: 'rising',
      reads: 7,
      exports: 1,
      previous: 3,
    });
    expect(result.perDay).toHaveLength(14);
    expect(result.perDay.at(-1)).toEqual({ day: today, reads: 7, exports: 1 });
    expect(result.top[0]).toEqual({
      assetId: 'a1',
      name: 'orders',
      sourceId: 's1',
      sourceName: 'Sales',
      reads: 7,
      exports: 1,
      readers: 2,
      previous: 3,
    });
  });

  it('ranks by use unless asked for rising, and bounds days and limit', async () => {
    const { insights, prisma } = service([[], []]);
    const result = await insights.workspaceUsage(null, {
      days: 9999,
      sort: 'x',
      limit: 500,
    });
    expect(result.sort).toBe('used');
    expect(result.days).toBe(365);
    const top = prisma.$queryRaw.mock.calls[1] as unknown[];
    expect(top).toContain(50);
  });
});

describe('GovernanceInsightsService.overview', () => {
  it('maps the one row into the three cards', async () => {
    const { insights } = service([
      [
        {
          raw_total: 100n,
          raw_new: 5n,
          raw_updated: 7n,
          governed: 40n,
          ungoverned: 55n,
          certified: 12n,
          failing: 3n,
          shared_total: 4n,
          shared_certified: 1n,
        },
      ],
    ]);
    expect(await insights.overview()).toEqual({
      raw: { total: 100, new: 5, updated: 7 },
      governance: { governed: 40, ungoverned: 55, certified: 12, failing: 3 },
      shared: { total: 4, certified: 1 },
    });
  });
});
