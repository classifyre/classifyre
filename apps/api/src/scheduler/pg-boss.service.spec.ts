import {
  PgBossService,
  QueuePausedError,
  isConnectionGone,
} from './pg-boss.service';
import {
  CLS_NAMESPACE_ID,
  CLS_SCHEMA,
  CLS_SLUG,
} from '../namespace/namespace.constants';
import type { PausedQueuesSnapshot } from './worker-queue-registry.service';

const SCHEMA = 'ns_test';
const NAMESPACE_ID = 'nid-1';
const SLUG = 'test';
const QUEUE = 'reap-orphaned-cli-jobs';

type BatchHandler = (jobs: unknown[]) => Promise<unknown>;

function harness() {
  const store: Record<string, string> = {
    [CLS_SCHEMA]: SCHEMA,
    [CLS_NAMESPACE_ID]: NAMESPACE_ID,
    [CLS_SLUG]: SLUG,
  };
  const cls = {
    get: jest.fn((key: string) => store[key]),
    set: jest.fn(),
    run: jest.fn((fn: () => unknown) => fn()),
  };
  const concurrency = {
    setWaitObserver: jest.fn(),
    withSlot: jest.fn((_identity: unknown, operation: () => Promise<unknown>) =>
      operation(),
    ),
  };
  let paused = false;
  const registry = {
    register: jest.fn(),
    markWaiting: jest.fn(),
    markRunning: jest.fn(),
    markFinished: jest.fn(),
    isPaused: jest.fn(() => paused),
    setPaused: (value: boolean) => {
      paused = value;
    },
    onPausesRefreshed: jest.fn(
      (_observer: (paused: PausedQueuesSnapshot) => unknown): void => undefined,
    ),
    listPaused: jest.fn(() => Promise.resolve(new Set<string>())),
  };
  const handlers: BatchHandler[] = [];
  const boss = {
    work: jest.fn(
      (
        _queue: string,
        _options: Record<string, unknown>,
        handler: BatchHandler,
      ): Promise<string> => {
        handlers.push(handler);
        return Promise.resolve('worker-1');
      },
    ),
    offWork: jest.fn(() => Promise.resolve()),
    stop: jest.fn(() => Promise.resolve()),
    getDb: jest.fn(() => ({
      executeSql: jest.fn(() => Promise.resolve({ rows: [] })),
    })),
  };
  const service = new PgBossService(
    cls as any,
    concurrency as any,
    registry as any,
  );
  (service as any).bosses.set(SCHEMA, boss);
  const pauseObserver = registry.onPausesRefreshed.mock.calls[0]?.[0];
  const firePauseRefresh = (queues: string[]) =>
    pauseObserver(
      queues.map((queue) => ({ namespaceId: NAMESPACE_ID, queue })),
    );
  const wrapped = () => handlers[0];
  return {
    service,
    cls,
    concurrency,
    registry,
    boss,
    pauseObserver,
    firePauseRefresh,
    wrapped,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('PgBossService pause holds work', () => {
  it('runs jobs normally while the queue is unpaused', async () => {
    const { service, boss, concurrency, registry, wrapped } = harness();
    const handler = jest.fn(() => Promise.resolve('done'));

    const workerId = await service.work(
      QUEUE,
      { localConcurrency: 1 },
      handler as any,
    );

    expect(workerId).toBe('worker-1');
    expect(boss.work).toHaveBeenCalledTimes(1);
    expect(boss.offWork).not.toHaveBeenCalled();

    const job = { id: 'job-1' };
    await wrapped()([job]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith([job]);
    expect(concurrency.withSlot).toHaveBeenCalledTimes(1);
    expect(registry.markRunning).toHaveBeenCalledWith(
      { namespaceId: NAMESPACE_ID, queue: QUEUE },
      ['job-1'],
    );
    expect(registry.markFinished).toHaveBeenCalledWith({
      namespaceId: NAMESPACE_ID,
      queue: QUEUE,
    });
  });

  it('stops fetching on pause and re-subscribes on resume', async () => {
    const { service, boss, firePauseRefresh } = harness();
    const handler = jest.fn(() => Promise.resolve());

    await service.work(QUEUE, { localConcurrency: 1 }, handler as any);
    await firePauseRefresh([QUEUE]);

    expect(boss.offWork).toHaveBeenCalledTimes(1);
    expect(boss.offWork).toHaveBeenCalledWith(QUEUE);

    await firePauseRefresh([]);

    expect(boss.work).toHaveBeenCalledTimes(2);
    expect(boss.work).toHaveBeenNthCalledWith(
      2,
      QUEUE,
      expect.anything(),
      expect.any(Function),
    );
  });

  it('parks a fetched batch while paused and runs it after resume without failing', async () => {
    const { service, boss, concurrency, registry, firePauseRefresh, wrapped } =
      harness();
    const handler = jest.fn(() => Promise.resolve('done'));

    await service.work(QUEUE, { localConcurrency: 1 }, handler as any);
    await firePauseRefresh([QUEUE]);
    registry.setPaused(true);

    // Fetched in the race between the pause landing and the unsubscribe.
    const parked = wrapped()([{ id: 'job-1' }]);
    await sleep(600);

    // Held: no slot taken, no retry burned (nothing thrown), handler waiting.
    expect(handler).not.toHaveBeenCalled();
    expect(concurrency.withSlot).not.toHaveBeenCalled();

    registry.setPaused(false);
    await firePauseRefresh([]);
    await parked;

    expect(handler).toHaveBeenCalledTimes(1);
    expect(concurrency.withSlot).toHaveBeenCalledTimes(1);
    expect(boss.work).toHaveBeenCalledTimes(2);
  });

  it('gives up with a retryable error only past the hold cap', async () => {
    const { service, registry, wrapped } = harness();
    const handler = jest.fn(() => Promise.resolve());
    jest.useFakeTimers();
    try {
      await service.work(QUEUE, { localConcurrency: 1 }, handler as any);
      registry.setPaused(true);

      const parked = wrapped()([{ id: 'job-1' }]);
      const assertion = expect(parked).rejects.toBeInstanceOf(QueuePausedError);
      await jest.advanceTimersByTimeAsync(61_000);
      await assertion;

      expect(handler).not.toHaveBeenCalled();
      // The give-up throw happens before the slot wait, like the old
      // refuse-before-slot path: the batch never ran, so the registry keeps
      // whatever it showed rather than recording a failure.
      expect(registry.markFinished).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not fetch when the queue is already paused at registration', async () => {
    const { service, boss, registry, firePauseRefresh } = harness();
    registry.listPaused.mockResolvedValue(new Set([QUEUE]));
    const handler = jest.fn(() => Promise.resolve());

    await service.work(QUEUE, { localConcurrency: 1 }, handler as any);

    expect(boss.work).toHaveBeenCalledTimes(1);
    expect(boss.offWork).toHaveBeenCalledWith(QUEUE);

    await firePauseRefresh([]);

    expect(boss.work).toHaveBeenCalledTimes(2);
  });

  it('retries a failed unsubscribe on the next refresh', async () => {
    const { service, boss, firePauseRefresh } = harness();
    const handler = jest.fn(() => Promise.resolve());

    await service.work(QUEUE, { localConcurrency: 1 }, handler as any);
    boss.offWork.mockRejectedValueOnce(new Error('connection reset'));
    await firePauseRefresh([QUEUE]);
    expect(boss.offWork).toHaveBeenCalledTimes(1);

    await firePauseRefresh([QUEUE]);
    expect(boss.offWork).toHaveBeenCalledTimes(2);
  });

  it('forgets subscriptions when the namespace stops', async () => {
    const { service, boss, firePauseRefresh } = harness();
    const handler = jest.fn(() => Promise.resolve());

    await service.work(QUEUE, { localConcurrency: 1 }, handler as any);
    await service.stopForNamespace(SCHEMA);

    await firePauseRefresh([QUEUE]);

    expect(boss.offWork).not.toHaveBeenCalled();
  });
});

describe('isConnectionGone', () => {
  it('matches the pg-boss assertDb noise from dead instances', () => {
    // The exact error the field report saw repeating for idle namespaces.
    const assertDb = new Error('Database connection is not opened');
    assertDb.name = 'AssertionError [ERR_ASSERTION]';
    expect(isConnectionGone(assertDb)).toBe(true);
  });

  it.each([
    'Connection terminated unexpectedly',
    'Client has encountered a connection error and is not queryable',
    'read ECONNRESET',
    'connect ECONNREFUSED 127.0.0.1:5432',
  ])('treats %p as a gone connection', (message) => {
    expect(isConnectionGone(new Error(message))).toBe(true);
  });

  it.each([
    'remaining connection slots are reserved for superusers',
    'duplicate key value violates unique constraint',
    'timeout expired',
  ])('keeps the instance on %p', (message) => {
    // "too many clients" is a server-side ceiling, not a dead boss:
    // restarting the instance would not free a single connection.
    expect(isConnectionGone(new Error(message))).toBe(false);
  });
});
