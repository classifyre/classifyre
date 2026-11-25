import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import {
  type AddressInfo,
  connect as connectRaw,
  createServer,
  type Server,
} from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import { Client, type QueryConfig } from 'pg';
import { arrowRows, plainRows } from './arrow-rows';
import { CatalogCapacityError, type CatalogSession } from './catalog-backend';
import { catalogDdl, computeCatalogHash } from './catalog-ddl';
import {
  MessageReader,
  MessageWriter,
  authenticationOk,
  errorResponse,
  frontend,
  readyForQuery,
} from './pg-protocol';
import { DataError, type DataRunner, PgSession } from './pg-session';
import {
  type CatalogPgConfig,
  PostgresCatalogHost,
} from './postgres-catalog-host';
import { SqlGatewayMetrics } from './sql-gateway-metrics';

interface EphemeralPg {
  config: Partial<CatalogPgConfig>;
  isLocal: boolean;
  restart?: () => void;
  stop: () => void;
}

function findPgBinDir(): string | null {
  const candidates = [
    '/opt/homebrew/opt/postgresql@18/bin',
    '/opt/homebrew/opt/postgresql@17/bin',
    '/opt/homebrew/opt/postgresql@16/bin',
    '/usr/local/opt/postgresql@18/bin',
    '/usr/local/opt/postgresql@17/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'initdb')) && existsSync(join(dir, 'pg_ctl'))) {
      return dir;
    }
  }
  try {
    const pgCtl = execFileSync('which', ['pg_ctl'], {
      encoding: 'utf8',
    }).trim();
    const initdb = execFileSync('which', ['initdb'], {
      encoding: 'utf8',
    }).trim();
    if (pgCtl && initdb) return join(pgCtl, '..');
  } catch {
    // not on PATH
  }
  return null;
}

