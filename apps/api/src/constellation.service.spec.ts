import { ConstellationService } from './constellation.service';

/**
 * The bug these cover: every source on the dashboard reported 0 assets, 0
 * connected, 0 internal links and 0 findings, and the canvas drew a bubble
 * labelled "0" for a source with tens of thousands of assets.
 *
 * The rollup itself was fine. What was wrong is that *all* of the numbers were
 * read from it, so a workspace whose first rebuild had not landed — or a source
 * created since the last one — got zeros for facts that `assets` and `findings`
 * can answer on their own.
 */
describe('ConstellationService source counts', () => {
  const sources = [
    { id: 's1', name: 'Alpha', type: 'LOCAL_FOLDER' },
    { id: 's2', name: 'Beta', type: 'LOCAL_FOLDER' },
  ];

  const makePrisma = () =>
    ({
      source: { findMany: jest.fn().mockResolvedValue(sources) },
      correlationSourcePair: { findMany: jest.fn().mockResolvedValue([]) },
      asset: {
        groupBy: jest.fn().mockResolvedValue([
          { sourceId: 's1', _count: { _all: 40_000 } },
          { sourceId: 's2', _count: { _all: 7 } },
        ]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      finding: {
        groupBy: jest.fn().mockResolvedValue([
          { sourceId: 's1', severity: 'HIGH', _count: { _all: 12 } },
          { sourceId: 's1', severity: 'LOW', _count: { _all: 3 } },
        ]),
      },
    }) satisfies Record<string, unknown>;

  const scheduler = {
    scheduleRebuild: jest.fn().mockResolvedValue(undefined),
  };

  /**
   * Hand a mock literal to the constructor without widening the local binding
   * to the service type. `expect(prisma.asset.groupBy)` on a value typed as
   * the real `PrismaService` reads a *method*, which trips
   * `@typescript-eslint/unbound-method`; the literal's own `jest.Mock` type
   * asserts cleanly, so the cast belongs at the injection site instead.
   */
  const asService = <T>(mock: unknown): T => mock as T;

  beforeEach(() => jest.clearAllMocks());

  it('sizes sources from live counts when the rollup has never been built', async () => {
    const sourceGraph = {
      getFreshness: jest.fn().mockResolvedValue({
        refreshedAt: null,
        durationMs: null,
        isBuilt: false,
      }),
      readMap: jest.fn(),
    };

    const result = await new ConstellationService(
      asService(makePrisma()),
      asService(sourceGraph),
      asService(scheduler),
    ).getMap();

    const alpha = result.sources.find((s) => s.id === 's1')!;
    expect(alpha.assetCount).toBe(40_000);
    expect(alpha.findingCount).toBe(15);
    expect(alpha.severityCounts.high).toBe(12);
    expect(alpha.severityCounts.low).toBe(3);
    // Nothing is claimed about connectivity: that genuinely needs the rollup,
    // and `isBuilt: false` tells the client to render it as unknown.
    expect(alpha.connectedAssetCount).toBe(0);
    expect(result.stats.isBuilt).toBe(false);
    expect(result.totals.assets).toBe(40_007);
    expect(scheduler.scheduleRebuild).toHaveBeenCalled();
    // The rollup must not be read at all on this path.
    expect(sourceGraph.readMap).not.toHaveBeenCalled();
  });

  it('falls back to live counts for a source added since the last rebuild', async () => {
    const sourceGraph = {
      getFreshness: jest.fn().mockResolvedValue({
        refreshedAt: new Date('2026-09-06T00:00:00Z'),
        durationMs: 12,
        isBuilt: true,
      }),
      readMap: jest.fn().mockResolvedValue({
        nodes: [
          {
            sourceId: 's1',
            assetCount: 40_000,
            connectedAssetCount: 900,
            internalEdgeCount: 12,
            findingCount: 15,
            severityCounts: { HIGH: 12, LOW: 3 },
          },
        ],
        links: [],
        boundary: [],
        bundles: [],
      }),
    };

    const prisma = makePrisma();
    const result = await new ConstellationService(
      asService(prisma),
      asService(sourceGraph),
      asService(scheduler),
    ).getMap();

    // s1 is in the rollup and keeps its graph-shaped numbers.
    const alpha = result.sources.find((s) => s.id === 's1')!;
    expect(alpha.connectedAssetCount).toBe(900);
    expect(alpha.isolatedAssetCount).toBe(39_100);

    // s2 is not, and is sized live rather than reported as an empty source.
    const beta = result.sources.find((s) => s.id === 's2')!;
    expect(beta.assetCount).toBe(7);
    expect(beta.isolatedAssetCount).toBe(7);

    // Only the missing source is counted live.
    expect(prisma.asset.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceId: { in: ['s2'] } } }),
    );
  });

  it('does not count live at all when every source is in the rollup', async () => {
    const sourceGraph = {
      getFreshness: jest.fn().mockResolvedValue({
        refreshedAt: new Date(),
        durationMs: 1,
        isBuilt: true,
      }),
      readMap: jest.fn().mockResolvedValue({
        nodes: sources.map((s) => ({
          sourceId: s.id,
          assetCount: 5,
          connectedAssetCount: 5,
          internalEdgeCount: 0,
          findingCount: 0,
          severityCounts: {},
        })),
        links: [],
        boundary: [],
        bundles: [],
      }),
    };

    const prisma = makePrisma();
    await new ConstellationService(
      asService(prisma),
      asService(sourceGraph),
      asService(scheduler),
    ).getMap();
    expect(prisma.asset.groupBy).not.toHaveBeenCalled();
    expect(prisma.finding.groupBy).not.toHaveBeenCalled();
  });
});
