import { type AddressInfo, createServer, type Server } from 'node:net';
import { Client, type QueryConfig } from 'pg';
import { catalogDdl } from './catalog-ddl';
import { MessageReader, authenticationOk, readyForQuery } from './pg-protocol';
import { PgliteHost, type PgliteSession } from './pglite-host';
import { DataError, type DataRunner, PgSession } from './pg-session';

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
        const session = new PgSession(pg, ddl.dataSchemas, runner, (b) =>
          socket.write(b),
        );
        await session.start({ TimeZone: 'UTC' });
        socket.write(Buffer.concat([authenticationOk(), readyForQuery('I')]));
        const reader = new MessageReader();
        const onData = (chunk: Buffer) => {
          const messages = reader.push(chunk).filter((m) => m.type !== 'X');
          void session.receive(messages);
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
});
