import { WorkerQueueRegistryService } from './worker-queue-registry.service';
import { WORKER_HEARTBEAT_STALE_MS } from './worker-queue-state.sql';

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

function fakePool(query: QueryFn) {
  return { query: jest.fn(query), end: jest.fn(() => Promise.resolve()) };
}

function stateRow(overrides: Record<string, unknown> = {}) {
  return {
    instance_id: 'worker-1:7',
    namespace_id: '00000000-0000-0000-0000-000000000001',
    queue: 'embedding',
    status: 'running',
    active_jobs: 2,
    job_ids: ['job-a', 'job-b'],
    started_at: new Date().toISOString(),
    last_finished_at: null,
    last_duration_ms: null,
    run_count: 5,
    failure_count: 1,
    last_error: null,
    last_error_at: null,
    heartbeat_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('WorkerQueueRegistryService', () => {
  const namespaceId = '00000000-0000-0000-0000-000000000001';

  function serviceWith(query: QueryFn) {
    const service = new WorkerQueueRegistryService();
    const pool = fakePool(query);
    (service as any).pool = pool;
    return { service, pool };
  }

  it('reports a registered queue as idle before any job runs', async () => {
    const captured: unknown[][] = [];
    const { service } = serviceWith((sql, params) => {
      if (sql.includes('INSERT INTO public.worker_queue_state')) {
        captured.push(params as unknown[]);
      }
      return Promise.resolve({ rows: [] });
    });

    service.register({ namespaceId, queue: 'embedding' });
    await service.flush();

    expect(captured).toHaveLength(1);
    expect(captured[0]?.[2]).toBe('embedding');
    expect(captured[0]?.[3]).toBe('idle');
  });

  it('tracks the waiting/running/idle transitions of a batch', async () => {
    const statuses: unknown[] = [];
    const { service } = serviceWith((sql, params) => {
      if (sql.includes('INSERT INTO public.worker_queue_state')) {
        statuses.push((params as unknown[])[3]);
      }
      return Promise.resolve({ rows: [] });
    });
    const key = { namespaceId, queue: 'autopilot' };

    service.register(key);
    service.markWaiting(key);
    await service.flush();
    service.markRunning(key, ['job-1']);
    await service.flush();
    service.markFinished(key);
    await service.flush();

    expect(statuses).toEqual(['waiting_slot', 'running', 'idle']);
  });

  it('remembers the last failure without losing the run counter', async () => {
    let lastParams: unknown[] = [];
    const { service } = serviceWith((sql, params) => {
      if (sql.includes('INSERT INTO public.worker_queue_state')) {
        lastParams = params as unknown[];
      }
      return Promise.resolve({ rows: [] });
    });
    const key = { namespaceId, queue: 'correlation' };

    service.markRunning(key, ['job-1']);
    service.markFinished(key, new Error('boom'));
    await service.flush();

    expect(lastParams[3]).toBe('failed');
    expect(lastParams[9]).toBe(1); // run_count
    expect(lastParams[10]).toBe(1); // failure_count
    expect(lastParams[11]).toBe('boom');
  });

  // An OOM-killed pod never writes a terminal status, so without a staleness
  // cutoff its row claims to be running forever — exactly the false
  // reassurance this view exists to remove.
  it('downgrades a row whose heartbeat has gone quiet to stale', async () => {
    const { service } = serviceWith((sql) => {
      if (sql.includes('FROM public.worker_queue_state')) {
        return Promise.resolve({
          rows: [
            stateRow({
              heartbeat_at: new Date(
                Date.now() - WORKER_HEARTBEAT_STALE_MS - 5_000,
              ).toISOString(),
            }),
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const [row] = await service.listRows(namespaceId);

    expect(row?.status).toBe('stale');
    expect(row?.activeJobs).toBe(0);
    expect(row?.jobIds).toEqual([]);
  });

  it('believes a row that is still beating', async () => {
    const { service } = serviceWith((sql) => {
      if (sql.includes('FROM public.worker_queue_state')) {
        return Promise.resolve({ rows: [stateRow()] });
      }
      return Promise.resolve({ rows: [] });
    });

    const [row] = await service.listRows(namespaceId);

    expect(row?.status).toBe('running');
    expect(row?.activeJobs).toBe(2);
  });

  it('marks a queue paused for readers as well as for handlers', async () => {
    const { service, pool } = serviceWith(() => Promise.resolve({ rows: [] }));

    await service.setPaused({ namespaceId, queue: 'embedding' }, true);

    expect(service.isPaused({ namespaceId, queue: 'embedding' })).toBe(true);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO public.worker_queue_pauses'),
      [namespaceId, 'embedding'],
    );

    await service.setPaused({ namespaceId, queue: 'embedding' }, false);
    expect(service.isPaused({ namespaceId, queue: 'embedding' })).toBe(false);
  });

  it('refreshes the pause cache from the database on every flush', async () => {
    const { service } = serviceWith((sql) => {
      if (sql.includes('FROM public.worker_queue_pauses')) {
        return Promise.resolve({
          rows: [{ namespace_id: namespaceId, queue: 'embedding' }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    service.register({ namespaceId, queue: 'embedding' });
    expect(service.isPaused({ namespaceId, queue: 'embedding' })).toBe(false);

    await service.flush();

    expect(service.isPaused({ namespaceId, queue: 'embedding' })).toBe(true);
  });

  // Observability failing must never be able to take a worker down with it.
  it('swallows flush failures', async () => {
    const { service } = serviceWith(() =>
      Promise.reject(new Error('connection refused')),
    );
    service.register({ namespaceId, queue: 'embedding' });

    await expect(service.flush()).resolves.toBeUndefined();
  });
});