function startCatalogPostgres(): EphemeralPg {
  if (
    process.env.SQL_GATEWAY_CATALOG_PG_SOCKET ||
    process.env.SQL_GATEWAY_CATALOG_PG_HOST
  ) {
    return {
      isLocal: false,
      config: {
        socketDir:
          process.env.SQL_GATEWAY_CATALOG_PG_SOCKET?.trim() || undefined,
        host: process.env.SQL_GATEWAY_CATALOG_PG_HOST?.trim() || undefined,
        port: Number(process.env.SQL_GATEWAY_CATALOG_PG_PORT) || 5432,
        adminUser:
          process.env.SQL_GATEWAY_CATALOG_PG_USER?.trim() || 'postgres',
        adminPassword: process.env.SQL_GATEWAY_CATALOG_PG_PASSWORD,
        maintenanceDb:
          process.env.SQL_GATEWAY_CATALOG_PG_DATABASE?.trim() || 'postgres',
      },
      stop: () => undefined,
    };
  }

  const binDir = findPgBinDir();
  if (!binDir) {
    throw new Error(
      'PostgreSQL binaries (initdb/pg_ctl) not found and SQL_GATEWAY_CATALOG_PG_HOST/SOCKET is unset.',
    );
  }
  const root = mkdtempSync(join(tmpdir(), 'classifyre-catalog-pg-'));
  const dataDir = join(root, 'data');
  const sockDir = join(root, 'sock');
  const logFile = join(root, 'pg.log');
  mkdirSync(sockDir, { recursive: true });

  execFileSync(
    join(binDir, 'initdb'),
    ['-D', dataDir, '-U', 'postgres', '--auth=trust', '--no-sync'],
    { stdio: 'pipe' },
  );

  const pgOpts = [
    "-c listen_addresses=''",
    `-c unix_socket_directories=${sockDir}`,
    '-c fsync=off',
    '-c synchronous_commit=off',
    '-c full_page_writes=off',
    '-c wal_level=minimal',
    '-c max_wal_senders=0',
    '-c shared_buffers=32MB',
    '-c max_connections=128',
    '-c jit=off',
  ].join(' ');

  const startServer = () => {
    execFileSync(
      join(binDir, 'pg_ctl'),
      ['-D', dataDir, '-l', logFile, '-w', '-o', pgOpts, 'start'],
      { stdio: 'pipe' },
    );
  };
  const stopServer = (mode: 'fast' | 'immediate' = 'fast') => {
    try {
      execFileSync(
        join(binDir, 'pg_ctl'),
        ['-D', dataDir, '-m', mode, '-w', 'stop'],
        { stdio: 'pipe' },
      );
    } catch {
      // already stopped
    }
  };

  startServer();

  return {
    isLocal: true,
    config: {
      socketDir: sockDir,
      port: 5432,
      adminUser: 'postgres',
      maintenanceDb: 'postgres',
    },
    restart: () => {
      stopServer('immediate');
      startServer();
    },
    stop: () => {
      stopServer('fast');
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * A real native PostgreSQL catalog session behind a test listener (trust
 * sign-in), spoken to by node-postgres: what BI tools do, without query jobs —
 * the data runner answers from fixed rows (and real Arrow IPC) and records
 * what it was asked.
 */
describe('PgSession over native Postgres catalog sidecar', () => {
  let pgCluster: EphemeralPg;
  let host: PostgresCatalogHost;
  let server: Server;
  let port: number;
  const asked: { sql: string; tables: string[]; searchPath: string[] }[] = [];
  const runner: DataRunner = {
    maxRows: 3,
    run(input) {
      asked.push(input);
      if (/boom/.test(input.sql))
        throw new DataError('42501', 'You cannot query that.');
      if (/many/.test(input.sql)) {
        return Promise.resolve({
          rows: plainRows([
            [1n, 'a', '1.50', { micros: 1794564672000000n, kind: 'timestamp' }],
            [2n, 'b', '2', null],
            [3n, 'c', '3', null],
          ]),
          truncated: true,
        });
      }
      if (/^SELECT id, customer/.test(input.sql)) {
        // Exercise direct Apache Arrow IPC → DataRow encoding path end-to-end.
        const arrowTable = tableFromArrays({
          id: new BigInt64Array([1n, 2n]),
          customer: ['Ana', 'Bo'],
        });
        return Promise.resolve({
          rows: arrowRows(Buffer.from(tableToIPC(arrowTable, 'stream'))),
          truncated: false,
        });
      }
      return Promise.resolve({
        rows: plainRows([
          [
            1n,
            'Ana',
            '12.50',
            { micros: 1794564672123456n, kind: 'timestamp' },
          ],
          [2n, 'Bo', null, null],
        ]),
        truncated: false,
      });
    },
  };
  const sessions: CatalogSession[] = [];

  const baseSources = [
    {
      id: 's1',
      name: 'Shop',
      type: 'POSTGRESQL',
      sqlName: 'shop',
      queryable: true,
      tables: [
        {
          assetId: 'a1',
          sourceId: 's1',
          name: 'orders',
          schema: 'public',
          table: 'orders',
          sqlName: 'shop.public.orders',
          columns: [
            { name: 'id', type: 'BIGINT' },
            { name: 'customer', type: 'VARCHAR' },
            { name: 'amount', type: 'DECIMAL(12,2)' },
            { name: 'created', type: 'TIMESTAMP WITH TIME ZONE' },
          ],
          queryable: true,
          canQuery: true,
          location: null,
        },
      ],
    },
  ];
  const baseNotes = {
    tables: new Map([['a1', 'Every order, one row each.']]),
    columns: new Map([
      [
        'a1',
        new Map([
          [
            'customer',
            { businessName: 'Customer', description: 'Who ordered' },
          ],
        ]),
      ],
    ]),
  };

  beforeAll(async () => {
    pgCluster = startCatalogPostgres();
    host = new PostgresCatalogHost(new SqlGatewayMetrics(), {
      ...pgCluster.config,
      statementTimeoutMs: 1_500,
      sweepIntervalMs: 0,
      supersededGraceMs: 0,
      dbTtlMs: 60_000,
      maxCatalogDbs: 16,
      reconcileOrphansOnStartup: pgCluster.isLocal,
    });
    const ddl = catalogDdl(baseSources, baseNotes);
    server = createServer((socket) => {
      void (async () => {
        const chunks: Buffer[] = [];
        let startup = Buffer.alloc(0);
        await new Promise<void>((resolve) => {
          const onData = (chunk: Buffer) => {
            startup = Buffer.concat([startup, chunk]);
            if (
              startup.length >= 4 &&
              startup.length >= startup.readInt32BE(0)
            ) {
              socket.off('data', onData);
              const rest = startup.subarray(startup.readInt32BE(0));
              if (rest.length) chunks.push(rest);
              resolve();
            }
          };
          socket.on('data', onData);
        });
        const pg = await host.open({
          workspaceId: 'ws-lab',
          connectionId: 'conn-ana',
          ddl,
        });
        sessions.push(pg);
        const session = new PgSession(pg, ddl.dataSchemas, runner, (b) =>
          socket.write(b),
        );
        pg.onDisconnect(() => {
          if (!socket.destroyed) {
            socket.end(
              errorResponse({
                severity: 'FATAL',
                code: '57P01',
                message: 'The SQL gateway lost this session.',
              }),
            );
          }
        });
        await session.start({ TimeZone: 'UTC' });
        socket.write(Buffer.concat([authenticationOk(), readyForQuery('I')]));
        const reader = new MessageReader();
        const onData = (chunk: Buffer) => {
          const messages = reader.push(chunk).filter((m) => m.type !== 'X');
          void session.receive(messages).catch(() => {
            if (!socket.destroyed) {
              socket.end(
                errorResponse({
                  severity: 'FATAL',
                  code: '57P01',
                  message: 'The SQL gateway lost this session.',
                }),
              );
            }
          });
        };
        socket.on('data', onData);
        for (const chunk of chunks) onData(chunk);
        socket.on('close', () => void session.close());
      })();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  }, 120_000);

  afterAll(async () => {
    server?.close();
    await Promise.all(sessions.map((s) => s.close().catch(() => undefined)));
    if (host) {
      await host.sweepNow(Date.now() + 10 * 60_000).catch(() => undefined);
      await host.close();
    }
    pgCluster?.stop();
  });

  const connect = async () => {
    const client = new Client({
      host: '127.0.0.1',
      port,
      user: 'ana_bi',
      database: 'lab',
    });
    await client.connect();
    return client;
  };

  it('refuses privilege escalation and keeps RESET SESSION AUTHORIZATION locked to r_<hash>', async () => {
    for (const sql of [
      'SET SESSION AUTHORIZATION postgres',
      'SET ROLE postgres',
      "DO $$ BEGIN EXECUTE 'SET SESSION AUTHORIZATION ' || 'postgres'; END $$",
      "SELECT set_config('session_authorization', 'postgres', false)",
    ]) {
      const client = await connect();
      client.on('error', () => undefined);
      await expect(client.query(sql)).rejects.toThrow();
      const who = await client
        .query(`SELECT current_setting('is_superuser') AS su`)
        .catch(() => null);
      if (who) expect(who.rows[0]).toEqual({ su: 'off' });
      await client.end().catch(() => undefined);
    }

    // RESET SESSION AUTHORIZATION on a non-superuser role cannot elevate.
    const client = await connect();
    await client.query('RESET SESSION AUTHORIZATION');
    const afterReset = await client.query(
      `SELECT current_user AS u, current_setting('is_superuser') AS su`,
    );
    expect(afterReset.rows[0].u).toMatch(/^r_[0-9a-f]{24}$/);
    expect(afterReset.rows[0].su).toBe('off');
    await client.end();
  }, 60_000);

  it('keeps the catalog read-only and uses an opaque non-superuser role and database', async () => {
    const client = await connect();
    await expect(
      client.query(`CREATE TABLE public.x (id int)`),
    ).rejects.toMatchObject({ code: '25006' });
    const who = await client.query(
      `SELECT current_user AS u, current_setting('is_superuser') AS su, current_database() AS db`,
    );
    expect(who.rows[0].u).toMatch(/^r_[0-9a-f]{24}$/);
    expect(who.rows[0].db).toMatch(/^c_[0-9a-f]{24}$/);
    expect(who.rows[0].db).not.toContain('lab');
    expect(who.rows[0].su).toBe('off');
    await client.end();
  }, 60_000);

  it('answers the catalog from native Postgres, with governance notes', async () => {
    const client = await connect();
    const tables = await client.query(
      `SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema','classifyre')`,
    );
    expect(tables.rows).toEqual([
      { table_schema: 'shop.public', table_name: 'orders' },
    ]);
    const comment = await client.query(
      `SELECT col_description('"shop.public".orders'::regclass, 2) AS c, obj_description('"shop.public".orders'::regclass) AS t, current_database() AS db`,
    );
    expect(comment.rows[0].c).toBe('Customer — Who ordered');
    expect(comment.rows[0].t).toBe('orders — Every order, one row each.');
    expect(comment.rows[0].db).toMatch(/^c_[0-9a-f]{24}$/);
    await client.end();
  }, 60_000);

  it('runs data statements as jobs, text and binary, with parameters and direct Arrow encoding', async () => {
    const client = await connect();
    const text = await client.query('SELECT * FROM "shop.public".orders');
    expect(text.rows).toEqual([
      {
        id: '1',
        customer: 'Ana',
        amount: '12.50',
        created: new Date('2026-11-13T10:11:12.123Z'),
      },
      { id: '2', customer: 'Bo', amount: null, created: null },
    ]);
    await client.query(`SET search_path = "shop.public", public`);
    const bound = await client.query({
      text: 'SELECT id, customer FROM orders WHERE id = $1 AND customer = $2',
      values: [7, "O'Brien"],
      binary: true,
    } as QueryConfig);
    expect(bound.rows.length).toBe(2);
    expect(bound.fields.map((f) => f.format)).toEqual(['binary', 'binary']);
    expect(bound.rows.map((r) => [String(r.id), r.customer])).toEqual([
      ['1', 'Ana'],
      ['2', 'Bo'],
    ]);
    const last = asked[asked.length - 1];
    expect(last.sql).toBe(
      `SELECT id, customer FROM orders WHERE id = 7 AND customer = 'O''Brien'`,
    );
    expect(last.tables).toEqual(['shop.public.orders']);
    expect(last.searchPath).toEqual(['shop.public', 'public']);
    await client.end();
  }, 60_000);

  it('fails through the transaction, refuses more rows than allowed, and mixing', async () => {
    const client = await connect();
    await client.query('BEGIN');
    await expect(
      client.query(
        `SELECT * FROM "shop.public".orders WHERE customer = 'boom'`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(client.query('SELECT 1')).rejects.toMatchObject({
      code: '25P02',
    });
    await client.query('ROLLBACK');
    await expect(
      client.query(
        `SELECT * FROM "shop.public".orders WHERE customer = 'many'`,
      ),
    ).rejects.toMatchObject({ code: '54000' });
    await expect(
      client.query(
        `SELECT o.id, c.relname FROM "shop.public".orders o, pg_class c`,
      ),
    ).rejects.toMatchObject({ code: '0A000' });
    expect((await client.query('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
    await client.query(`SELECT * FROM "shop.public".orders`);
    await client.query('SELECT 1');
    await expect(client.query('SAVEPOINT s')).rejects.toMatchObject({
      code: '25P01',
    });
    const who = await client.query('SELECT current_user AS u');
    expect(who.rows[0].u).toMatch(/^r_[0-9a-f]{24}$/);
    await expect(
      client.query(`DELETE FROM "shop.public".orders`),
    ).rejects.toMatchObject({ code: '25006' });
    await expect(
      client.query(`CREATE TABLE public.x (a int)`),
    ).rejects.toMatchObject({ code: '25006' });
    await client.end();
  }, 60_000);

  it('serves a portal page by page across Syncs in a transaction', async () => {
    const { socket, untilReady } = await rawSession(port);
    socket.write(frontend.query('BEGIN'));
    await untilReady();
    socket.write(
      Buffer.concat([
        frontend.parse('', 'SELECT * FROM "shop.public".orders'),
        frontend.bind('C_1', '', []),
        frontend.describe('P', 'C_1'),
        frontend.execute('C_1', 1),
        frontend.sync(),
      ]),
    );
    const rowsOf = (types: string[]) => types.filter((t) => t === 'D').length;
    const first = await untilReady();
    expect(rowsOf(first)).toBe(1);
    expect(first).toContain('s');
    socket.write(
      Buffer.concat([
        frontend.parse('', 'SELECT attname FROM pg_attribute LIMIT 1'),
        frontend.bind('', '', []),
        frontend.execute('', 0),
        frontend.sync(),
      ]),
    );
    expect(await untilReady()).not.toContain('E');
    socket.write(Buffer.concat([frontend.execute('C_1', 1), frontend.sync()]));
    let page = await untilReady();
    let rows = rowsOf(first) + rowsOf(page);
    while (page.includes('s')) {
      socket.write(
        Buffer.concat([frontend.execute('C_1', 1), frontend.sync()]),
      );
      page = await untilReady();
      rows += rowsOf(page);
    }
    expect(page).toContain('C');
    expect(page).not.toContain('E');
    expect(rows).toBe(2);
    socket.end();
  }, 60_000);

  it('reads a data cursor with FETCH, as psqlODBC does', async () => {
    const { socket, untilReady } = await rawSession(port);
    const rowsOf = (types: string[]) => types.filter((t) => t === 'D').length;
    socket.write(
      frontend.query(
        'BEGIN;declare "SQL_CUR0x1" cursor with hold for SELECT * FROM "shop.public".orders;fetch 1 in "SQL_CUR0x1"',
      ),
    );
    const first = await untilReady();
    expect(first).not.toContain('E');
    expect(rowsOf(first)).toBe(1);
    expect(first).toContain('T');
    socket.write(frontend.query('fetch 100 in "SQL_CUR0x1"'));
    const rest = await untilReady();
    expect(rowsOf(rest)).toBe(1);
    socket.write(frontend.query('fetch 100 in "SQL_CUR0x1"'));
    expect(rowsOf(await untilReady())).toBe(0);
    socket.write(frontend.query('close "SQL_CUR0x1";commit'));
    expect(await untilReady()).not.toContain('E');
    socket.write(
      frontend.query(
        'BEGIN;declare c cursor for SELECT relname FROM pg_class LIMIT 2;fetch all in c;close c;commit',
      ),
    );
    const catalog = await untilReady();
    expect(catalog).not.toContain('E');
    expect(rowsOf(catalog)).toBe(2);
    socket.end();
  }, 60_000);

  it('refuses cursor statements over data it cannot serve, never answering 0 rows', async () => {
    const { socket, untilReady, codes } = await rawSession(port);
    const rowsOf = (types: string[]) => types.filter((t) => t === 'D').length;
    const orders = 'SELECT * FROM "shop.public".orders';
    socket.write(
      frontend.query(
        `BEGIN;-- x\nDECLARE c1 BINARY NO SCROLL CURSOR FOR ${orders};fetch all in c1`,
      ),
    );
    expect(rowsOf(await untilReady())).toBe(2);
    expect(codes()).toEqual([]);
    socket.write(frontend.query(`declare c1 cursor for ${orders}`));
    await untilReady();
    expect(codes()).toEqual(['42P03']);
    socket.write(frontend.query('rollback'));
    await untilReady();
    socket.write(
      frontend.query(`BEGIN;declare c2 scroll cursor for ${orders}`),
    );
    await untilReady();
    expect(codes()).toEqual(['0A000']);
    socket.write(frontend.query('rollback'));
    await untilReady();
    socket.write(
      frontend.query(
        `BEGIN;declare c3 cursor for ${orders};fetch backward 1 from c3`,
      ),
    );
    await untilReady();
    expect(codes()).toEqual(['0A000']);
    socket.write(frontend.query('fetch 1 in c3'));
    await untilReady();
    expect(codes()).toEqual(['25P02']);
    socket.write(frontend.query('rollback'));
    await untilReady();
    socket.write(
      Buffer.concat([
        frontend.parse('', `declare c4 cursor with hold for ${orders}`),
        frontend.bind('', '', []),
        frontend.execute('', 0),
        frontend.sync(),
      ]),
    );
    await untilReady();
    expect(codes()).toEqual(['0A000']);
    socket.end();
  }, 60_000);

  it('ends cursors with their transaction, and caps them per connection', async () => {
    const { socket, untilReady, codes } = await rawSession(port);
    const rowsOf = (types: string[]) => types.filter((t) => t === 'D').length;
    const orders = 'SELECT * FROM "shop.public".orders';
    socket.write(
      frontend.query(
        `BEGIN;declare h1 cursor with hold for ${orders};rollback`,
      ),
    );
    await untilReady();
    socket.write(frontend.query('fetch 1 in h1'));
    await untilReady();
    expect(codes()).toEqual(['34000']);
    socket.write(
      frontend.query(
        `BEGIN;declare h2 cursor with hold for ${orders};declare n1 cursor for ${orders};commit`,
      ),
    );
    await untilReady();
    socket.write(frontend.query('fetch all in h2'));
    expect(rowsOf(await untilReady())).toBe(2);
    socket.write(frontend.query('fetch 1 in n1'));
    await untilReady();
    expect(codes()).toEqual(['34000']);
    const declares = Array.from(
      { length: 8 },
      (_, i) => `declare m${i} cursor with hold for ${orders}`,
    ).join(';');
    socket.write(frontend.query(declares));
    await untilReady();
    expect(codes()).toEqual(['53400']);
    socket.end();
  }, 60_000);

  it('refuses writes, DDL, unserved reads, and revoked functions (SG §8.2)', async () => {
    const { socket, untilReady, codes } = await rawSession(port);
    const T = '"shop.public".orders';
    const orders = `SELECT * FROM ${T}`;
    const cases: [string, string][] = [
      [`CREATE TEMP TABLE x AS ${orders}`, '25006'],
      [
        `CREATE /*x*/ FUNCTION pg_temp.f() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM ${T}'`,
        '25006',
      ],
      [
        `CREATE OR REPLACE\n--c\nFUNCTION pg_temp.g() RETURNS int LANGUAGE sql AS 'SELECT 1'`,
        '25006',
      ],
      [`COPY (${orders}) TO STDOUT`, '25006'],
      [`COPY /*x*/ ${T} TO STDOUT`, '25006'],
      [`DO $$ BEGIN PERFORM count(*) FROM ${T}; END $$`, '25006'],
      [`INSERT INTO pg_temp.nope SELECT * FROM ${T} RETURNING *`, '25006'],
      [`UPDATE u SET id = o.id FROM ${T} o RETURNING o.*`, '25006'],
      [`DELETE FROM u USING ${T} o RETURNING o.*`, '25006'],
      [
        `MERGE INTO u USING ${T} o ON true WHEN NOT MATCHED THEN DO NOTHING`,
        '25006',
      ],
      [`CREATE RULE r AS ON INSERT TO u DO ALSO SELECT 1`, '25006'],
      [`PREPARE p AS ${orders}`, '0A000'],
      [`EXPLAIN ANALYZE ${orders}`, '0A000'],
      [`SELECT table_to_xml('${T}'::regclass, false, false, '')`, '42501'],
      [
        `SELECT * FROM ts_stat('SELECT to_tsvector(customer) FROM ${T}')`,
        '42501',
      ],
      [
        `SELECT query_to_xml('${orders.replace(/'/g, "''")}', false, false, '')`,
        '42501',
      ],
      [`SELECT pg_sleep(1)`, '42501'],
      [`SELECT pg_sleep_for('1 second'::interval)`, '42501'],
      [`SELECT pg_read_file('PG_VERSION')`, '42501'],
      [`SELECT lo_create(0)`, '42501'],
    ];
    for (const [sql, code] of cases) {
      socket.write(frontend.query(sql));
      await untilReady();
      expect([sql, codes()]).toEqual([sql, [code]]);
    }
    socket.write(
      frontend.query(
        'PREPARE c AS SELECT relname FROM pg_class LIMIT 1; EXECUTE c',
      ),
    );
    await untilReady();
    expect(codes()).toEqual([]);
    socket.write(
      frontend.query(`BEGIN;declare f cursor for ${orders};fetch 0 in f`),
    );
    await untilReady();
    expect(codes()).toEqual(['0A000']);
    socket.write(frontend.query('rollback'));
    await untilReady();
    socket.end();
  }, 60_000);

  it('drops a WITH HOLD cursor when its block rolls back through Parse/Execute', async () => {
    const { socket, untilReady, codes } = await rawSession(port);
    socket.write(
      frontend.query(
        'BEGIN;declare h cursor with hold for SELECT * FROM "shop.public".orders',
      ),
    );
    await untilReady();
    socket.write(
      Buffer.concat([
        frontend.parse('', 'ROLLBACK'),
        frontend.bind('', '', []),
        frontend.execute('', 0),
        frontend.sync(),
      ]),
    );
    await untilReady();
    socket.write(frontend.query('fetch all in h'));
    await untilReady();
    expect(codes()).toEqual(['34000']);
    socket.end();
  }, 60_000);

  it.each(corpusFiles())(
    'replays the client corpus %s',
    async (_file, entries) => {
      const client = await connect();
      const failures: string[] = [];
      for (const entry of entries) {
        const before = asked.length;
        try {
          const result = await client.query(entry.sql);
          if (entry.kind === 'refused') {
            failures.push(`${entry.label}: was not refused`);
          } else if (entry.kind === 'data' && asked.length === before) {
            failures.push(`${entry.label}: did not run as a query job`);
          } else if (entry.kind !== 'data' && asked.length !== before) {
            failures.push(`${entry.label}: ran as a query job`);
          } else if (entry.minRows !== undefined && result.rowCount !== null) {
            if ((result.rows?.length ?? 0) < entry.minRows) {
              failures.push(
                `${entry.label}: ${result.rows.length} rows, want ≥ ${entry.minRows}`,
              );
            }
          }
        } catch (error) {
          if (entry.kind !== 'refused') {
            failures.push(`${entry.label}: ${(error as Error).message}`);
          }
        }
      }
      await client.end();
      expect(failures).toEqual([]);
    },
    60_000,
  );

  // ── SG §8.2 Isolation, Lockdown, Abuse Guards, Cleanup & Recovery ────

  describe('isolation, abuse guards, lifecycle, and crash recovery (SG §8.2)', () => {
    it('isolates metadata across users and blocks cross-DB CONNECT and writes directly in Postgres', async () => {
      const ddlA = catalogDdl(baseSources);
      const ddlB = catalogDdl([
        {
          ...baseSources[0],
          tables: [
            ...baseSources[0].tables,
            {
              ...baseSources[0].tables[0],
              assetId: 'a2',
              name: 'invoices',
              table: 'invoices',
              sqlName: 'shop.public.invoices',
            },
          ],
        },
      ]);

      const [sessA, sessB] = await Promise.all([
        host.open({ workspaceId: 'ws-iso', connectionId: 'conn-a', ddl: ddlA }),
        host.open({ workspaceId: 'ws-iso', connectionId: 'conn-b', ddl: ddlB }),
      ]);
      try {
        expect(sessA.database).not.toBe(sessB.database);
        expect(sessA.role).not.toBe(sessB.role);
        expect(sessA.database).toMatch(/^c_[0-9a-f]{24}$/);

        const tablesA = await sessA.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'shop.public' ORDER BY 1`,
        );
        const tablesB = await sessB.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'shop.public' ORDER BY 1`,
        );
        expect(tablesA.map((r) => r.table_name)).toEqual(['orders']);
        expect(tablesB.map((r) => r.table_name)).toEqual([
          'invoices',
          'orders',
        ]);

        // User A also cannot see User B's tables in pg_catalog.pg_class.
        const pgClassA = await sessA.query<{ relname: string }>(
          `SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'shop.public' ORDER BY 1`,
        );
        expect(pgClassA.map((r) => r.relname)).toEqual(['orders']);

        // Even bypassing the gateway's WRITE_VERBS filter, PostgreSQL itself
        // enforces read-only transactions and blocks CREATE / TEMP / writes.
        await expect(
          sessA.exec('CREATE TABLE public.nope (id int)'),
        ).rejects.toThrow();
        await expect(
          sessA.exec('CREATE TEMP TABLE tmp_nope (id int)'),
        ).rejects.toThrow();
        await expect(
          sessA.exec(
            'SET default_transaction_read_only = off; CREATE TEMP TABLE tmp_nope2 (id int)',
          ),
        ).rejects.toThrow();

        // Actual CONNECT attempts as role A to User B's DB, postgres,
        // template1, and classifyre_tpl must all be refused by PostgreSQL.
        const hashA = computeCatalogHash('ws-iso', ddlA.sql);
        const infoA = host.catalogInfo(hashA)!;
        for (const forbiddenDb of [
          sessB.database,
          'postgres',
          'template1',
          'classifyre_tpl',
        ]) {
          const intruder = new Client({
            host: pgCluster.config.socketDir ?? pgCluster.config.host,
            port: pgCluster.config.port ?? 5432,
            user: infoA.roleName,
            password: infoA.password,
            database: forbiddenDb,
          });
          await expect(intruder.connect()).rejects.toThrow();
          await intruder.end().catch(() => undefined);
        }
      } finally {
        await sessA.close();
        await sessB.close();
      }
    }, 60_000);

    it('enforces maxCatalogDbs immediately at creation (LRU evicts idle, refuses when all active)', async () => {
      const cappedHost = new PostgresCatalogHost(new SqlGatewayMetrics(), {
        ...pgCluster.config,
        statementTimeoutMs: 1_500,
        sweepIntervalMs: 0,
        maxCatalogDbs: 2,
        reconcileOrphansOnStartup: false,
      });
      const ddl = catalogDdl(baseSources);
      try {
        const s1 = await cappedHost.open({
          workspaceId: 'ws-cap-1',
          connectionId: 'c1',
          ddl,
        });
        const s2 = await cappedHost.open({
          workspaceId: 'ws-cap-2',
          connectionId: 'c2',
          ddl,
        });
        expect(cappedHost.catalogCount()).toBe(2);

        // Both DBs are active -> opening a 3rd distinct DB is refused immediately.
        await expect(
          cappedHost.open({
            workspaceId: 'ws-cap-3',
            connectionId: 'c3',
            ddl,
          }),
        ).rejects.toThrow(CatalogCapacityError);

        // Once s1 closes, opening a 3rd DB synchronously LRU-evicts ws-cap-1.
        await s1.close();
        const s3 = await cappedHost.open({
          workspaceId: 'ws-cap-3',
          connectionId: 'c3',
          ddl,
        });
        expect(cappedHost.catalogCount()).toBe(2);
        expect(
          cappedHost.catalogInfo(computeCatalogHash('ws-cap-1', ddl.sql)),
        ).toBeNull();
        await s2.close();
        await s3.close();
        await cappedHost.sweepNow(Date.now() + 60 * 60_000);
      } finally {
        await cappedHost.close();
      }
    }, 60_000);

    it('cancels CPU abuse at statement_timeout without affecting other sessions, and blocks temp_file_limit spills', async () => {
      const [c1, c2] = await Promise.all([connect(), connect()]);
      try {
        // Pure CPU cross-join (small operands stay within work_mem) hits
        // per-role statement_timeout (57014) without spilling to disk.
        const abuse = c1.query(
          'SELECT count(*) FROM generate_series(1, 20000) a, generate_series(1, 20000) b',
        );
        // Concurrent session remains fast and unaffected.
        const healthy = await c2.query('SELECT 42 AS answer');
        expect(healthy.rows).toEqual([{ answer: 42 }]);

        await expect(abuse).rejects.toMatchObject({ code: '57014' });

        // Exceeding work_mem (4MB) with temp_file_limit = 0 fails cleanly (53400).
        await expect(
          c1.query(
            'SELECT * FROM generate_series(1, 300000) g ORDER BY md5(g::text)',
          ),
        ).rejects.toMatchObject({ code: '53400' });
      } finally {
        await c1.end().catch(() => undefined);
        await c2.end().catch(() => undefined);
      }
    }, 60_000);

    it('coalesces concurrent sign-ins on one catalogHash, keeps active sessions immutable on change, and reaps superseded DBs', async () => {
      const ddlV1 = catalogDdl(baseSources);
      const ddlV2 = catalogDdl([
        {
          ...baseSources[0],
          tables: [
            ...baseSources[0].tables,
            {
              ...baseSources[0].tables[0],
              assetId: 'a3',
              name: 'shipments',
              table: 'shipments',
              sqlName: 'shop.public.shipments',
            },
          ],
        },
      ]);

      const beforeCreates = host.metrics.snapshot().catalogDbCreateCount;
      // 5 concurrent sign-ins for the exact same view coalesce into 1 DB creation.
      const burst = await Promise.all(
        Array.from({ length: 5 }, () =>
          host.open({
            workspaceId: 'ws-lifecycle',
            connectionId: 'conn-1',
            ddl: ddlV1,
          }),
        ),
      );
      const hashV1 = computeCatalogHash('ws-lifecycle', ddlV1.sql);
      const hashV2 = computeCatalogHash('ws-lifecycle', ddlV2.sql);
      expect(new Set(burst.map((s) => s.database)).size).toBe(1);
      expect(host.metrics.snapshot().catalogDbCreateCount).toBe(
        beforeCreates + 1,
      );

      // Granting a new table produces a new DB for new sessions while active
      // sessions on v1 remain uninterrupted.
      const v2Session = await host.open({
        workspaceId: 'ws-lifecycle',
        connectionId: 'conn-1',
        ddl: ddlV2,
      });
      expect(v2Session.database).toBe(`c_${hashV2}`);
      expect(host.catalogInfo(hashV1)?.supersededAt).not.toBeNull();

      // Active v1 sessions still work and are NOT dropped by sweepNow().
      const rV1 = await burst[0].query<{ n: string }>('SELECT 1 AS n');
      expect(rV1).toEqual([{ n: '1' }]);
      await host.sweepNow(Date.now() + 1_000);
      expect(host.catalogInfo(hashV1)).not.toBeNull();

      // Once all v1 sessions close, sweepNow() reaps c_<hashV1> and r_<hashV1>.
      await Promise.all(burst.map((s) => s.close()));
      const dropsBefore = host.metrics.snapshot().catalogDbDropsTotal;
      const dropped = await host.sweepNow(Date.now() + 1_000);
      expect(dropped).toBeGreaterThanOrEqual(1);
      expect(host.catalogInfo(hashV1)).toBeNull();
      expect(host.metrics.snapshot().catalogDbDropsTotal).toBeGreaterThan(
        dropsBefore,
      );

      // Verify v1 DB & role are truly gone from PostgreSQL.
      const check = await v2Session.query<{ dbs: string; roles: string }>(
        `SELECT
          (SELECT count(*) FROM pg_database WHERE datname = 'c_${hashV1}')::text AS dbs,
          (SELECT count(*) FROM pg_roles WHERE rolname = 'r_${hashV1}')::text AS roles`,
      );
      expect(check).toEqual([{ dbs: '0', roles: '0' }]);
      await v2Session.close();
    }, 60_000);

    it('cleanly closes live sessions with 57P01 and recovers classifyre_tpl when the sidecar restarts', async () => {
      if (!pgCluster.isLocal || !pgCluster.restart) {
        return; // Only runs against local ephemeral Postgres we control
      }
      const client = await connect();
      let receivedError: { code?: string } | null = null;
      const closed = new Promise<void>((resolve) => {
        client.on('error', (err: Error & { code?: string }) => {
          receivedError = err;
          resolve();
        });
        client.on('end', () => resolve());
      });

      const restartsBefore = host.metrics.snapshot().sidecarRestartsTotal;
      pgCluster.restart();
      await closed;
      await client.end().catch(() => undefined);

      expect(receivedError).not.toBeNull();
      expect(receivedError!.code).toBe('57P01');
      expect(host.metrics.snapshot().sidecarRestartsTotal).toBeGreaterThan(
        restartsBefore,
      );

      // New connections recover automatically without restarting the gateway.
      expect(await host.ping()).toBe(true);
      const recovered = await connect();
      const res = await recovered.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'shop.public'`,
      );
      expect(res.rows).toEqual([{ table_name: 'orders' }]);
      await recovered.end();
    }, 60_000);
  });
});

/** A protocol-3.0 StartupMessage, as every driver sends first. */
function startupMessage(params: Record<string, string>): Buffer {
  const w = new MessageWriter().int32(196608);
  for (const [key, value] of Object.entries(params))
    w.cstring(key).cstring(value);
  return w.cstring('').build();
}

/**
 * A raw protocol connection to the test listener: what a driver writes,
 * message by message, and every reply up to each ReadyForQuery.
 */
async function rawSession(port: number) {
  const socket = connectRaw(port);
  const reader = new MessageReader();
  const inbox: { type: string; body: Buffer }[] = [];
  let wake: (() => void) | undefined;
  let codes: string[] = [];
  socket.on('data', (chunk: Buffer) => {
    inbox.push(...reader.push(chunk));
    wake?.();
  });
  const untilReady = async () => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const at = inbox.findIndex((m) => m.type === 'Z');
      if (at >= 0) {
        const reply = inbox.splice(0, at + 1);
        codes = reply
          .filter((m) => m.type === 'E')
          .map((m) => errorCode(m.body));
        return reply.map((m) => m.type);
      }
      if (Date.now() > deadline) {
        throw new Error(
          `no ReadyForQuery; got ${inbox.map((m) => m.type).join('')}`,
        );
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 200);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  };
  socket.write(startupMessage({ user: 'ana_bi', database: 'lab' }));
  await untilReady();
  return { socket, untilReady, codes: () => codes };
}

/** The `C` (SQLSTATE) field of an ErrorResponse body. */
function errorCode(body: Buffer): string {
  let at = 0;
  while (at < body.length && body[at] !== 0) {
    const type = String.fromCharCode(body[at]);
    const end = body.indexOf(0, at + 1);
    if (type === 'C') return body.subarray(at + 1, end).toString('utf8');
    at = end + 1;
  }
  return '';
}

interface CorpusEntry {
  kind: 'session' | 'catalog' | 'data' | 'refused';
  label: string;
  minRows?: number;
  sql: string;
}

/** fixtures/client-corpus/*.sql, as [file, statements] (format: its README). */
function corpusFiles(): [string, CorpusEntry[]][] {
  const folder = join(__dirname, 'fixtures', 'client-corpus');
  return readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const entries: CorpusEntry[] = [];
      let current: CorpusEntry | undefined;
      for (const line of readFileSync(join(folder, name), 'utf8').split('\n')) {
        const head =
          /^-- @@ (session|catalog|data|refused) (\S+)(?: rows>=(\d+))?/.exec(
            line,
          );
        if (head) {
          current = {
            kind: head[1] as CorpusEntry['kind'],
            label: head[2],
            minRows: head[3] ? Number(head[3]) : undefined,
            sql: '',
          };
          entries.push(current);
        } else if (current && !line.startsWith('--')) {
          current.sql = `${current.sql}\n${line}`.trim();
        }
      }
      return [name, entries] as [string, CorpusEntry[]];
    });
}
