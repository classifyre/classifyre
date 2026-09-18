import { NamespaceWorkerManager } from './namespace-worker-manager';

/**
 * A paused workspace runs nothing: the reconcile loop never auto-starts it
 * and stops it when the flip was handled by another process; the
 * pause-changed event stops/starts it on the process that handled the PATCH.
 */
describe('NamespaceWorkerManager pause handling', () => {
  const event = {
    namespaceId: 'n1',
    slug: 'paused-ws',
    schemaName: 'ns_abc',
  };

  const noop = () => undefined;
  const asyncNoop = () => Promise.resolve();

  const deps = (over: Record<string, unknown> = {}) => ({
    registry: {
      onDeleting: noop,
      onCreated: noop,
      onPauseChanged: noop,
      list: () => [],
    },
    pgBoss: {
      startForNamespace: jest.fn().mockResolvedValue({}),
      stopForNamespace: jest.fn().mockResolvedValue(undefined),
    },
    prismaManager: {
      pin: noop,
      unpin: noop,
      dropWhenIdle: asyncNoop,
      residentSchemas: () => [],
    },
    cls: { run: (fn: () => unknown) => fn(), set: noop },
    scheduler: { registerForNamespace: asyncNoop, clearForSchema: noop },
    autoSchedule: { registerForNamespace: asyncNoop },
    cleanup: { registerForNamespace: asyncNoop },
    matching: { registerForNamespace: asyncNoop },
    correlation: { registerForNamespace: asyncNoop },
    autopilot: { registerForNamespace: asyncNoop },
    supervisor: { registerForNamespace: asyncNoop },
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
    findingBulkOperations: { registerForNamespace: asyncNoop },
    findingStats: { registerForNamespace: asyncNoop },
    sourceGraph: { registerForNamespace: asyncNoop },
    runnerEvents: { stopForSchema: noop },
    notificationEvents: { stopForSchema: noop },
    prisma: {},
    leadership: { start: noop, isLeader: () => false },
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
      d.supervisor as never,
      d.embedding as never,
      d.embeddingService as never,
      d.embeddingCapability as never,
      d.chat as never,
      d.cliRunner as never,
      d.mcpClient as never,
      d.pgStream as never,
      d.dataTransfer as never,
      d.findingBulkOperations as never,
      d.findingStats as never,
      d.sourceGraph as never,
      d.runnerEvents as never,
      d.notificationEvents as never,
      d.leadership as never,
      d.prisma as never,
    );
    return { manager, deps: d };
  };

  const priv = (manager: NamespaceWorkerManager) =>
    manager as unknown as {
      reconcileNamespaces(): Promise<void>;
      applyPauseChanged(e: typeof event & { paused: boolean }): Promise<void>;
      start(e: typeof event): Promise<void>;
    };

  const pausedRow = {
    id: 'n1',
    slug: 'paused-ws',
    schemaName: 'ns_abc',
    paused: true,
  };
  const runningRow = { ...pausedRow, paused: false };

  it('reconcile never auto-starts a paused namespace', async () => {
    const { manager, deps: d } = build({
      registry: {
        onDeleting: noop,
        onCreated: noop,
        onPauseChanged: noop,
        list: () => Promise.resolve([pausedRow]),
      },
    });

    await priv(manager).reconcileNamespaces();

    expect(d.pgBoss.startForNamespace).not.toHaveBeenCalled();
  });

  it('reconcile stops a namespace that was paused elsewhere', async () => {
    const { manager, deps: d } = build({
      registry: {
        onDeleting: noop,
        onCreated: noop,
        onPauseChanged: noop,
        list: () => Promise.resolve([pausedRow]),
      },
    });
    await priv(manager).start(event);

    await priv(manager).reconcileNamespaces();

    expect(d.pgBoss.stopForNamespace).toHaveBeenCalledWith('ns_abc');
  });

  it('reconcile starts a resumed namespace again', async () => {
    const { manager, deps: d } = build({
      registry: {
        onDeleting: noop,
        onCreated: noop,
        onPauseChanged: noop,
        list: () => Promise.resolve([runningRow]),
      },
    });

    await priv(manager).reconcileNamespaces();

    expect(d.pgBoss.startForNamespace).toHaveBeenCalled();
  });

  it('bootstrap does not start a paused namespace', async () => {
    const { manager, deps: d } = build({
      registry: {
        onDeleting: noop,
        onCreated: noop,
        onPauseChanged: noop,
        list: () => Promise.resolve([pausedRow]),
      },
      leadership: { start: noop, isLeader: () => false },
    });

    await manager.onApplicationBootstrap();
    await manager.onApplicationShutdown();

    expect(d.pgBoss.startForNamespace).not.toHaveBeenCalled();
  });

  it('the pause event stops workers, the resume event starts them', async () => {
    const { manager, deps: d } = build();
    await priv(manager).start(event);
    expect(d.pgBoss.startForNamespace).toHaveBeenCalledTimes(1);

    await priv(manager).applyPauseChanged({ ...event, paused: true });
    expect(d.pgBoss.stopForNamespace).toHaveBeenCalledWith('ns_abc');

    await priv(manager).applyPauseChanged({ ...event, paused: false });
    expect(d.pgBoss.startForNamespace).toHaveBeenCalledTimes(2);
  });
});
