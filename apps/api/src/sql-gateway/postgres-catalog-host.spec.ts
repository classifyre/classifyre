import { Test } from '@nestjs/testing';
import {
  CatalogBackendDisconnectedError,
  CatalogCapacityError,
  type CatalogSession,
} from './catalog-backend';
import { computeCatalogHash } from './catalog-ddl';
import { PostgresCatalogHost } from './postgres-catalog-host';
import {
  type ConnectSessionOptions,
  PostgresCatalogSession,
} from './postgres-catalog-wire';
import { SqlGatewayMetrics } from './sql-gateway-metrics';

const poolQueries: string[] = [];
let clientQueryHook: ((sql: string, database: string) => Promise<void>) | null =
  null;

jest.mock('pg', () => {
  class MockPool {
    on(): this {
      return this;
    }

    query(sql: string) {
      poolQueries.push(sql);
      if (sql.includes('FROM pg_database WHERE datname = $1')) {
        return Promise.resolve({ rows: [{ datistemplate: false }] });
      }
      if (sql.includes("WHERE datname LIKE 'c_%'")) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("WHERE rolname LIKE 'r_%'")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    }

    end() {
      return Promise.resolve();
    }
  }

  class MockClient {
    private readonly database: string;
    constructor(opts: { database: string }) {
      this.database = opts.database;
    }
    connect() {
      return Promise.resolve();
    }
    async query(sql: string) {
      if (clientQueryHook) await clientQueryHook(sql, this.database);
      return { rows: [] };
    }
    end() {
      return Promise.resolve();
    }
  }

  return { Pool: MockPool, Client: MockClient };
});

function ddl(sql: string) {
  return {
    sql,
    dataSchemas: new Set(['shop.public']),
    tables: 1,
    skipped: [],
  };
}

function stubConnect() {
  const handles: {
    opts: ConnectSessionOptions;
    session: CatalogSession;
  }[] = [];
  const spy = jest
    .spyOn(PostgresCatalogSession, 'connect')
    .mockImplementation((opts: ConnectSessionOptions) => {
      let closed = false;
      const session: CatalogSession = {
        database: opts.database,
        role: opts.role,
        raw: () => Promise.resolve(Buffer.alloc(0)),
        exec: () => Promise.resolve(),
        query: () => Promise.resolve([]),
        onDisconnect: () => undefined,
        close: () => {
          if (!closed) {
            closed = true;
            opts.onClose();
          }
          return Promise.resolve();
        },
      };
      handles.push({ opts, session });
      return Promise.resolve(session as unknown as PostgresCatalogSession);
    });
  return { spy, handles };
}

