import {
  type AddressInfo,
  connect as connectRaw,
  createServer,
  type Server,
} from 'node:net';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, type QueryConfig } from 'pg';
import { catalogDdl } from './catalog-ddl';
import {
  MessageReader,
  MessageWriter,
  authenticationOk,
  frontend,
  readyForQuery,
} from './pg-protocol';
import { PgliteHost, type PgliteSession } from './pglite-host';
import {
  DataError,
  type DataRunner,
  PgSession,
  SessionEscape,
} from './pg-session';

/**
 * A real PGlite session behind a test listener (trust sign-in), spoken to by
 * node-postgres: what BI tools do, without the query jobs — the data runner
 * answers from fixed rows and records what it was asked.
 */
describe('PgSession over PGlite', () => {
  const host = new PgliteHost();
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
          rows: [
            [1n, 'a', '1.50', { micros: 1794564672000000n, kind: 'timestamp' }],
          ].concat([
            [2n, 'b', '2', null],
            [3n, 'c', '3', null],
          ] as never) as never,
          truncated: true,
        });
      }
      if (/^SELECT id, customer/.test(input.sql)) {
        return Promise.resolve({
          rows: [
            [1n, 'Ana'],
            [2n, 'Bo'],
          ],
          truncated: false,
        });
      }
      return Promise.resolve({
        rows: [
          [
            1n,
            'Ana',
            '12.50',
            { micros: 1794564672123456n, kind: 'timestamp' },
          ],
          [2n, 'Bo', null, null],
        ],
        truncated: false,
      });
    },
  };
  const sessions: PgliteSession[] = [];

  beforeAll(async () => {
    const ddl = catalogDdl(
      [
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
      ],
      {
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
      },
      'ana_bi',
    );
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
        const pg = await host.open('lab', ddl.sql);
        sessions.push(pg);
        const session = new PgSession(
          pg,
          ddl.dataSchemas,
          runner,
          (b) => socket.write(b),
          undefined,
          'ana_bi',
        );
        await session.start({ TimeZone: 'UTC' });
        socket.write(Buffer.concat([authenticationOk(), readyForQuery('I')]));
        const reader = new MessageReader();
        const onData = (chunk: Buffer) => {
          const messages = reader.push(chunk).filter((m) => m.type !== 'X');
          void session.receive(messages).catch((error: unknown) => {
            if (error instanceof SessionEscape) socket.destroy();
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
    server.close();
    await Promise.all(sessions.map((s) => s.close()));
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

  it.each([
    'SET SESSION AUTHORIZATION postgres',
    "DO $$ BEGIN EXECUTE 'SET SESSION AUTHORIZATION ' || 'postgres'; END $$",
    "SELECT set_config('session_authorization', 'postgres', false)",
  ])(
    'ends the session when it leaves its role: %s',
    async (sql) => {
      const client = await connect();
      client.on('error', () => undefined);
      await expect(client.query(sql)).rejects.toThrow();
      await client.end().catch(() => undefined);
    },
    60_000,
  );

  it('keeps the catalog read-only for the connection', async () => {
    const client = await connect();
    await expect(
      client.query(`CREATE TABLE public.x (id int)`),
    ).rejects.toThrow(/permission denied/);
    const who = await client.query(
      `SELECT current_user AS u, current_setting('is_superuser') AS su`,
    );
    expect(who.rows[0]).toEqual({ u: 'ana_bi', su: 'off' });
    await client.end();
  }, 60_000);

  it('answers the catalog from PGlite, with governance notes', async () => {
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
    expect(comment.rows[0]).toEqual({
      c: 'Customer — Who ordered',
      t: 'orders — Every order, one row each.',
      db: 'lab',
    });
    await client.end();
  }, 60_000);

  it('runs data statements as jobs, text and binary, with parameters', async () => {
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
    // Parsed from binary by node-postgres: right only if the bytes are.
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
    // Idle after statements, data and catalog alike: no transaction left open
    // by the gateway's own messages (psqlODBC acts on it with SAVEPOINTs).
    await client.query(`SELECT * FROM "shop.public".orders`);
    await client.query('SELECT 1');
    await expect(client.query('SAVEPOINT s')).rejects.toMatchObject({
      code: '25P01',
    });
    expect((await client.query('SELECT current_user AS u')).rows).toEqual([
      { u: 'ana_bi' },
    ]);
    await expect(
      client.query(`DELETE FROM "shop.public".orders`),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      client.query(`CREATE TABLE public.x (a int)`),
    ).rejects.toMatchObject({ code: '42501' });
    await client.end();
  }, 60_000);

  /**
   * What pgJDBC does with a fetch size inside a transaction (BIC J3, and
   * Metabase's downloads, M13): one Execute per page, each followed by Sync,
   * on a named portal. Every page must arrive; the last ends the result.
   * Spoken over a raw socket, message by message, as the driver does.
   */
  it('serves a portal page by page across Syncs in a transaction', async () => {
    const { socket, untilReady } = await rawSession(port);
    socket.write(frontend.query('BEGIN'));
    await untilReady();
    // pgJDBC binds the page portal to the *unnamed* statement…
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
    expect(first).toContain('s'); // PortalSuspended
    // …and between pages asks for column metadata through the unnamed
    // statement again: the portal keeps the statement it was bound from.
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
    // The page holding the last row may end the result, as here, or be
    // suspended with an empty last page, as PostgreSQL does: clients take both.
    while (page.includes('s')) {
      socket.write(
        Buffer.concat([frontend.execute('C_1', 1), frontend.sync()]),
      );
      page = await untilReady();
      rows += rowsOf(page);
    }
    expect(page).toContain('C'); // CommandComplete
    expect(page).not.toContain('E');
    expect(rows).toBe(2);
    socket.end();
  }, 60_000);

  /**
   * What psqlODBC does with UseDeclareFetch=1 (BIC D5, and Excel through it):
   * the SELECT runs in a cursor, read with FETCH, all in simple queries.
   */
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
    expect(first).toContain('T'); // the FETCH describes its rows
    socket.write(frontend.query('fetch 100 in "SQL_CUR0x1"'));
    const rest = await untilReady();
    expect(rowsOf(rest)).toBe(1);
    socket.write(frontend.query('fetch 100 in "SQL_CUR0x1"'));
    expect(rowsOf(await untilReady())).toBe(0);
    socket.write(frontend.query('close "SQL_CUR0x1";commit'));
    expect(await untilReady()).not.toContain('E');
    // A cursor over the catalog is still PGlite's own.
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
    // After a comment, options in another order: served (review c1).
    socket.write(
      frontend.query(
        `BEGIN;-- x\nDECLARE c1 BINARY NO SCROLL CURSOR FOR ${orders};fetch all in c1`,
      ),
    );
    expect(rowsOf(await untilReady())).toBe(2);
    expect(codes()).toEqual([]);
    // A second cursor of the same name (42P03), SCROLL and BACKWARD (0A000).
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
    // A failed block refuses everything, cursors too (25P02).
    socket.write(frontend.query('fetch 1 in c3'));
    await untilReady();
    expect(codes()).toEqual(['25P02']);
    socket.write(frontend.query('rollback'));
    await untilReady();
    // Through Parse/Bind/Execute: refused, not read from empty tables.
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
    // WITH HOLD declared in a block that rolls back is gone, as in PostgreSQL.
    socket.write(
      frontend.query(
        `BEGIN;declare h1 cursor with hold for ${orders};rollback`,
      ),
    );
    await untilReady();
    socket.write(frontend.query('fetch 1 in h1'));
    await untilReady();
    expect(codes()).toEqual(['34000']);
    // Committed, it outlives the block; a cursor without HOLD does not.
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
    // At most MAX_DATA_CURSORS open at once (53400).
    const declares = Array.from(
      { length: 8 },
      (_, i) => `declare m${i} cursor with hold for ${orders}`,
    ).join(';');
    socket.write(frontend.query(declares));
    await untilReady();
    expect(codes()).toEqual(['53400']);
    socket.end();
  }, 60_000);

  /**
   * The client corpus (fixtures/client-corpus, BIC §6): what Metabase,
   * psqlODBC and pgJDBC send, replayed statement by statement. A new driver
   * version that breaks a statement shows here, not at a customer's.
   */
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
  /** The SQLSTATEs of the errors in the last reply untilReady returned. */
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
