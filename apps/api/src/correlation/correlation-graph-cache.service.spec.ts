import type { CorrelationGraphResult } from './correlation.service';
import { CorrelationGraphCacheService } from './correlation-graph-cache.service';

const GRAPH: CorrelationGraphResult = {
  nodes: [{ id: 'a1', type: 'asset', label: 'Asset', depth: 0 }],
  edges: [],
  similarities: [],
  truncated: false,
};

describe('CorrelationGraphCacheService', () => {
  function harness(initial: any = null) {
    let row = initial;
    let chain = Promise.resolve();
    const prisma = {
      // readPayloadJson goes through raw SQL to get `payload::text`, so the
      // fake answers in the driver's shape: snake_case columns, payload as the
      // JSON text Postgres would return.
      $queryRaw: jest.fn(() =>
        Promise.resolve(
          row
            ? [
                {
                  payload: row.payload ? JSON.stringify(row.payload) : null,
                  built_version: row.builtVersion,
                  requested_version: row.requestedVersion,
                },
              ]
            : [],
        ),
      ),
      correlationGraphSnapshot: {
        findUnique: jest.fn(() => Promise.resolve(row)),
        upsert: jest.fn(({ create, update }: any) => {
          if (!row) {
            row = {
              id: 1,
              requestedVersion: 1n,
              builtVersion: 0n,
              payload: null,
              ...create,
            };
          } else if (update.requestedVersion?.increment) {
            row = {
              ...row,
              ...update,
              requestedVersion:
                row.requestedVersion + update.requestedVersion.increment,
            };
          }
          return Promise.resolve(row);
        }),
        update: jest.fn(({ data }: any) => {
          row = { ...row, ...data };
          return Promise.resolve(row);
        }),
        updateMany: jest.fn(({ where, data }: any) => {
          if (row?.requestedVersion !== where.requestedVersion) {
            return Promise.resolve({ count: 0 });
          }
          row = { ...row, ...data };
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    const lock = {
      runExclusive: jest.fn(<T>(operation: () => Promise<T>) => {
        const result = chain.then(operation, operation);
        chain = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      }),
    };
    const jobs = {
      scheduleGraphRefresh: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new CorrelationGraphCacheService(
        prisma as never,
        lock as never,
        jobs as never,
      ),
      prisma,
      lock,
      jobs,
      row: () => row,
    };
  }

  describe('readPayloadJson', () => {
    it('returns the stored JSON as text, without parsing it', async () => {
      const h = harness({
        id: 1,
        requestedVersion: 4n,
        builtVersion: 4n,
        payload: GRAPH,
      });

      const json = await h.service.readPayloadJson();

      // A string, not an object: the whole point is that nothing between
      // Postgres and the socket materialises the graph as JS objects.
      expect(typeof json).toBe('string');
      expect(JSON.parse(json!)).toEqual(GRAPH);
      // And it never touched the Prisma model accessor, which would have.
      expect(
        h.prisma.correlationGraphSnapshot.findUnique,
      ).not.toHaveBeenCalled();
    });

    it('returns null when nothing has been published, so the caller can build', async () => {
      const h = harness(null);

      await expect(h.service.readPayloadJson()).resolves.toBeNull();
      expect(h.jobs.scheduleGraphRefresh).not.toHaveBeenCalled();
    });

    it('returns null when the row exists but has no payload', async () => {
      const h = harness({
        id: 1,
        requestedVersion: 1n,
        builtVersion: 0n,
        payload: null,
      });

      await expect(h.service.readPayloadJson()).resolves.toBeNull();
    });

    it('serves the last good snapshot and nudges refresh when stale', async () => {
      const h = harness({
        id: 1,
        requestedVersion: 5n,
        builtVersion: 4n,
        payload: GRAPH,
      });

      await expect(h.service.readPayloadJson()).resolves.toBe(
        JSON.stringify(GRAPH),
      );
      expect(h.jobs.scheduleGraphRefresh).toHaveBeenCalledWith(
        'stale graph read',
      );
    });

    it('does not schedule a refresh when the snapshot is current', async () => {
      const h = harness({
        id: 1,
        requestedVersion: 4n,
        builtVersion: 4n,
        payload: GRAPH,
      });

      await h.service.readPayloadJson();

      expect(h.jobs.scheduleGraphRefresh).not.toHaveBeenCalled();
    });
  });

  it('returns a warm snapshot without invoking the graph builder', async () => {
    const h = harness({
      id: 1,
      requestedVersion: 4n,
      builtVersion: 4n,
      payload: GRAPH,
    });
    const builder = jest.fn();

    await expect(h.service.getOrBuild(builder)).resolves.toEqual(GRAPH);

    expect(builder).not.toHaveBeenCalled();
    expect(h.lock.runExclusive).not.toHaveBeenCalled();
  });

  it('serves the last good snapshot and nudges refresh when stale', async () => {
    const h = harness({
      id: 1,
      requestedVersion: 5n,
      builtVersion: 4n,
      payload: GRAPH,
    });

    await expect(h.service.getOrBuild(jest.fn())).resolves.toEqual(GRAPH);

    expect(h.jobs.scheduleGraphRefresh).toHaveBeenCalledWith(
      'stale graph read',
    );
  });

  it('allows only one builder across concurrent cold requests', async () => {
    const h = harness();
    const builder = jest.fn(async () => {
      await Promise.resolve();
      return GRAPH;
    });

    const [first, second] = await Promise.all([
      h.service.getOrBuild(builder),
      h.service.getOrBuild(builder),
    ]);

    expect(first).toEqual(GRAPH);
    expect(second).toEqual(GRAPH);
    expect(builder).toHaveBeenCalledTimes(1);
    expect(h.row().payload).toEqual(GRAPH);
  });

  it('keeps the old payload when publication fails and schedules retry', async () => {
    const old = { ...GRAPH, nodes: [] };
    const h = harness({
      id: 1,
      requestedVersion: 2n,
      builtVersion: 2n,
      payload: old,
    });

    await h.service.publishAfterRecomputeLocked(
      () => Promise.reject(new Error('assembly failed')),
      'test recompute',
    );

    expect(h.row().payload).toEqual(old);
    expect(h.row().builtVersion).toBe(2n);
    expect(h.row().requestedVersion).toBe(3n);
    expect(h.row().lastError).toBe('assembly failed');
    expect(h.jobs.scheduleGraphRefresh).toHaveBeenCalledWith(
      'snapshot publication failed',
    );
  });
});
