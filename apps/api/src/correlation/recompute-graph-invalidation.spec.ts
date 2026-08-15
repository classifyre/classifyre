import { CorrelationService } from './correlation.service';

/**
 * A recompute must mark the graph stale, never rebuild it inline.
 *
 * Rebuilding assembles every node and edge in the namespace — 61k nodes and
 * 272k edges on a real corpus, over 2 GB of live JS objects. Doing that inside
 * every recompute meant a single changed asset rebuilt the whole graph, and a
 * scan ingesting steadily did it per batch, with no coalescing anywhere: the
 * refresh window only ever throttled the `refreshGraph` job, and this path
 * never enqueued one. The API died of "Ineffective mark-compacts near heap
 * limit" at 2041 MB of a 2144 MB ceiling until the restart budget ran out.
 *
 * These tests pin the contract at the seam that matters — what a recompute
 * asks the cache to do — because the expensive call is one line and reads as
 * harmless.
 */
describe('recompute → graph snapshot', () => {
  function harness() {
    const graphCache = {
      invalidate: jest.fn().mockResolvedValue(undefined),
      getOrBuild: jest.fn(),
      refreshIfStale: jest.fn(),
      readPayloadJson: jest.fn(),
    };
    const correlationLock = {
      runExclusive: jest.fn(<T>(operation: () => Promise<T>) => operation()),
    };

    const service = Object.create(
      CorrelationService.prototype,
    ) as CorrelationService;
    Object.assign(service, {
      graphCache,
      correlationLock,
      // Would assemble the whole graph. Calling it at all is the regression.
      buildGraphFromDatabase: jest.fn(() => {
        throw new Error('buildGraphFromDatabase must not run during recompute');
      }),
      recompute: jest.fn().mockResolvedValue({ assetsProcessed: 1 }),
      recomputeAllUnlocked: jest.fn().mockResolvedValue({ assetsProcessed: 9 }),
      prisma: {
        asset: { findMany: jest.fn().mockResolvedValue([{ id: 'a1' }]) },
      },
    });

    return { service, graphCache, correlationLock };
  }

  it('invalidates instead of building for a single asset', async () => {
    const h = harness();

    await h.service.recomputeForAsset('asset-1');

    expect(h.graphCache.invalidate).toHaveBeenCalledTimes(1);
    expect(h.graphCache.invalidate).toHaveBeenCalledWith('asset:asset-1');
  });

  it('invalidates instead of building for a batch of assets', async () => {
    const h = harness();

    await h.service.recomputeForAssets(['a', 'b', 'b']);

    expect(h.graphCache.invalidate).toHaveBeenCalledWith('assets:2');
  });

  it('invalidates instead of building after a full recompute', async () => {
    const h = harness();

    await h.service.recomputeAll();

    expect(h.graphCache.invalidate).toHaveBeenCalledWith('full recompute');
  });

  it('invalidates instead of building after a runner finishes', async () => {
    const h = harness();

    await h.service.recomputeForRunner('source-1', 'runner-1');

    expect(h.graphCache.invalidate).toHaveBeenCalledWith('runner:runner-1');
  });

  it('does not hold the correlation lock across the invalidation', async () => {
    // Invalidation is a version bump plus an enqueue. Holding the write lock
    // across that queues every other recompute behind queue I/O.
    const h = harness();
    let lockHeld = false;
    h.correlationLock.runExclusive.mockImplementation(
      async <T>(operation: () => Promise<T>) => {
        lockHeld = true;
        const result = await operation();
        lockHeld = false;
        return result;
      },
    );
    h.graphCache.invalidate.mockImplementation(() => {
      expect(lockHeld).toBe(false);
      return Promise.resolve();
    });

    await h.service.recomputeForAsset('asset-1');

    expect(h.graphCache.invalidate).toHaveBeenCalled();
  });

  it('still returns the recompute summary to the caller', async () => {
    const h = harness();

    await expect(h.service.recomputeForAsset('asset-1')).resolves.toEqual({
      assetsProcessed: 1,
    });
  });
});
