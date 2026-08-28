import { CorrelationService } from './correlation.service';

/**
 * A recompute must never assemble a graph.
 *
 * Building one walks every node and edge in the namespace — 61k nodes and 272k
 * edges on a real corpus, over 2 GB of live JS objects. Doing that inside a
 * recompute meant a single changed asset rebuilt the whole graph, and a scan
 * ingesting steadily did it per batch: the API died of "Ineffective
 * mark-compacts near heap limit" at 2041 MB of a 2144 MB ceiling until the
 * restart budget ran out.
 *
 * The unscoped graph and its snapshot cache are gone; `buildGraphFromDatabase`
 * survives only for one asset or one source. These tests pin the seam that
 * matters — a recompute rolls up into the review index and does not build
 * anything — because the expensive call is one line and reads as harmless.
 */
describe('recompute → review index', () => {
  function harness(
    refresh: jest.Mock = jest.fn().mockResolvedValue(undefined),
  ) {
    const correlationLock = {
      runExclusive: jest.fn(<T>(operation: () => Promise<T>) => operation()),
    };
    const reviewIndex = { refresh };

    const service = Object.create(
      CorrelationService.prototype,
    ) as CorrelationService;
    Object.assign(service, {
      correlationLock,
      reviewIndex,
      // Would assemble a graph. Calling it at all is the regression.
      buildGraphFromDatabase: jest.fn(() => {
        throw new Error('buildGraphFromDatabase must not run during recompute');
      }),
      recompute: jest.fn().mockResolvedValue({ assetsProcessed: 1 }),
      recomputeAllUnlocked: jest.fn().mockResolvedValue({ assetsProcessed: 9 }),
      prisma: {
        asset: { findMany: jest.fn().mockResolvedValue([{ id: 'a1' }]) },
      },
    });

    return { service, correlationLock, reviewIndex };
  }

  it('does not build a graph for a single asset', async () => {
    const h = harness();
    await expect(h.service.recomputeForAsset('asset-1')).resolves.toEqual({
      assetsProcessed: 1,
    });
  });

  it('does not build a graph for a batch of assets', async () => {
    const h = harness();
    await expect(
      h.service.recomputeForAssets(['a', 'b', 'b']),
    ).resolves.toEqual({ assetsProcessed: 1 });
  });

  it('does not build a graph after a full recompute', async () => {
    const h = harness();
    await expect(h.service.recomputeAll()).resolves.toEqual({
      assetsProcessed: 9,
    });
  });

  it('does not build a graph after a runner finishes', async () => {
    const h = harness();
    await expect(
      h.service.recomputeForRunner('source-1', 'runner-1'),
    ).resolves.toEqual({ assetsProcessed: 1 });
  });

  it('runs the recompute under the exclusive lock', async () => {
    const h = harness();
    await h.service.recomputeForAsset('asset-1');
    expect(h.correlationLock.runExclusive).toHaveBeenCalledTimes(1);
  });
});
