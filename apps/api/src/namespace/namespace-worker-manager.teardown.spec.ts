import { NamespaceWorkerManager } from './namespace-worker-manager';

/**
 * Teardown must never replace the error that caused it.
 *
 * `start()` calls `stop()` from its own catch block. Each teardown call carried
 * `.catch(() => undefined)`, which handles a rejection but not a synchronous
 * throw — there is no promise yet to attach to. So a provider missing a method
 * (a partial test double, a half-constructed provider) threw straight out of
 * `stop()` and became the reported failure.
 *
 * Observed in CI as two ERROR lines and no useful cause: the namespace worker
 * manager reported `TypeError: this.cliRunner.stopForSchema is not a function`,
 * while the actual problem was a stale database schema several layers away.
 */
describe('NamespaceWorkerManager teardown isolation', () => {
  const event = {
    namespaceId: 'n1',
    slug: 'e2e-tests',
    schemaName: 'ns_abc',
  };

  const noop = () => undefined;
  const asyncNoop = () => Promise.resolve();

  /** Every collaborator stop()/start() touches, all succeeding by default. */
  const deps = (over: Record<string, unknown> = {}) => ({
    registry: { onDeleting: noop, onCreated: noop, list: () => [] },
    pgBoss: {
      startForNamespace: asyncNoop,
      stopForNamespace: asyncNoop,
    },
    prismaManager: {
      pin: noop,
      unpin: noop,
      dropWhenIdle: asyncNoop,
    },
    cls: { run: (fn: () => unknown) => fn(), set: noop },
    scheduler: { registerForNamespace: asyncNoop, clearForSchema: noop },
    autoSchedule: { registerForNamespace: asyncNoop },
    cleanup: { registerForNamespace: asyncNoop },
    matching: { registerForNamespace: asyncNoop },
    correlation: { registerForNamespace: asyncNoop },
    autopilot: { registerForNamespace: asyncNoop },
    embedding: { registerForNamespace: asyncNoop, stopForSchema: asyncNoop },
    embeddingService: { clearForSchema: noop },
    embeddingCapability: { clearForSchema: noop },
    chat: { refresh: asyncNoop, stopForSchema: asyncNoop },
    cliRunner: {
      activateForSchema: noop,
      stopForSchema: asyncNoop,
    },
    mcpClient: { refresh: asyncNoop, stopForSchema: asyncNoop },
    pgStream: { dropForSchema: asyncNoop },
    dataTransfer: {
      registerForNamespace: asyncNoop,
      schedulePurge: noop,
      stopForSchema: asyncNoop,
    },
    findingStats: { registerForNamespace: asyncNoop },
    runnerEvents: { stopForSchema: noop },
    notificationEvents: { stopForSchema: noop },
    ...over,
  });

  const build = (over: Record<string, unknown> = {}) => {
    const d = deps(over);
    const manager = new NamespaceWorkerManager(
      d.registry as never,
      d.pgBoss as never,
      d.prismaManager as never,
      d.cls as never,
      d.scheduler as never,
      d.autoSchedule as never,
      d.cleanup as never,
      d.matching as never,
      d.correlation as never,
      d.autopilot as never,
      d.embedding as never,
      d.embeddingService as never,
      d.embeddingCapability as never,
      d.chat as never,
      d.cliRunner as never,
      d.mcpClient as never,
      d.pgStream as never,
      d.dataTransfer as never,
      d.findingStats as never,
      d.runnerEvents as never,
      d.notificationEvents as never,
    );
    return { manager, deps: d };
  };

  const stop = (manager: NamespaceWorkerManager) =>
    (manager as unknown as { stop(e: unknown): Promise<void> }).stop(event);
  const start = (manager: NamespaceWorkerManager) =>
    (manager as unknown as { start(e: unknown): Promise<void> }).start(event);

  it('survives a collaborator that is missing the method entirely', async () => {
    // The exact CI shape: a partial CliRunnerService double.
    const { manager } = build({ cliRunner: { activateForSchema: noop } });

    await expect(stop(manager)).resolves.toBeUndefined();
  });

  it('survives a collaborator that throws synchronously', async () => {
    const { manager } = build({
      runnerEvents: {
        stopForSchema: () => {
          throw new Error('gateway already closed');
        },
      },
    });

    await expect(stop(manager)).resolves.toBeUndefined();
  });

  it('survives a collaborator that rejects', async () => {
    const { manager } = build({
      pgBoss: {
        startForNamespace: asyncNoop,
        stopForNamespace: () => Promise.reject(new Error('boss is gone')),
      },
    });

    await expect(stop(manager)).resolves.toBeUndefined();
  });

  it('still runs every later step after an early one fails', async () => {
    const unpin = jest.fn();
    const dropForSchema = jest.fn().mockResolvedValue(undefined);
    const { manager } = build({
      cliRunner: {
        activateForSchema: noop,
        stopForSchema: () => {
          throw new TypeError('not a function');
        },
      },
      pgStream: { dropForSchema },
      prismaManager: { pin: noop, unpin, dropWhenIdle: asyncNoop },
    });

    // Register the namespace so the unpin branch is reachable.
    await start(manager).catch(() => undefined);
    unpin.mockClear();
    await start(manager).catch(() => undefined);
    await stop(manager);

    expect(dropForSchema).toHaveBeenCalledWith('ns_abc');
    expect(unpin).toHaveBeenCalledWith('ns_abc');
  });

  // The point of the whole fix: a start failure must report why it failed.
  it('reports the start failure, not a teardown failure', async () => {
    const { manager } = build({
      pgBoss: {
        startForNamespace: () =>
          Promise.reject(new Error('database schema is out of date')),
        stopForNamespace: asyncNoop,
      },
      // Partial double, exactly as in the e2e suite.
      cliRunner: { activateForSchema: noop },
    });

    await expect(start(manager)).rejects.toThrow(
      'database schema is out of date',
    );
  });

  it('pins worker database access to the background lane', async () => {
    const pin = jest.fn();
    const set = jest.fn();
    const { manager } = build({
      prismaManager: { pin, unpin: noop, dropWhenIdle: asyncNoop },
      cls: { run: (fn: () => unknown) => fn(), set },
    });

    await start(manager);

    expect(pin).toHaveBeenCalledWith('ns_abc', 'background');
    expect(set).toHaveBeenCalledWith('databaseLane', 'background');
  });
});
