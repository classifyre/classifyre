import { WorkerLeadershipService } from './worker-leadership.service';

interface FakeClient {
  query: jest.Mock;
  release: jest.Mock;
  alive: boolean;
}

/**
 * A pool whose single connection can be "killed" the way Postgres kills a
 * session when its holder dies — which is the whole basis of the election.
 */
function fakePool(held: { owner: FakeClient | null }) {
  const clients: FakeClient[] = [];
  return {
    clients,
    end: jest.fn(() => Promise.resolve()),
    connect: jest.fn(() => {
      const client: FakeClient = {
        alive: true,
        release: jest.fn(() => {
          client.alive = false;
          if (held.owner === client) held.owner = null;
        }),
        query: jest.fn((sql: string) => {
          if (!client.alive) {
            return Promise.reject(new Error('connection terminated'));
          }
          if (sql.includes('pg_try_advisory_lock')) {
            if (held.owner && held.owner !== client) {
              return Promise.resolve({ rows: [{ acquired: false }] });
            }
            held.owner = client;
            return Promise.resolve({ rows: [{ acquired: true }] });
          }
          if (sql.includes('pg_advisory_unlock')) {
            if (held.owner === client) held.owner = null;
            return Promise.resolve({ rows: [{}] });
          }
          return Promise.resolve({ rows: [{}] });
        }),
      };
      clients.push(client);
      return Promise.resolve(client);
    }),
  };
}

function build(held: { owner: FakeClient | null }) {
  const service = new WorkerLeadershipService();
  const pool = fakePool(held);
  (service as any).pool = pool;
  return { service, pool };
}

const poll = (service: WorkerLeadershipService): Promise<void> =>
  (service as any).poll();

describe('WorkerLeadershipService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, WORKER_LEADER_POLL_MS: '1000' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function handlers() {
    return { onAcquired: jest.fn(), onLost: jest.fn() };
  }

  it('elects exactly one of two campaigning replicas', async () => {
    const held = { owner: null as FakeClient | null };
    const a = build(held);
    const b = build(held);
    const ha = handlers();
    const hb = handlers();
    (a.service as any).onAcquired = ha.onAcquired;
    (b.service as any).onAcquired = hb.onAcquired;

    await poll(a.service);
    await poll(b.service);

    expect(a.service.isLeader()).toBe(true);
    expect(b.service.isLeader()).toBe(false);
    expect(ha.onAcquired).toHaveBeenCalledTimes(1);
    expect(hb.onAcquired).not.toHaveBeenCalled();
  });

  it('does not re-run the acquire handler while it keeps leading', async () => {
    const held = { owner: null as FakeClient | null };
    const { service } = build(held);
    const h = handlers();
    (service as any).onAcquired = h.onAcquired;

    await poll(service);
    await poll(service);
    await poll(service);

    expect(h.onAcquired).toHaveBeenCalledTimes(1);
    expect(service.isLeader()).toBe(true);
  });

  // Releasing the client returns it to the pool and drops the session lock,
  // so a service that let go of its client would keep claiming leadership it
  // no longer holds.
  it('keeps its locking connection checked out while it leads', async () => {
    const held = { owner: null as FakeClient | null };
    const { service, pool } = build(held);

    await poll(service);
    await poll(service);

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(pool.clients[0]?.release).not.toHaveBeenCalled();
    expect(held.owner).toBe(pool.clients[0]);
  });

  // A demoted leader that keeps polling is the double-reply the election
  // exists to prevent, so losing the connection must actually stop the work.
  it('stops singleton work when its connection dies', async () => {
    const held = { owner: null as FakeClient | null };
    const { service, pool } = build(held);
    const h = handlers();
    (service as any).onAcquired = h.onAcquired;
    (service as any).onLost = h.onLost;

    await poll(service);
    expect(service.isLeader()).toBe(true);

    // Postgres drops the session lock the moment the connection dies.
    pool.clients[0].alive = false;
    held.owner = null;

    await poll(service);

    expect(service.isLeader()).toBe(false);
    expect(h.onLost).toHaveBeenCalledTimes(1);
  });

  it('hands leadership to the survivor after the leader dies', async () => {
    const held = { owner: null as FakeClient | null };
    const a = build(held);
    const b = build(held);
    const hb = handlers();
    (b.service as any).onAcquired = hb.onAcquired;

    await poll(a.service);
    await poll(b.service);
    expect(b.service.isLeader()).toBe(false);

    await a.service.onApplicationShutdown();
    await poll(b.service);

    expect(b.service.isLeader()).toBe(true);
    expect(hb.onAcquired).toHaveBeenCalledTimes(1);
  });

  it('releases the lock on a clean shutdown', async () => {
    const held = { owner: null as FakeClient | null };
    const { service } = build(held);

    await poll(service);
    expect(held.owner).not.toBeNull();

    await service.onApplicationShutdown();

    expect(held.owner).toBeNull();
    expect(service.isLeader()).toBe(false);
  });
});
