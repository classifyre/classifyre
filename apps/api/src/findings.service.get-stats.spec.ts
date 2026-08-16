import { FindingsService } from './findings.service';

/**
 * The overview counters must come from the rollup, not from `findings`.
 *
 * `getStats` was six `count(*)` statements over the whole table. On a
 * 6.7M-finding workspace they measured 11.4 s wall-clock with a Postgres
 * backend at ~95% CPU, and the dashboard header issues them on every load —
 * which is what made the app feel unusable while a scan was running. The same
 * severity/status grouping reads out of `finding_stats_daily` in 42 ms.
 *
 * The rollup is a complete aggregate (no retention window), so this is a
 * change of *where* the counts are computed, not of what they include: these
 * tests pin that the two paths return the same shape and the same numbers, and
 * that an unbuilt rollup still falls back to live counts rather than reporting
 * an empty workspace.
 */
describe('FindingsService.getStats', () => {
  /** Rows as the rollup returns them, mirroring a real workspace. */
  const rollupRows = [
    { severity: 'CRITICAL', status: 'OPEN', count: 3965 },
    { severity: 'HIGH', status: 'OPEN', count: 1041263 },
    { severity: 'MEDIUM', status: 'OPEN', count: 5652948 },
    { severity: 'LOW', status: 'RESOLVED', count: 12 },
  ];

  function harness(options: { isUsable?: boolean; rows?: typeof rollupRows }) {
    const stats = {
      isUsable: jest.fn().mockResolvedValue(options.isUsable ?? true),
      severityStatusTotals: jest
        .fn()
        .mockResolvedValue(options.rows ?? rollupRows),
    };
    const count = jest.fn().mockResolvedValue(0);
    const prisma = { finding: { count } };

    const service = Object.create(FindingsService.prototype) as FindingsService;
    Object.assign(service, { prisma, stats });
    return { service, stats, count };
  }

  it('sums the rollup instead of counting findings', async () => {
    const h = harness({});

    const result = await h.service.getStats();

    expect(result).toEqual({
      total: 3965 + 1041263 + 5652948 + 12,
      bySeverity: {
        critical: 3965,
        high: 1041263,
        medium: 5652948,
        low: 12,
      },
      // RESOLVED is in `total` but not in `open`, exactly as the live
      // `count({ status: OPEN })` behaved.
      byStatus: { open: 3965 + 1041263 + 5652948 },
    });
    expect(h.count).not.toHaveBeenCalled();
  });

  it('asks the rollup for every day, not a window', async () => {
    // A windowed query would silently under-report a workspace whose findings
    // predate the window — the counters are all-time by definition.
    const h = harness({});

    await h.service.getStats();

    expect(h.stats.severityStatusTotals).toHaveBeenCalledWith(
      undefined,
      undefined,
    );
  });

  it('scopes to a source when asked', async () => {
    const h = harness({});

    await h.service.getStats('source-1');

    expect(h.stats.severityStatusTotals).toHaveBeenCalledWith(undefined, {
      sourceId: ['source-1'],
    });
  });

  it('counts a severity outside the four keys toward the total only', async () => {
    // The live path's unfiltered `count()` includes INFO findings while its
    // `bySeverity` has no key for them. Dropping them from `total` here would
    // make the header disagree with the findings list.
    const h = harness({
      rows: [
        { severity: 'INFO', status: 'OPEN', count: 7 },
        { severity: 'HIGH', status: 'OPEN', count: 3 },
      ],
    });

    const result = await h.service.getStats();

    expect(result.total).toBe(10);
    expect(result.byStatus.open).toBe(10);
    expect(result.bySeverity).toEqual({
      critical: 0,
      high: 3,
      medium: 0,
      low: 0,
    });
  });

  it('falls back to live counts when the rollup is not built', async () => {
    const h = harness({ isUsable: false });
    h.count
      .mockResolvedValueOnce(100) // total
      .mockResolvedValueOnce(1) // critical
      .mockResolvedValueOnce(2) // high
      .mockResolvedValueOnce(3) // medium
      .mockResolvedValueOnce(4) // low
      .mockResolvedValueOnce(90); // open

    const result = await h.service.getStats();

    expect(result).toEqual({
      total: 100,
      bySeverity: { critical: 1, high: 2, medium: 3, low: 4 },
      byStatus: { open: 90 },
    });
    expect(h.stats.severityStatusTotals).not.toHaveBeenCalled();
  });

  it('falls back to live counts when the rollup is unavailable entirely', async () => {
    // `stats` is @Optional() — a deployment without the rollup module must
    // still serve the dashboard.
    const h = harness({});
    Object.assign(h.service, { stats: undefined });
    h.count.mockResolvedValue(0);

    await expect(h.service.getStats()).resolves.toEqual({
      total: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byStatus: { open: 0 },
    });
  });
});
