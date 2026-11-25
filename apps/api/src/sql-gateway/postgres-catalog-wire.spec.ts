import { pbkdf2Sync } from 'node:crypto';
import type { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { CatalogBackendDisconnectedError } from './catalog-backend';
import * as catalogPgConfig from './catalog-pg-config';
import {
  type CatalogPgConfig,
  catalogPgConfigFromEnv,
  isConnectionResetError,
  sanitizeWorkMem,
} from './catalog-pg-config';
import {
  CANCEL_REQUEST,
  MessageReader,
  MessageWriter,
  authenticationOk,
  authenticationSasl,
  authenticationSaslContinue,
  authenticationSaslFinal,
  backendKeyData,
  commandComplete,
  dataRow,
  errorResponse,
  frontend,
  readStartupPacket,
  readyForQuery,
  rowDescription,
} from './pg-protocol';
import {
  TEMPLATE_SETUP,
  buildProvisionStatements,
  buildSchemaGrantSql,
} from './postgres-catalog-ddl';
import {
  PG_AUTH,
  PgStartupAuth,
  PostgresCatalogSession,
  hmacSha256,
  md5Password,
  parseScramAttrs,
  planWireExchange,
  xorBuffers,
} from './postgres-catalog-wire';

describe('catalog-pg-config', () => {
  it('parses Unix socket, TCP fallback, workMem, and caps from env', () => {
    const unix = catalogPgConfigFromEnv({
      SQL_GATEWAY_CATALOG_PG_SOCKET: '/var/run/sql-catalog-pg',
      SQL_GATEWAY_CATALOG_WORK_MEM: '8MB',
      SQL_GATEWAY_CATALOG_STATEMENT_SECONDS: '20',
      SQL_GATEWAY_MAX_CATALOG_DBS: '128',
    });
    expect(unix.socketDir).toBe('/var/run/sql-catalog-pg');
    expect(unix.host).toBeUndefined();
    expect(unix.workMem).toBe('8MB');
    expect(unix.statementTimeoutMs).toBe(20_000);
    expect(unix.maxCatalogDbs).toBe(128);

    const tcp = catalogPgConfigFromEnv({});
    expect(tcp.host).toBe('127.0.0.1');
    expect(tcp.workMem).toBe('4MB');
  });

  it('rejects unsafe work_mem values and falls back to 4MB', () => {
    expect(sanitizeWorkMem('16MB')).toBe('16MB');
    expect(sanitizeWorkMem('512kB')).toBe('512kB');
    expect(sanitizeWorkMem("4MB'; DROP DATABASE x; --")).toBe('4MB');
    expect(sanitizeWorkMem('')).toBe('4MB');
  });

  it('detects connection reset and termination errors', () => {
    expect(isConnectionResetError({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isConnectionResetError({ code: '57P01' })).toBe(true);
    expect(
      isConnectionResetError(new Error('Connection terminated unexpectedly')),
    ).toBe(true);
    expect(isConnectionResetError({ code: '42501', message: 'denied' })).toBe(
      false,
    );
  });
});

describe('postgres-catalog-ddl', () => {
  it('builds hardened role and database provisioning SQL honoring workMem', () => {
    const stmts = buildProvisionStatements({
      dbName: 'c_0123456789abcdef01234567',
      roleName: 'r_0123456789abcdef01234567',
      password: 'pw',
      templateDb: 'classifyre_tpl',
      adminUser: 'classifyre_catalog',
      roleConnectionLimit: 64,
      statementTimeoutMs: 15_000,
      workMem: '8MB',
    });
    const joined = stmts.join('\n');
    expect(joined).toContain('NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT');
    expect(joined).toContain('SET default_transaction_read_only = on');
    expect(joined).toContain("SET statement_timeout = '15000ms'");
    expect(joined).toContain("SET work_mem = '8MB'");
    expect(joined).toContain("SET temp_file_limit = '0'");
    expect(joined).toContain('REVOKE ALL ON DATABASE');
    expect(joined).toContain('REVOKE TEMP ON DATABASE');
    expect(joined).toContain('GRANT CONNECT ON DATABASE');
    expect(TEMPLATE_SETUP).toContain('SECURITY INVOKER');
    expect(TEMPLATE_SETUP).toContain("'pg_sleep'");
  });

  it('builds read-only USAGE and SELECT grants for data schemas', () => {
    const sql = buildSchemaGrantSql(
      new Set(['shop.public']),
      'r_0123456789abcdef01234567',
    );
    expect(sql).toContain(
      'GRANT USAGE ON SCHEMA "shop.public" TO "r_0123456789abcdef01234567";',
    );
    expect(sql).toContain(
      'GRANT SELECT ON ALL TABLES IN SCHEMA "shop.public" TO "r_0123456789abcdef01234567";',
    );
    expect(sql).not.toContain('GRANT ALL');
  });
});

describe('postgres-catalog-wire helpers and PgStartupAuth', () => {
  it('plans wire expectations and auto-flush for extended vs simple batches', () => {
    const simple = planWireExchange(frontend.query('SELECT 1'));
    expect(simple).toEqual({ expectations: ['ready'], needsFlush: false });

    const synced = planWireExchange(
      Buffer.concat([frontend.parse('s', 'SELECT 1'), frontend.sync()]),
    );
    expect(synced).toEqual({
      expectations: ['parse', 'ready'],
      needsFlush: false,
    });

    const extended = planWireExchange(
      Buffer.concat([
        frontend.bind('p', 's', []),
        frontend.describe('P', 'p'),
        frontend.execute('p'),
        frontend.close('P', 'p'),
      ]),
    );
    expect(extended).toEqual({
      expectations: ['bind', 'describeP', 'execute', 'close'],
      needsFlush: true,
    });

    const descStmt = planWireExchange(frontend.describe('S', 's'));
    expect(descStmt).toEqual({
      expectations: ['describeS'],
      needsFlush: true,
    });
  });

  it('implements MD5 and SCRAM attribute/XOR helpers accurately', () => {
    expect(parseScramAttrs('r=nonce123,s=c2FsdA==,i=4096')).toEqual({
      r: 'nonce123',
      s: 'c2FsdA==',
      i: '4096',
    });
    expect(
      xorBuffers(Buffer.from([0xaa, 0x0f]), Buffer.from([0x55, 0xf0])),
    ).toEqual(Buffer.from([0xff, 0xff]));
    expect(md5Password('alice', 'secret', Buffer.from([1, 2, 3, 4]))).toMatch(
      /^md5[0-9a-f]{32}$/,
    );
  });

  it('completes OK, cleartext, MD5, and full SCRAM-SHA-256 handshakes and rejects tampering', () => {
    const okAuth = new PgStartupAuth('r_user', 'pw');
    expect(okAuth.handle(authenticationOk().subarray(5))).toBeNull();

    const clearReply = okAuth.handle(
      new MessageWriter()
        .int32(PG_AUTH.CLEARTEXT_PASSWORD)
        .build('R')
        .subarray(5),
    );
    expect(clearReply).toEqual(frontend.password('pw'));

    const salt = Buffer.from([1, 2, 3, 4]);
    const md5Reply = okAuth.handle(
      new MessageWriter()
        .int32(PG_AUTH.MD5_PASSWORD)
        .bytes(salt)
        .build('R')
        .subarray(5),
    );
    expect(md5Reply).toEqual(
      frontend.password(md5Password('r_user', 'pw', salt)),
    );

    // Full SCRAM-SHA-256 handshake with deterministic client nonce.
    const scram = new PgStartupAuth('r_user', 's3cr3t', () => 'clientNonce');
    const saslInit = scram.handle(
      authenticationSasl(['SCRAM-SHA-256']).subarray(5),
    );
    expect(saslInit?.toString('utf8')).toContain('SCRAM-SHA-256');
    expect(saslInit?.toString('utf8')).toContain('n,,n=,r=clientNonce');

    const serverFirst = 'r=clientNonceServerPart,s=c2FsdA==,i=16';
    const saslClientFinal = scram.handle(
      authenticationSaslContinue(serverFirst).subarray(5),
    );
    expect(saslClientFinal?.toString('utf8')).toContain(
      'c=biws,r=clientNonceServerPart,p=',
    );

    const salted = pbkdf2Sync(
      's3cr3t',
      Buffer.from('c2FsdA==', 'base64'),
      16,
      32,
      'sha256',
    );
    const serverKey = hmacSha256(salted, 'Server Key');
    const authMessage = `n=,r=clientNonce,${serverFirst},c=biws,r=clientNonceServerPart`;
    const serverSig = hmacSha256(serverKey, authMessage).toString('base64');

    expect(
      scram.handle(authenticationSaslFinal(`v=${serverSig}`).subarray(5)),
    ).toBeNull();

    // Tampered server signature fails verification.
    expect(() =>
      scram.handle(authenticationSaslFinal('v=AAAA').subarray(5)),
    ).toThrow('SCRAM server signature verification failed');

    // Invalid server nonce fails verification.
    const badNonce = new PgStartupAuth('r_user', 'pw', () => 'expectedNonce');
    badNonce.handle(authenticationSasl(['SCRAM-SHA-256']).subarray(5));
    expect(() =>
      badNonce.handle(
        authenticationSaslContinue('r=wrongNonce,s=c2FsdA==,i=16').subarray(5),
      ),
    ).toThrow('Invalid SCRAM server nonce');

    // Unsupported auth type throws.
    expect(() =>
      okAuth.handle(new MessageWriter().int32(99).build('R').subarray(5)),
    ).toThrow('Unsupported PostgreSQL auth method: 99');
  });
});

class FakeSocket extends PassThrough {
  private readonly peer: PassThrough;

  constructor(peer: PassThrough) {
    super();
    this.peer = peer;
  }

  override write(
    chunk: unknown,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    cb?: (error?: Error | null) => void,
  ): boolean {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    this.peer.push(buf);
    if (typeof encoding === 'function') encoding(null);
    else if (cb) cb(null);
    return true;
  }

  override end(chunk?: unknown, encoding?: unknown, cb?: unknown): this {
    if (chunk !== undefined && typeof chunk !== 'function') {
      this.write(chunk);
    }
    this.peer.push(null);
    super.end();
    if (typeof chunk === 'function') (chunk as () => void)();
    else if (typeof encoding === 'function') (encoding as () => void)();
    else if (typeof cb === 'function') (cb as () => void)();
    return this;
  }

  setNoDelay(): this {
    return this;
  }
}

function createFakeSocketPair(): { client: FakeSocket; server: FakeSocket } {
  const client = new PassThrough();
  const server = new PassThrough();
  const clientSock = new FakeSocket(server);
  const serverSock = new FakeSocket(client);
  client.on('data', (d: Buffer) => clientSock.push(d));
  client.on('end', () => clientSock.emit('close'));
  server.on('data', (d: Buffer) => serverSock.push(d));
  server.on('end', () => serverSock.emit('close'));
  return { client: clientSock, server: serverSock };
}

describe('PostgresCatalogSession wire framing, timeout, and disconnect', () => {
  function mockConfig(
    overrides: Partial<CatalogPgConfig> = {},
  ): CatalogPgConfig {
    return {
      ...catalogPgConfigFromEnv({
        SQL_GATEWAY_CATALOG_PG_SOCKET: '/tmp/mock-pg',
      }),
      port: 5432,
      ...overrides,
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubMockPg(
    onMessage: (
      socket: FakeSocket,
      msg: { type: string; body: Buffer },
    ) => void,
    onCancel?: (pid: number, secret: number) => void,
  ): void {
    jest
      .spyOn(catalogPgConfig, 'connectCatalogSocket')
      .mockImplementation(() => {
        const { client, server } = createFakeSocketPair();
        let started = false;
        let startupBuf = Buffer.alloc(0);
        const reader = new MessageReader();
        server.on('data', (chunk: Buffer) => {
          if (!started) {
            startupBuf = Buffer.concat([startupBuf, chunk]);
            const pkt = readStartupPacket(startupBuf);
            if (!pkt || startupBuf.length < pkt.length) return;
            if (pkt.code === CANCEL_REQUEST) {
              onCancel?.(startupBuf.readInt32BE(8), startupBuf.readInt32BE(12));
              server.end();
              return;
            }
            started = true;
            const rest = startupBuf.subarray(pkt.length);
            server.write(
              Buffer.concat([
                authenticationOk(),
                backendKeyData(4242, 9999),
                readyForQuery('I'),
              ]),
            );
            if (rest.length > 0) {
              for (const m of reader.push(rest)) onMessage(server, m);
            }
            return;
          }
          for (const m of reader.push(chunk)) onMessage(server, m);
        });
        queueMicrotask(() => client.emit('connect'));
        return client as unknown as Socket;
      });
  }

  it('reassembles chunked responses, auto-flushes extended batches, and parses query rows', async () => {
    const receivedTypes: string[] = [];
    stubMockPg((socket, msg) => {
      receivedTypes.push(msg.type);
      if (msg.type === 'Q') {
        const reply = Buffer.concat([
          rowDescription([
            {
              name: 'greeting',
              tableOid: 0,
              column: 1,
              typeOid: 25,
              typeSize: -1,
              typeModifier: -1,
              format: 0,
            },
          ]),
          dataRow([Buffer.from('hello', 'utf8')]),
          commandComplete('SELECT 1'),
          readyForQuery('I'),
        ]);
        // Deliver split across tiny chunks to exercise MessageReader reassembly.
        socket.write(reply.subarray(0, 7));
        setTimeout(() => socket.write(reply.subarray(7)), 5);
      } else if (msg.type === 'H') {
        socket.write(new MessageWriter().build('1')); // ParseComplete
      }
    });

    let closed = 0;
    const session = await PostgresCatalogSession.connect({
      config: mockConfig(),
      database: 'c_test',
      role: 'r_test',
      password: 'pw',
      onClose: () => {
        closed += 1;
      },
      onBackendLost: () => undefined,
    });

    const rows = await session.query<{ greeting: string }>(
      "SELECT 'hello' AS greeting",
    );
    expect(rows).toEqual([{ greeting: 'hello' }]);

    // Extended Parse without Sync auto-appends Flush ('H').
    const rawReply = await session.raw(frontend.parse('s1', 'SELECT 1'));
    expect(rawReply[0]).toBe('1'.charCodeAt(0));
    expect(receivedTypes).toContain('H');

    await session.close();
    expect(closed).toBe(1);
  });

  it('rejects exec() on ErrorResponse, times out stalled queries with cancel, and propagates disconnects', async () => {
    const cancels: [number, number][] = [];
    stubMockPg(
      (socket, msg) => {
        if (msg.type === 'Q') {
          const sql = msg.body.toString('utf8');
          if (sql.includes('FAIL')) {
            socket.write(
              Buffer.concat([
                errorResponse({ code: '42501', message: 'permission denied' }),
                readyForQuery('I'),
              ]),
            );
          } else if (sql.includes('DROP_ME')) {
            socket.end();
          }
          // 'HANG' intentionally never replies so backstop timer fires.
        }
      },
      (pid, secret) => cancels.push([pid, secret]),
    );

    // 1. ErrorResponse on exec()
    const s1 = await PostgresCatalogSession.connect({
      config: mockConfig(),
      database: 'c_test',
      role: 'r_test',
      password: 'pw',
      onClose: () => undefined,
      onBackendLost: () => undefined,
    });
    await expect(s1.exec('SELECT FAIL')).rejects.toThrow('permission denied');

    // 2. Unexpected backend disconnect notifies listeners & rejects in-flight raw()
    let lost = 0;
    let disconnectErr: Error | null = null;
    const sDrop = await PostgresCatalogSession.connect({
      config: mockConfig(),
      database: 'c_test',
      role: 'r_test',
      password: 'pw',
      onClose: () => undefined,
      onBackendLost: () => {
        lost += 1;
      },
    });
    sDrop.onDisconnect((err) => {
      disconnectErr = err;
    });
    await expect(sDrop.raw(frontend.query('SELECT DROP_ME'))).rejects.toThrow(
      CatalogBackendDisconnectedError,
    );
    expect(lost).toBe(1);
    expect(disconnectErr).toBeInstanceOf(CatalogBackendDisconnectedError);

    // 3. Stalled query hits backstop timeout and dispatches PG CancelRequest
    const sHang = await PostgresCatalogSession.connect({
      // backstopMs = statementTimeoutMs + 5000 => ~80 ms for fast unit test
      config: mockConfig({ statementTimeoutMs: -4_920 }),
      database: 'c_test',
      role: 'r_test',
      password: 'pw',
      onClose: () => undefined,
      onBackendLost: () => undefined,
    });
    await expect(sHang.raw(frontend.query('SELECT HANG'))).rejects.toThrow(
      'A catalog statement ran too long.',
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(cancels).toEqual([[4242, 9999]]);
    await s1.close();
  });
});
