import { FindingStatsWorker } from './finding-stats.worker';

describe('FindingStatsWorker', () => {
  const build = (overrides: Record<string, unknown> = {}) => {
    const work = jest.fn();
    const boss = { createQueue: jest.fn().mockResolvedValue(undefined) };
    const pgBoss = {
      getBossAsync: jest.fn().mockResolvedValue(boss),
      work,
    };
    const stats = {
      rebuildAll: jest.fn().mockResolvedValue(10),
      refreshDirtyDays: jest.fn().mockResolvedValue({ days: 1, total: 10 }),
      isUsable: jest.fn().mockResolvedValue(true),
      ...overrides,
    };
    const scheduler = { scheduleFull: jest.fn().mockResolvedValue(undefined) };
    return {
      worker: new FindingStatsWorker(
        pgBoss as never,
        stats as never,
        scheduler as never,
      ),
      work,
      stats,
      scheduler,
    };
  };

  /** Invoke the handler the worker registered with pg-boss. */
  const runHandler = async (
    work: jest.Mock,
    jobs: Array<Record<string, unknown>>,
  ) => {
    const handler = work.mock.calls[0]![2] as (j: unknown[]) => Promise<void>;
    await handler(jobs.map((data) => ({ data })));
  };

  it('runs one refresh for a coalesced batch, not one per job', async () => {
    const { worker, work, stats } = build();
    await worker.registerForNamespace();

    await runHandler(work, [{ reason: 'a' }, { reason: 'b' }, { reason: 'c' }]);

    expect(stats.refreshDirtyDays).toHaveBeenCalledTimes(1);
  });

  it('lets a full rebuild supersede incremental requests in the batch', async () => {
    const { worker, work, stats } = build();
    await worker.registerForNamespace();

    await runHandler(work, [{ reason: 'ingest' }, { full: true }]);

    expect(stats.rebuildAll).toHaveBeenCalledTimes(1);
    expect(stats.refreshDirtyDays).not.toHaveBeenCalled();
  });

  it('serialises refreshes so two never race on the same day', async () => {
    const { worker, work } = build();
    await worker.registerForNamespace();

    expect(work.mock.calls[0]![1]).toMatchObject({ localConcurrency: 1 });
  });

  it('escalates an incremental request to a full build when none exists', async () => {
    const { worker, work, stats } = build({
      isUsable: jest.fn().mockResolvedValue(false),
    });
    await worker.registerForNamespace();

    await runHandler(work, [{ reason: 'ingest' }]);

    // An incremental pass only fills the days it was told about; running it
    // against an unbuilt rollup would leave every other day missing and then
    // advertise the result as current.
    expect(stats.rebuildAll).toHaveBeenCalledTimes(1);
    expect(stats.refreshDirtyDays).not.toHaveBeenCalled();
  });

  it('builds the rollup once when a workspace has never had one', async () => {
    const { worker, scheduler } = build({
      isUsable: jest.fn().mockResolvedValue(false),
    });

    await worker.registerForNamespace();

    expect(scheduler.scheduleFull).toHaveBeenCalledWith(
      'first build after migration',
    );
  });

  it('does not rebuild a workspace whose rollup already exists', async () => {
    const { worker, scheduler } = build();

    await worker.registerForNamespace();

    expect(scheduler.scheduleFull).not.toHaveBeenCalled();
  });
});
