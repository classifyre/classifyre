import { NamespaceWorkerManager } from './namespace-worker-manager';

/**
 * Cold mode must never break normal execution: active namespaces stay warm,
 * sleeping ones wake on the next scan, and anything unreadable fails closed.
 *
 * These tests drive the manager's private start/evaluateIdle with the same
 * collaborator doubles as the teardown spec, plus a controllable Prisma
 * double standing in for per-namespace Runner/Source rows.
 */
describe('NamespaceWorkerManager cold mode', () => {
  const event = {
    namespaceId: 'n1',
    slug: 'e2e-tests',
    schemaName: 'ns_abc',
  };

  const noop = () => undefined;
  const asyncNoop = () => Promise.resolve();

  /** Mutable per-namespace activity behind the Prisma double. */
  const activity = {
    runnersInFlight: 0,
    sourcesInFlight: 0,
    dirty: 0,
    planned: 0,
    latest: null as Date | null,
  };

  let namespaces: Array<{
    id: string;
    slug: string;
    schemaName: string;
  }>;
  let stopForNamespace: jest.Mock;
  let startForNamespace: jest.Mock;

  const savedEnv = { ...process.env };

  beforeEach(() => {
    namespaces = [{ id: 'n1', slug: 'e2e-tests', schemaName: 'ns_abc' }];
    activity.runnersInFlight = 0;
    activity.sourcesInFlight = 0;
    activity.dirty = 0;
    activity.planned = 0;
    activity.latest = null;
    stopForNamespace = jest.fn().mockResolvedValue(undefined);
    startForNamespace = jest.fn().mockResolvedValue(undefined);
    // A tiny idle window so "old" snapshots are decisively idle.
    process.env.NAMESPACE_COLD_MODE_ENABLED = 'true';
    process.env.NAMESPACE_IDLE_AFTER_DAYS = '0.001';
    delete process.env.NAMESPACE_IDLE_CHECK_MS;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  const deps = () => ({
    registry: {
      onDeleting: noop,
      onCreated: noop,
      list: () => Promise.resolve(namespaces),
    },
    pgBoss: { startForNamespace, stopForNamespace },
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
    cliRunner: { activateForSchema: noop, stopForSchema: asyncNoop },
    mcpClient: { refresh: asyncNoop, stopForSchema: asyncNoop },
    pgStream: { dropForSchema: asyncNoop },
    dataTransfer: {
      registerForNamespace: asyncNoop,
      schedulePurge: noop,
      stopForSchema: asyncNoop,
    },
    findingStats: { registerForNamespace: asyncNoop },
    sourceGraph: { registerForNamespace: asyncNoop },
    runnerEvents: { stopForSchema: noop },
    notificationEvents: { stopForSchema: noop },
    leadership: { start: noop, isLeader: () => false },
    prisma: {
      runner: {
        count: () => Promise.resolve(activity.runnersInFlight),
        findFirst: () =>
          Promise.resolve(
            activity.latest ? { triggeredAt: activity.latest } : null,
          ),
      },
      source: {
        // Three count() calls per snapshot; tell them apart by their filter.
        count: (args: { where?: Record<string, unknown> }) => {
          const where = args?.where ?? {};
          if ('runnerStatus' in where)
            return Promise.resolve(activity.sourcesInFlight);
          if ('autopilotDirtyAt' in where)
            return Promise.resolve(activity.dirty);
          return Promise.resolve(activity.planned);
        },
      },
    },
  });

  const build = () => {
    const d = deps();
    const values = [
      d.registry,
      d.pgBoss,
      d.prismaManager,
      d.cls,
      d.scheduler,
      d.autoSchedule,
      d.cleanup,
      d.matching,
      d.correlation,
      d.autopilot,
      d.supervisor,
      d.embedding,
      d.embeddingService,
      d.embeddingCapability,
      d.chat,
      d.cliRunner,
      d.mcpClient,
      d.pgStream,
      d.dataTransfer,
      d.findingStats,
      d.sourceGraph,
      d.runnerEvents,
      d.notificationEvents,
      d.leadership,
      d.prisma,
    ];
    return new NamespaceWorkerManager(
      ...(values as unknown as ConstructorParameters<
        typeof NamespaceWorkerManager
      >),
    );
  };

  const priv = (manager: NamespaceWorkerManager) =>
    manager as unknown as {
      start(e: unknown): Promise<void>;
      evaluateIdle(): Promise<void>;
      reconcileNamespaces(): Promise<void>;
      sleeping: Map<string, unknown>;
      active: Map<string, unknown>;
    };

  it('sleeps a scan-idle namespace and does not re-sleep it', async () => {
    const manager = build();
    const p = priv(manager);

    await p.start(event);
    expect(startForNamespace).toHaveBeenCalledTimes(1);

    await p.evaluateIdle();
    expect(stopForNamespace).toHaveBeenCalledWith('ns_abc');
    expect(p.sleeping.has('ns_abc')).toBe(true);
    expect(p.active.has('ns_abc')).toBe(false);

    await p.evaluateIdle();
    expect(stopForNamespace).toHaveBeenCalledTimes(1);
    expect(startForNamespace).toHaveBeenCalledTimes(1);
  });

  it('wakes a sleeping namespace when a scan appears', async () => {
    const manager = build();
    const p = priv(manager);

    await p.start(event);
    await p.evaluateIdle();
    expect(p.sleeping.has('ns_abc')).toBe(true);

    // A scan started while asleep: a fresh runner row is the wake signal.
    activity.latest = new Date();
    await p.evaluateIdle();

    expect(p.sleeping.has('ns_abc')).toBe(false);
    expect(startForNamespace).toHaveBeenCalledTimes(2);
  });

  it('never sleeps with scans in flight, dirty sources, or planned schedules', async () => {
    for (const state of [
      { runnersInFlight: 1 },
      { sourcesInFlight: 1 },
      { dirty: 2 },
      { planned: 1 },
    ]) {
      const manager = build();
      const p = priv(manager);
      await p.start(event);
      Object.assign(activity, {
        runnersInFlight: 0,
        sourcesInFlight: 0,
        dirty: 0,
        planned: 0,
        latest: new Date('2020-01-01T00:00:00Z'),
      });
      Object.assign(activity, state);
      stopForNamespace.mockClear();

      await p.evaluateIdle();

      expect(stopForNamespace).not.toHaveBeenCalled();
      expect(p.sleeping.has('ns_abc')).toBe(false);
      Object.assign(activity, {
        runnersInFlight: 0,
        sourcesInFlight: 0,
        dirty: 0,
        planned: 0,
        latest: null,
      });
    }
  });

  it('keeps a recently scanned namespace warm', async () => {
    const manager = build();
    const p = priv(manager);

    await p.start(event);
    activity.latest = new Date();
    await p.evaluateIdle();

    expect(stopForNamespace).not.toHaveBeenCalled();
    expect(p.sleeping.has('ns_abc')).toBe(false);
  });

  it('does nothing when cold mode is disabled', async () => {
    process.env.NAMESPACE_COLD_MODE_ENABLED = 'false';
    const manager = build();
    const p = priv(manager);

    await p.start(event);
    await p.evaluateIdle();

    expect(stopForNamespace).not.toHaveBeenCalled();
    expect(p.sleeping.has('ns_abc')).toBe(false);
  });

  it('fails closed when the activity snapshot cannot be read', async () => {
    const manager = build();
    const p = priv(manager);

    await p.start(event);
    // Simulate a mid-migration schema: every activity query throws.
    const d = manager as unknown as { prisma: unknown };
    d.prisma = {
      runner: {
        count: () => Promise.reject(new Error('relation does not exist')),
        findFirst: () => Promise.reject(new Error('relation does not exist')),
      },
      source: {
        count: () => Promise.reject(new Error('relation does not exist')),
      },
    };
    await p.evaluateIdle();

    expect(stopForNamespace).not.toHaveBeenCalled();
    expect(p.active.has('ns_abc')).toBe(true);
  });

  it('reconcile tears down a sleeping namespace that was deleted', async () => {
    const manager = build();
    const p = priv(manager);

    await p.start(event);
    await p.evaluateIdle();
    expect(p.sleeping.has('ns_abc')).toBe(true);

    namespaces = [];
    stopForNamespace.mockClear();
    await p.reconcileNamespaces();

    expect(stopForNamespace).toHaveBeenCalledWith('ns_abc');
    expect(p.sleeping.has('ns_abc')).toBe(false);
  });
});
