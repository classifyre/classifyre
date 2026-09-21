import { EmbeddingQueueService } from './embedding-queue.service';

jest.mock('../service-role', () => ({ runsBackgroundWorkers: () => true }));

/**
 * Turning embeddings back on can leave a worker process serving nothing: it
 * booted while they were off and never registered, or "off and delete"
 * dropped the space its queues were named after. A released queue hold
 * resumes only existing subscriptions, so the worker has to notice and
 * re-bind — and catch up on what was scanned while off.
 */
describe('EmbeddingQueueService.reconcileWorker', () => {
  const SCHEMA = 'ns_test';

  const build = (over: {
    enabled: boolean;
    changedAt?: Date | null;
    activeSpace?: string | null;
    runtime?: Record<string, unknown>;
    subscribed?: boolean;
  }) => {
    let state = {
      enabled: over.enabled,
      changedAt: over.changedAt ?? null,
    };
    const settings = {
      switchState: jest.fn(() => Promise.resolve(state)),
      enabledNow: jest.fn(() => Promise.resolve(state.enabled)),
      clearForSchema: jest.fn(),
      cached: () => ({ enabled: state.enabled, autoBackfill: false }),
    };
    const prisma = {
      embeddingSpace: {
        findFirst: jest.fn(() =>
          Promise.resolve(over.activeSpace ? { id: over.activeSpace } : null),
        ),
      },
    };
    const pgBoss = {
      hasSubscription: jest.fn(() => over.subscribed ?? false),
      unsubscribe: jest.fn(() => Promise.resolve()),
    };
    const embeddings = { clearForSchema: jest.fn() };
    const register = jest.fn(() => Promise.resolve());
    const backfill = jest.fn(() => ({ started: true, spaceId: 's-new' }));
    const service = Object.create(
      EmbeddingQueueService.prototype,
    ) as EmbeddingQueueService & Record<string, any>;
    Object.assign(service, {
      logger: { log: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      runtimes: new Map(over.runtime ? [[SCHEMA, over.runtime]] : []),
      switchSeen: new Map(),
      reconcileErrors: new Map(),
      settings,
      prisma,
      pgBoss,
      embeddings,
      cls: { get: () => SCHEMA },
      registerForNamespace: register,
      requestBackfill: backfill,
    });
    return {
      service,
      settings,
      pgBoss,
      embeddings,
      register,
      backfill,
      flip: (next: typeof state) => {
        state = next;
      },
    };
  };

  it('does nothing while off (the queue hold stops the workers)', async () => {
    const h = build({ enabled: false });

    await h.service.reconcileWorker();

    expect(h.register).not.toHaveBeenCalled();
  });

  it('leaves a worker alone that already serves the active space', async () => {
    const h = build({
      enabled: true,
      activeSpace: 's1',
      runtime: {
        workerRegistered: true,
        queueName: 'semantic-embeddings-s1',
        spaceId: 's1',
      },
      subscribed: true,
    });

    await h.service.reconcileWorker();

    expect(h.register).not.toHaveBeenCalled();
    expect(h.backfill).not.toHaveBeenCalled();
  });

  it('registers a worker that booted while embeddings were off', async () => {
    const h = build({ enabled: false });
    await h.service.reconcileWorker(); // first look, off

    h.flip({ enabled: true, changedAt: new Date() });
    await h.service.reconcileWorker();

    expect(h.register).toHaveBeenCalledTimes(1);
    // Turned back on since the last look: catch up on what was scanned.
    expect(h.backfill).toHaveBeenCalled();
  });

  it('re-binds to the new space after the old one was deleted', async () => {
    const h = build({
      enabled: true,
      activeSpace: 's2',
      runtime: {
        workerRegistered: true,
        queueName: 'semantic-embeddings-s1',
        recalibrateQueueName: 'semantic-recalibrate-s1',
        spaceId: 's1',
      },
      subscribed: true,
    });

    await h.service.reconcileWorker();

    expect(h.pgBoss.unsubscribe).toHaveBeenCalledWith('semantic-embeddings-s1');
    expect(h.pgBoss.unsubscribe).toHaveBeenCalledWith(
      'semantic-recalibrate-s1',
    );
    expect(h.embeddings.clearForSchema).toHaveBeenCalledWith(SCHEMA);
    expect(h.settings.clearForSchema).toHaveBeenCalledWith(SCHEMA);
    expect(h.register).toHaveBeenCalledTimes(1);
  });

  it('catches up when the process that flipped the switch asks it to', async () => {
    const h = build({
      enabled: true,
      activeSpace: 's1',
      runtime: {
        workerRegistered: true,
        queueName: 'semantic-embeddings-s1',
        spaceId: 's1',
      },
      subscribed: true,
    });

    await h.service.reconcileWorker({ catchUp: true });

    expect(h.register).not.toHaveBeenCalled();
    expect(h.backfill).toHaveBeenCalled();
  });

  it('reports no pending analysis while off, whatever the backlog', async () => {
    const h = build({ enabled: false });
    Object.assign(h.service, {
      status: jest.fn().mockResolvedValue({ pendingEmbedJobs: 500 }),
    });

    await expect(h.service.analysisPending()).resolves.toBe(false);

    h.flip({ enabled: true, changedAt: null });
    await expect(h.service.analysisPending()).resolves.toBe(true);
  });
});
