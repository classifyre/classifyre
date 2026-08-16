import { EmbeddingQueueService } from './embedding-queue.service';

/**
 * Reconciliation is paced by how deep the queue already is.
 *
 * The backfill walks every chunk in the corpus and enqueues whatever has no
 * vector, at every startup, as fast as the database will take it. Measured on
 * a live install: **~70,000 jobs enqueued per minute against ~3 completed**,
 * so a queue emptied by hand was back to half a million within six minutes.
 *
 * Depth is not cosmetic. pg-boss sorts the due backlog on every fetch, so a
 * deeper queue makes the consumer slower, which makes the queue deeper — the
 * fetch measured 9.9s at 1.1M deep against 115ms once drained. Left alone the
 * loop only ends when jobs age out and are deleted unprocessed, which is
 * silent loss of semantic coverage.
 *
 * Pacing keeps every chunk: the walk resumes where it left off and enqueues
 * the same work, just not all at once.
 */
describe('embedding backfill backpressure', () => {
  function harness(queuedCounts: number[], highWaterMark = 1000) {
    const stats = jest.fn(() =>
      Promise.resolve({ queuedCount: queuedCounts.shift() ?? 0 }),
    );
    const persisted: unknown[][] = [];
    const service = Object.create(EmbeddingQueueService.prototype) as {
      persistMissing: (rt: unknown, contents: unknown[]) => Promise<void>;
      awaitQueueCapacity: (rt: unknown) => Promise<void>;
    };
    Object.assign(service, {
      config: { queueHighWaterMark: highWaterMark },
      pgBoss: { getBossAsync: () => Promise.resolve({ getQueueStats: stats }) },
      embeddings: {
        missingHashes: jest.fn((hashes: string[]) => Promise.resolve(hashes)),
      },
      persist: jest.fn((work: unknown[]) => {
        persisted.push(work);
        return Promise.resolve();
      }),
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    return { service, stats, persisted };
  }

  const rt = { queueName: 'semantic-embeddings-space-1', spaceId: 'space-1' };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('enqueues immediately when the queue has room', async () => {
    const h = harness([10]);

    await h.service.awaitQueueCapacity(rt);

    expect(h.stats).toHaveBeenCalledTimes(1);
  });

  it('waits while the queue is at the limit, then continues', async () => {
    const h = harness([5000, 4000, 10]); // full, still full, drained

    const waiting = h.service.awaitQueueCapacity(rt);
    await jest.advanceTimersByTimeAsync(15_000);
    await waiting;

    expect(h.stats).toHaveBeenCalledTimes(3);
  });

  it('logs the pause once, not once per poll', async () => {
    // A long hold is normal on a large corpus; it should read as pacing.
    const h = harness([5000, 5000, 5000, 1]);

    const waiting = h.service.awaitQueueCapacity(rt);
    await jest.advanceTimersByTimeAsync(20_000);
    await waiting;

    expect((h.service as any).logger.log).toHaveBeenCalledTimes(1);
  });

  it('stops waiting when the runtime is disposed', async () => {
    // Shutdown must not be held up by a queue that never drains.
    const h = harness([5000, 5000]);
    const disposable = { ...rt, disposed: false };

    const waiting = h.service.awaitQueueCapacity(disposable);
    disposable.disposed = true;
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(waiting).resolves.toBeUndefined();
  });

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['negative', -1],
    ['not a number', 'lots'],
  ])('never waits forever on a %s limit', async (_label, limit) => {
    // Pacing is an optimisation; work must never block on a bad setting.
    const h = harness([999999]);
    // Assigned after construction so `undefined` is genuinely undefined
    // rather than falling back to the harness default.
    (h.service as any).config.queueHighWaterMark = limit;

    await expect(h.service.awaitQueueCapacity(rt)).resolves.toBeUndefined();
    expect(h.stats).not.toHaveBeenCalled();
  });

  it('proceeds rather than stalling when depth cannot be read', async () => {
    const h = harness([]);
    (h.service as any).pgBoss.getBossAsync = () =>
      Promise.reject(new Error('boss unavailable'));

    await expect(h.service.awaitQueueCapacity(rt)).resolves.toBeUndefined();
  });

  it('does not consult the queue when nothing is missing', async () => {
    // Every hash already has a vector: no enqueue, so no reason to wait.
    const h = harness([10]);
    (h.service as any).embeddings.missingHashes = jest.fn(() =>
      Promise.resolve([]),
    );

    await h.service.persistMissing(rt, [{ hash: 'h1', text: 'text' }]);

    expect(h.stats).not.toHaveBeenCalled();
    expect(h.persisted).toHaveLength(0);
  });

  it('still enqueues the missing chunks once there is room', async () => {
    const h = harness([10]);

    await h.service.persistMissing(rt, [
      { hash: 'h1', text: 'one' },
      { hash: 'h2', text: 'two' },
    ]);

    expect(h.persisted).toEqual([
      [
        { hash: 'h1', text: 'one' },
        { hash: 'h2', text: 'two' },
      ],
    ]);
  });
});