describe('PostgresCatalogHost unit lifecycle', () => {
  beforeEach(() => {
    poolQueries.length = 0;
    clientQueryHook = null;
    jest.restoreAllMocks();
  });

  it('resolves cleanly via standard NestJS DI without useFactory', async () => {
    const mod = await Test.createTestingModule({
      providers: [SqlGatewayMetrics, PostgresCatalogHost],
    }).compile();
    const host = mod.get(PostgresCatalogHost);
    expect(host).toBeInstanceOf(PostgresCatalogHost);
    expect(host.catalogCount()).toBe(0);
    await host.close();
  });

  it('stays lazy until opened and refuses open() after close()', async () => {
    const metrics = new SqlGatewayMetrics();
    const host = new PostgresCatalogHost(metrics, {
      host: '127.0.0.1',
      port: 1,
      sweepIntervalMs: 0,
    });
    expect(host.catalogCount()).toBe(0);
    expect(host.catalogInfo('0'.repeat(24))).toBeNull();
    expect(await host.sweepNow()).toBe(0);

    await host.close();
    expect(await host.ping()).toBe(false);
    await expect(
      host.open({
        workspaceId: 'ws',
        connectionId: 'conn',
        ddl: ddl(''),
      }),
    ).rejects.toThrow(CatalogBackendDisconnectedError);
  });

  it('coalesces concurrent open() calls for the same catalog hash and tracks activeSessions', async () => {
    stubConnect();
    const metrics = new SqlGatewayMetrics();
    const host = new PostgresCatalogHost(metrics, { sweepIntervalMs: 0 });
    const schema = ddl('CREATE TABLE "shop.public".orders (id int);');
    const hash = computeCatalogHash('ws-1', schema.sql);

    const [s1, s2] = await Promise.all([
      host.open({ workspaceId: 'ws-1', connectionId: 'c1', ddl: schema }),
      host.open({ workspaceId: 'ws-1', connectionId: 'c2', ddl: schema }),
    ]);

    expect(s1.database).toBe(`c_${hash}`);
    expect(s2.database).toBe(`c_${hash}`);
    expect(host.catalogCount()).toBe(1);
    expect(host.catalogInfo(hash)?.activeSessions).toBe(2);
    const creates = poolQueries.filter((q) =>
      q.startsWith(`CREATE DATABASE "c_${hash}"`),
    );
    expect(creates).toHaveLength(1);

    await s1.close();
    expect(host.catalogInfo(hash)?.activeSessions).toBe(1);
    await s2.close();
    expect(host.catalogInfo(hash)?.activeSessions).toBe(0);
    await host.close();
  });

  it('prevents concurrent distinct-hash sign-ins from overshooting maxCatalogDbs', async () => {
    stubConnect();
    const host = new PostgresCatalogHost(new SqlGatewayMetrics(), {
      maxCatalogDbs: 2,
      sweepIntervalMs: 0,
    });

    // Hold DDL execution open for the first two DBs so the third races while
    // neither is in `this.catalogs` yet.
    const releaseDdl: (() => void)[] = [];
    clientQueryHook = async (_sql, db) => {
      if (!db.startsWith('c_')) return;
      await new Promise<void>((resolve) => releaseDdl.push(resolve));
    };

    const p1 = host.open({
      workspaceId: 'ws',
      connectionId: 'c1',
      ddl: ddl('CREATE TABLE t1 (id int);'),
    });
    const p2 = host.open({
      workspaceId: 'ws',
      connectionId: 'c2',
      ddl: ddl('CREATE TABLE t2 (id int);'),
    });
    const p3 = host.open({
      workspaceId: 'ws',
      connectionId: 'c3',
      ddl: ddl('CREATE TABLE t3 (id int);'),
    });

    // Wait for p3 to fail while p1 and p2 are still in DDL.
    await expect(p3).rejects.toThrow(CatalogCapacityError);

    // Release DDL for p1 and p2 (each runs DDL + grants = 2 queries).
    while (releaseDdl.length > 0) releaseDdl.shift()?.();
    await new Promise((r) => setTimeout(r, 10));
    while (releaseDdl.length > 0) releaseDdl.shift()?.();

    const [s1, s2] = await Promise.all([p1, p2]);
    expect(host.catalogCount()).toBe(2);
    const createdDbs = poolQueries.filter((q) =>
      q.startsWith('CREATE DATABASE "c_'),
    );
    expect(createdDbs).toHaveLength(2);

    await s1.close();
    await s2.close();
    await host.close();
  });

  it('LRU-evicts the oldest idle catalog at maxCatalogDbs and refuses when all are active', async () => {
    stubConnect();
    const host = new PostgresCatalogHost(new SqlGatewayMetrics(), {
      maxCatalogDbs: 2,
      sweepIntervalMs: 0,
    });

    const d1 = ddl('CREATE TABLE a (id int);');
    const d2 = ddl('CREATE TABLE b (id int);');
    const d3 = ddl('CREATE TABLE c (id int);');
    const h1 = computeCatalogHash('ws', d1.sql);
    const h2 = computeCatalogHash('ws', d2.sql);
    const h3 = computeCatalogHash('ws', d3.sql);

    const s1 = await host.open({
      workspaceId: 'ws',
      connectionId: '1',
      ddl: d1,
    });
    const s2 = await host.open({
      workspaceId: 'ws',
      connectionId: '2',
      ddl: d2,
    });

    // Both active: 3rd must be refused with CatalogCapacityError.
    await expect(
      host.open({ workspaceId: 'ws', connectionId: '3', ddl: d3 }),
    ).rejects.toThrow(CatalogCapacityError);

    // Closing s1 frees the oldest idle catalog so 3rd succeeds via LRU eviction.
    await s1.close();
    const s3 = await host.open({
      workspaceId: 'ws',
      connectionId: '3',
      ddl: d3,
    });
    expect(host.catalogCount()).toBe(2);
    expect(host.catalogInfo(h1)).toBeNull();
    expect(host.catalogInfo(h2)).not.toBeNull();
    expect(host.catalogInfo(h3)).not.toBeNull();

    await s2.close();
    await s3.close();
    await host.close();
  });

  it('sweepNow() drops TTL-expired and superseded idle catalogs while preserving active ones', async () => {
    stubConnect();
    const host = new PostgresCatalogHost(new SqlGatewayMetrics(), {
      dbTtlMs: 60_000,
      supersededGraceMs: 5_000,
      sweepIntervalMs: 0,
    });

    const v1 = ddl('CREATE TABLE v1 (id int);');
    const v2 = ddl('CREATE TABLE v2 (id int);');
    const other = ddl('CREATE TABLE active_tbl (id int);');
    const h1 = computeCatalogHash('ws', v1.sql);
    const h2 = computeCatalogHash('ws', v2.sql);
    const hActive = computeCatalogHash('ws', other.sql);

    const s1 = await host.open({
      workspaceId: 'ws',
      connectionId: 'c1',
      ddl: v1,
    });
    await s1.close();
    // Moving connection c1 to v2 marks v1 superseded.
    const s2 = await host.open({
      workspaceId: 'ws',
      connectionId: 'c1',
      ddl: v2,
    });
    await s2.close();
    const sActive = await host.open({
      workspaceId: 'ws',
      connectionId: 'c2',
      ddl: other,
    });

    expect(host.catalogInfo(h1)?.supersededAt).not.toBeNull();

    // After supersededGraceMs (10 s) but before dbTtlMs: only v1 is dropped.
    const dropped1 = await host.sweepNow(Date.now() + 10_000);
    expect(dropped1).toBe(1);
    expect(host.catalogInfo(h1)).toBeNull();
    expect(host.catalogInfo(h2)).not.toBeNull();
    expect(host.catalogInfo(hActive)).not.toBeNull();

    // After dbTtlMs (120 s): idle v2 is dropped, active catalog stays alive.
    const dropped2 = await host.sweepNow(Date.now() + 120_000);
    expect(dropped2).toBe(1);
    expect(host.catalogInfo(h2)).toBeNull();
    expect(host.catalogInfo(hActive)).not.toBeNull();

    await sActive.close();
    await host.close();
  });

  it('clears registry and records metric when sidecar disconnects unexpectedly', async () => {
    const { handles } = stubConnect();
    const metrics = new SqlGatewayMetrics();
    const host = new PostgresCatalogHost(metrics, { sweepIntervalMs: 0 });

    await host.open({
      workspaceId: 'ws',
      connectionId: 'c1',
      ddl: ddl('CREATE TABLE x (id int);'),
    });
    expect(host.catalogCount()).toBe(1);

    handles[0].opts.onBackendLost();
    expect(host.catalogCount()).toBe(0);
    expect(metrics.prometheus()).toContain(
      'classifyre_sql_gateway_sidecar_restarts_total 1',
    );
    await host.close();
  });
});
