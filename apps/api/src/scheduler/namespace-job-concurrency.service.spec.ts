import { NamespaceJobConcurrencyService } from './namespace-job-concurrency.service';

type HeldLocks = Set<string>;

function fakePool(held: HeldLocks) {
  return {
    connect: jest.fn(() => {
      const owned = new Set<string>();
      return {
        query: jest.fn((sql: string, params: [number, number, number]) => {
          const key = `${params[0]}:${params[1] + params[2]}`;
          if (sql.includes('pg_try_advisory_lock')) {
            if (held.has(key))
              return Promise.resolve({ rows: [{ acquired: false }] });
            held.add(key);
            owned.add(key);
            return Promise.resolve({ rows: [{ acquired: true }] });
          }
          if (sql.includes('pg_advisory_unlock')) {
            held.delete(key);
            owned.delete(key);
          }
          return Promise.resolve({ rows: [{}] });
        }),
        release: jest.fn(() => {
          for (const key of owned) held.delete(key);
        }),
      };
    }),
    end: jest.fn(() => undefined),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('NamespaceJobConcurrencyService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      NAMESPACE_JOB_SLOT_RETRY_MS: '10',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to one global slot and serializes different replicas/namespaces', async () => {
    delete process.env.MAX_CONCURRENT_NAMESPACE_JOBS;
    const held = new Set<string>();
    const replicaA = new NamespaceJobConcurrencyService();
    const replicaB = new NamespaceJobConcurrencyService();
    (replicaA as any).pool = fakePool(held);
    (replicaB as any).pool = fakePool(held);

    const firstMayFinish = deferred();
    const firstStarted = deferred();
    const order: string[] = [];

    const first = replicaA.withSlot(
      { namespaceId: 'namespace-a', queue: 'queue-a' },
      async () => {
        order.push('a:start');
        firstStarted.resolve();
        await firstMayFinish.promise;
        order.push('a:end');
      },
    );
    await firstStarted.promise;

    const second = replicaB.withSlot(
      { namespaceId: 'namespace-b', queue: 'queue-b' },
      () => {
        order.push('b:start');
        order.push('b:end');
        return Promise.resolve();
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(order).toEqual(['a:start']);

    firstMayFinish.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    expect(held.size).toBe(0);
  });

  it('eventually processes five namespaces with a global limit of one', async () => {
    process.env.MAX_CONCURRENT_NAMESPACE_JOBS = '1';
    const held = new Set<string>();
    const replicas = [
      new NamespaceJobConcurrencyService(),
      new NamespaceJobConcurrencyService(),
    ];
    for (const replica of replicas) {
      (replica as any).pool = fakePool(held);
    }

    let active = 0;
    let maximumActive = 0;
    const completed: string[] = [];
    await Promise.all(
      Array.from({ length: 5 }, (_, index) => {
        const namespace = `namespace-${index + 1}`;
        return replicas[index % replicas.length].withSlot(
          { namespaceId: namespace, queue: 'shared-queue' },
          async () => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            completed.push(namespace);
            active -= 1;
          },
        );
      }),
    );

    expect(maximumActive).toBe(1);
    expect(completed.sort()).toEqual([
      'namespace-1',
      'namespace-2',
      'namespace-3',
      'namespace-4',
      'namespace-5',
    ]);
  });

  it('allows the configured number of jobs across replicas', async () => {
    process.env.MAX_CONCURRENT_NAMESPACE_JOBS = '2';
    const held = new Set<string>();
    const replicaA = new NamespaceJobConcurrencyService();
    const replicaB = new NamespaceJobConcurrencyService();
    (replicaA as any).pool = fakePool(held);
    (replicaB as any).pool = fakePool(held);

    const mayFinish = deferred();
    const started: string[] = [];
    const jobs = [
      replicaA.withSlot(
        { namespaceId: 'namespace-a', queue: 'queue' },
        async () => {
          started.push('a');
          await mayFinish.promise;
        },
      ),
      replicaB.withSlot(
        { namespaceId: 'namespace-b', queue: 'queue' },
        async () => {
          started.push('b');
          await mayFinish.promise;
        },
      ),
    ];

    while (started.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(started.sort()).toEqual(['a', 'b']);
    mayFinish.resolve();
    await Promise.all(jobs);
  });

  it('supports zero as an explicit unlimited setting', async () => {
    process.env.MAX_CONCURRENT_NAMESPACE_JOBS = '0';
    const service = new NamespaceJobConcurrencyService();
    await expect(
      service.withSlot({ namespaceId: 'namespace-a', queue: 'queue' }, () =>
        Promise.resolve('done'),
      ),
    ).resolves.toBe('done');
  });
});
