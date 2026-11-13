import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { type Server, type Socket, createServer } from 'node:net';
import { type SecureContext, TLSSocket, createSecureContext } from 'node:tls';
import { tableFromIPC } from 'apache-arrow';
import { QueryRunStatus } from '@prisma/client';
import { NamespaceRegistryService } from '../registry/namespace-registry.service';
import { PrismaClientManager } from '../prisma/prisma-client-manager';
import { PrismaService } from '../prisma.service';
import {
  CLS_DATABASE_LANE,
  CLS_NAMESPACE_ID,
  CLS_SCHEMA,
  CLS_SLUG,
  type NamespaceContext,
} from '../namespace/namespace.constants';
import { IDENTITY } from '../identity/identity.tokens';
import type { IdentityService, Principal } from '../identity/identity.service';
import type { Capability } from '../identity/capabilities';
import { applyPrincipalContext } from '../identity/principal-context';
import { QueryCatalogService } from '../data-query/query-catalog.service';
import { QueryRunService } from '../data-query/query-run.service';
import { CLS_CONNECTION_SCOPE } from '../data-query/connection-scope';
import { DataConnectionService } from '../sql-connections/data-connection.service';
import {
  ScramError,
  ScramExchange,
  scramVerifier,
} from '../sql-connections/scram';
import { runsSqlGateway } from '../service-role';
import {
  CANCEL_REQUEST,
  GSSENC_REQUEST,
  MessageReader,
  PROTOCOL_V3,
  SSL_REQUEST,
  authenticationOk,
  authenticationSasl,
  authenticationSaslContinue,
  authenticationSaslFinal,
  backendKeyData,
  errorResponse,
  parameterStatus,
  parseSaslInitial,
  parseStartupParameters,
  readyForQuery,
} from './pg-protocol';
import { catalogDdl, type CatalogNotes } from './catalog-ddl';
import { PgliteHost } from './pglite-host';
import {
  DataError,
  type DataResult,
  type DataRunner,
  PgSession,
} from './pg-session';
import { plainValue } from './pg-types';
import { readProxyHeader } from './proxy-protocol';

/** A connection's session settings a client may bring in its startup packet. */
const STARTUP_SETTINGS = new Set([
  'application_name',
  'search_path',
  'extra_float_digits',
  'datestyle',
  'intervalstyle',
  'statement_timeout',
]);

const SWEEP_MS = 30_000;
const PRINCIPAL_TTL_MS = 5 * 60_000;
const LOCKOUT_WINDOW_MS = 15 * 60_000;
const LOCKOUT_FAILURES = 10;

/** Error codes of query runs, as the SQLSTATE a PostgreSQL client expects. */
const SQLSTATE: Record<string, string> = {
  invalid_sql: '42601',
  select_only: '25006',
  function_not_allowed: '42501',
  table_name_required: '42P01',
  table_not_available: '42501',
  timeout: '57014',
  result_too_large: '54000',
  too_many_queries: '53000',
  too_many_sources: '54000',
};

interface Config {
  port: number;
  host: string;
  tls: SecureContext | null;
  allowPlaintext: boolean;
  proxyProtocol: boolean;
  allowedCidrs: string[];
  maxSessions: number;
  maxPerConnection: number;
  idleMs: number;
}

interface Live {
  pid: number;
  secret: number;
  connectionId: string;
  ns: NamespaceContext;
  socket: Socket;
  session: PgSession;
  principal: { value: Principal; capabilities: Set<Capability>; at: number };
}

function readConfig(): Config | null {
  if (!/^(1|true|yes|on)$/i.test(process.env.SQL_GATEWAY_ENABLED ?? ''))
    return null;
  const cert = process.env.SQL_GATEWAY_TLS_CERT_FILE?.trim();
  const key = process.env.SQL_GATEWAY_TLS_KEY_FILE?.trim();
  const tls =
    cert && key
      ? createSecureContext({
          cert: readFileSync(cert),
          key: readFileSync(key),
          minVersion: 'TLSv1.2',
        })
      : null;
  return {
    port: Number(process.env.SQL_GATEWAY_PORT) || 5432,
    host: process.env.SQL_GATEWAY_HOST?.trim() || '0.0.0.0',
    tls,
    allowPlaintext: /^(1|true|yes|on)$/i.test(
      process.env.SQL_GATEWAY_ALLOW_PLAINTEXT ?? '',
    ),
    proxyProtocol: /^(1|true|yes|on)$/i.test(
      process.env.SQL_GATEWAY_PROXY_PROTOCOL ?? '',
    ),
    allowedCidrs: (process.env.SQL_GATEWAY_ALLOWED_CIDRS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxSessions: Number(process.env.SQL_GATEWAY_MAX_SESSIONS) || 16,
    maxPerConnection:
      Number(process.env.SQL_GATEWAY_MAX_SESSIONS_PER_CONNECTION) || 4,
    idleMs: (Number(process.env.SQL_GATEWAY_IDLE_MINUTES) || 30) * 60_000,
  };
}

/** Whether an IPv4/IPv6 address is inside a CIDR (IPv4-mapped IPv6 counts as IPv4). */
export function inCidr(address: string, cidr: string): boolean {
  const ip = address.replace(/^::ffff:/, '');
  const [base, bitsText] = cidr.split('/');
  if (ip.includes(':') !== base.includes(':')) return false;
  const toBits = (a: string) =>
    a.includes(':')
      ? expandV6(a)
          .map((h) => parseInt(h, 16).toString(2).padStart(16, '0'))
          .join('')
      : a
          .split('.')
          .map((o) => Number(o).toString(2).padStart(8, '0'))
          .join('');
  const bits = Number(bitsText ?? (base.includes(':') ? 128 : 32));
  return toBits(ip).slice(0, bits) === toBits(base).slice(0, bits);
}

function expandV6(address: string): string[] {
  const [head, tail = ''] = address.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  return [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
}

/** Reads untyped startup packets, then typed messages, from a socket. */
class Incoming {
  private buffer = Buffer.alloc(0);
  private wake: (() => void) | null = null;
  private ended = false;
  private readonly onData = (chunk: Buffer) => {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.wake?.();
  };
  private readonly onEnd = () => {
    this.ended = true;
    this.wake?.();
  };

  constructor(private readonly socket: Socket) {
    socket.on('data', this.onData);
    socket.on('end', this.onEnd);
    socket.on('close', this.onEnd);
  }

  private async need(bytes: number): Promise<void> {
    while (this.buffer.length < bytes) {
      if (this.ended) throw new Error('Client went away.');
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = null;
    }
  }

  async peek(bytes: number): Promise<Buffer> {
    await this.need(bytes);
    return this.buffer.subarray(0, bytes);
  }

  take(bytes: number): Buffer {
    const out = this.buffer.subarray(0, bytes);
    this.buffer = this.buffer.subarray(bytes);
    return out;
  }

  /** A length-prefixed packet without a type byte (startup, SSLRequest, cancel). */
  async packet(): Promise<Buffer> {
    await this.need(4);
    const length = this.buffer.readInt32BE(0);
    if (length < 8 || length > 10_000) throw new Error('Bad startup packet.');
    await this.need(length);
    return Buffer.from(this.take(length));
  }

  /** One typed message (during sign-in). */
  async message(): Promise<{ type: string; body: Buffer }> {
    await this.need(5);
    const length = this.buffer.readInt32BE(1);
    if (length < 4 || length > 1_000_000) throw new Error('Bad message.');
    await this.need(1 + length);
    const raw = Buffer.from(this.take(1 + length));
    return { type: String.fromCharCode(raw[0]), body: raw.subarray(5) };
  }

  /** Stops reading; returns what was read but not used. */
  detach(): Buffer {
    // Stop the flow first: bytes put back with unshift() (a direct-TLS
    // ClientHello) must wait for the next reader, not be emitted to nobody.
    this.socket.pause();
    this.socket.off('data', this.onData);
    this.socket.off('end', this.onEnd);
    this.socket.off('close', this.onEnd);
    const rest = this.buffer;
    this.buffer = Buffer.alloc(0);
    return rest;
  }
}

class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The SQL gateway (docs/prd/DQ-data-query.md §5.7): a PostgreSQL endpoint for
 * BI tools and drivers. TLS always (STARTTLS with SSLRequest, or direct TLS
 * as libpq 17's `sslnegotiation=direct`), SCRAM-SHA-256 against a SQL
 * connection's verifier, the workspace as the database. Each signed-in
 * session gets its own PGlite with the person's catalog; each data statement
 * runs as a query job for the connection's person, audited with the
 * connection. Runs in the `sql` (or `all`) process role when
 * `SQL_GATEWAY_ENABLED` is set.
 */
@Injectable()
export class SqlGatewayService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SqlGatewayService.name);
  private server: Server | null = null;
  private config: Config | null = null;
  private readonly host = new PgliteHost();
  private readonly live = new Map<number, Live>();
  private readonly failures = new Map<string, number[]>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly cls: ClsService,
    private readonly registry: NamespaceRegistryService,
    private readonly prismaManager: PrismaClientManager,
    private readonly prisma: PrismaService,
    private readonly catalog: QueryCatalogService,
    private readonly queryRuns: QueryRunService,
    private readonly connections: DataConnectionService,
    @Inject(IDENTITY) private readonly identity: IdentityService,
  ) {}

  onModuleInit(): void {
    if (!runsSqlGateway()) return;
    const config = readConfig();
    if (!config) return;
    if (!config.tls && !config.allowPlaintext) {
      this.logger.error(
        'SQL gateway not started: set SQL_GATEWAY_TLS_CERT_FILE and SQL_GATEWAY_TLS_KEY_FILE (or SQL_GATEWAY_ALLOW_PLAINTEXT for local development only).',
      );
      return;
    }
    this.config = config;
    this.server = createServer((socket) => void this.accept(socket));
    this.server.on('error', (error) =>
      this.logger.error(`SQL gateway listener: ${error.message}`),
    );
    this.server.listen(config.port, config.host, () =>
      this.logger.log(
        `SQL gateway listening on ${config.host}:${config.port} (${config.tls ? 'TLS' : 'PLAINTEXT — development only'})`,
      ),
    );
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_MS);
    this.sweeper.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.server?.close();
    await Promise.all(
      [...this.live.values()].map((l) =>
        this.end(l, '57P01', 'The SQL gateway is shutting down.'),
      ),
    );
  }

  // ── Accepting ─────────────────────────────────────────────────────────

  private async accept(raw: Socket): Promise<void> {
    const config = this.config!;
    raw.setNoDelay(true);
    raw.setKeepAlive(true, 60_000);
    raw.on('error', () => undefined);
    let socket: Socket = raw;
    let incoming = new Incoming(raw);
    let client = raw.remoteAddress ?? null;
    try {
      if (config.proxyProtocol) {
        const proxied = await readProxyHeader(incoming);
        if (proxied) client = proxied;
      }
      if (config.allowedCidrs.length && client) {
        const ip = client;
        if (!config.allowedCidrs.some((cidr) => inCidr(ip, cidr))) {
          throw new Refusal(
            '28000',
            'Connections from this address are not allowed.',
          );
        }
      }
      let secure = false;
      const first = await incoming.peek(1);
      if (first[0] === 0x16) {
        // Direct TLS (libpq 17 `sslnegotiation=direct`): a TLS ClientHello first.
        if (!config.tls)
          throw new Refusal('08P01', 'TLS is not configured here.');
        ({ socket, incoming } = await this.upgrade(
          socket,
          incoming,
          config.tls,
        ));
        secure = true;
      }
      for (;;) {
        const packet = await incoming.packet();
        const code = packet.readInt32BE(4);
        if (code === SSL_REQUEST && !secure) {
          if (!config.tls) {
            socket.write('N');
            continue;
          }
          socket.write('S');
          ({ socket, incoming } = await this.upgrade(
            socket,
            incoming,
            config.tls,
          ));
          secure = true;
          continue;
        }
        if (code === GSSENC_REQUEST) {
          socket.write('N');
          continue;
        }
        if (code === CANCEL_REQUEST) {
          this.cancel(packet.readInt32BE(8), packet.readInt32BE(12));
          socket.destroy();
          return;
        }
        if (code !== PROTOCOL_V3) {
          throw new Refusal(
            '0A000',
            'Only PostgreSQL protocol 3.0 is supported.',
          );
        }
        if (!secure && !config.allowPlaintext) {
          throw new Refusal(
            '28000',
            'Connect with TLS (sslmode=require or stronger).',
          );
        }
        await this.signIn(
          socket,
          incoming,
          parseStartupParameters(packet.subarray(8)),
          client,
        );
        return;
      }
    } catch (error) {
      if (error instanceof Refusal) {
        socket.end(
          errorResponse({
            severity: 'FATAL',
            code: error.code,
            message: error.message,
          }),
        );
      } else {
        socket.destroy();
      }
    }
  }

  private async upgrade(
    socket: Socket,
    incoming: Incoming,
    context: SecureContext,
  ): Promise<{ socket: Socket; incoming: Incoming }> {
    const rest = incoming.detach();
    if (rest.length) socket.unshift(rest);
    const tlsSocket = new TLSSocket(socket, {
      isServer: true,
      secureContext: context,
      ALPNProtocols: ['postgresql'],
    });
    tlsSocket.on('error', () => undefined);
    const next = new Incoming(tlsSocket);
    await new Promise<void>((resolve, reject) => {
      tlsSocket.once('secure', resolve);
      tlsSocket.once('error', reject);
      tlsSocket.once('close', () => reject(new Error('TLS handshake failed.')));
    });
    return { socket: tlsSocket, incoming: next };
  }

  // ── Signing in ────────────────────────────────────────────────────────

  private lockedOut(key: string): boolean {
    const now = Date.now();
    const recent = (this.failures.get(key) ?? []).filter(
      (t) => now - t < LOCKOUT_WINDOW_MS,
    );
    this.failures.set(key, recent);
    return recent.length >= LOCKOUT_FAILURES;
  }

  private failed(key: string): void {
    this.failures.set(key, [...(this.failures.get(key) ?? []), Date.now()]);
  }

  private async signIn(
    socket: Socket,
    incoming: Incoming,
    params: Record<string, string>,
    client: string | null,
  ): Promise<void> {
    const config = this.config!;
    const username = (params.user ?? '').toLowerCase();
    const database = params.database ?? username;
    if (!username)
      throw new Refusal('28000', 'Give a user name: the SQL connection’s.');
    const ns = await this.registry.resolve(database).catch(() => null);
    if (!ns)
      throw new Refusal('3D000', `database "${database}" does not exist`);
    const keys = [`u:${ns.namespaceId}:${username}`, `ip:${client ?? '-'}`];
    if (keys.some((key) => this.lockedOut(key))) {
      throw new Refusal(
        '28000',
        'Too many failed sign-ins; try again in 15 minutes.',
      );
    }
    const found = await this.inWorkspace(ns, () =>
      this.connections.forSignIn(username),
    );
    const verifier =
      found?.row.scramStoredKey &&
      found.row.scramSalt &&
      found.row.scramServerKey
        ? {
            salt: found.row.scramSalt,
            iterations: found.row.scramIterations ?? 4096,
            storedKey: found.row.scramStoredKey,
            serverKey: found.row.scramServerKey,
          }
        : // An unknown name goes through the same exchange, so a client cannot
          // tell a wrong name from a wrong password.
          scramVerifier(randomBytes(24).toString('base64url'));
    const exchange = new ScramExchange(verifier);
    socket.write(authenticationSasl(['SCRAM-SHA-256']));
    try {
      const initial = await incoming.message();
      if (initial.type !== 'p')
        throw new ScramError('Expected SASLInitialResponse.');
      const sasl = parseSaslInitial(initial.body);
      if (sasl.mechanism !== 'SCRAM-SHA-256') {
        throw new ScramError(`Unsupported mechanism ${sasl.mechanism}.`);
      }
      socket.write(authenticationSaslContinue(exchange.start(sasl.data)));
      const response = await incoming.message();
      if (response.type !== 'p') throw new ScramError('Expected SASLResponse.');
      const final = exchange.finish(response.body.toString('utf8'));
      if (!found || found.status !== 'active') {
        throw new ScramError(
          found ? `connection ${found.status}` : 'unknown user',
        );
      }
      socket.write(authenticationSaslFinal(final));
    } catch (error) {
      if (!(error instanceof ScramError)) throw error;
      keys.forEach((key) => this.failed(key));
      const why =
        found && found.status !== 'active'
          ? found.status === 'pending'
            ? 'pending: its person has not revealed the password yet'
            : found.status
          : error.message;
      await this.inWorkspace(ns, () =>
        this.connections.recordSignInFailure(
          found?.row ?? null,
          username,
          client,
          why,
        ),
      );
      const message =
        found && found.status === 'revoked'
          ? 'This SQL connection was revoked.'
          : found && found.status === 'expired'
            ? 'This SQL connection has expired.'
            : `password authentication failed for user "${username}"`;
      throw new Refusal('28P01', message);
    }
    const row = found.row;
    const live = [...this.live.values()];
    if (live.length >= config.maxSessions) {
      throw new Refusal('53300', 'The SQL gateway is busy; try again shortly.');
    }
    if (
      live.filter((l) => l.connectionId === row.id).length >=
      config.maxPerConnection
    ) {
      throw new Refusal(
        '53300',
        `This SQL connection has ${config.maxPerConnection} sessions open already.`,
      );
    }
    const sub = row.personRef.replace(/^user:/, '');
    const principal = await this.identity.principalFor(sub, ns.namespaceId, {
      kind: 'sql',
      id: row.id,
    });
    if (!principal) {
      throw new Refusal(
        '28000',
        'The person this SQL connection belongs to no longer has access to this workspace.',
      );
    }
    const principalState = {
      value: principal.principal,
      capabilities: principal.capabilities,
      at: Date.now(),
    };
    socket.write(authenticationOk());

    // The catalog: what the person may read through this connection right now.
    const scope = DataConnectionService.scopeOf(row);
    const { ddl, notes } = await this.within(
      ns,
      principalState,
      row.id,
      async () => {
        const catalog = await this.catalog.catalog();
        const sources = catalog.sources.map((s) => ({
          ...s,
          tables: s.tables.filter((t) => t.canQuery),
        }));
        const notes = await this.notes(
          sources.flatMap((s) => s.tables.map((t) => t.assetId)),
        );
        return { ddl: catalogDdl(sources, notes, row.username), notes };
      },
      scope,
    );
    void notes;
    const pg = await this.host.open(ns.slug, ddl.sql);
    const pid = randomInt(1, 2_147_483_647);
    const secret = randomInt(1, 2_147_483_647);
    const entry = {} as Live;
    const session = new PgSession(
      pg,
      ddl.dataSchemas,
      this.runner(entry),
      (bytes) => socket.write(bytes),
      /^(1|true|yes|on)$/i.test(process.env.SQL_GATEWAY_TRACE ?? '')
        ? (line) => this.logger.log(`sql ${pid}: ${line}`)
        : undefined,
    );
    Object.assign(entry, {
      pid,
      secret,
      connectionId: row.id,
      ns,
      socket,
      session,
      principal: principalState,
    } satisfies Live);
    const settings: Record<string, string> = { TimeZone: 'UTC' };
    for (const [key, value] of Object.entries(params)) {
      if (STARTUP_SETTINGS.has(key.toLowerCase())) settings[key] = value;
    }
    await session.start(settings);
    this.live.set(pid, entry);
    await this.inWorkspace(ns, () =>
      this.connections.markUsed(row.id, client, row.lastUsedAt),
    );

    const status = await pg.query<{ name: string; setting: string }>(
      `SELECT name, setting FROM pg_settings WHERE name IN ('server_version','server_encoding','client_encoding','DateStyle','IntervalStyle','TimeZone','integer_datetimes','standard_conforming_strings','application_name')`,
    );
    const out: Buffer[] = status.map((s) => parameterStatus(s.name, s.setting));
    out.push(
      parameterStatus('is_superuser', 'off'),
      parameterStatus('session_authorization', username),
      parameterStatus('default_transaction_read_only', 'on'),
      parameterStatus('in_hot_standby', 'off'),
      backendKeyData(pid, secret),
      readyForQuery('I'),
    );
    socket.write(Buffer.concat(out));
    this.logger.log(
      `SQL connection ${row.username} signed in to ${ns.slug} from ${client ?? 'unknown'} (${ddl.tables} tables${ddl.skipped.length ? `, ${ddl.skipped.length} with names too long` : ''})`,
    );

    const rest = incoming.detach();
    const reader = new MessageReader();
    const onData = (chunk: Buffer) => {
      let messages;
      try {
        messages = reader.push(chunk);
      } catch {
        void this.end(entry, '08P01', 'Invalid message.');
        return;
      }
      const terminate = messages.findIndex((m) => m.type === 'X');
      const handled = terminate >= 0 ? messages.slice(0, terminate) : messages;
      void session.receive(handled).catch((error: unknown) => {
        this.logger.warn(`SQL session ${pid}: ${String(error)}`);
        void this.end(entry, 'XX000', 'The SQL gateway lost this session.');
      });
      if (terminate >= 0) void session.receive([]).then(() => this.drop(entry));
    };
    socket.on('data', onData);
    socket.resume();
    socket.on('close', () => void this.drop(entry));
    socket.setTimeout(
      config.idleMs,
      () => void this.end(entry, '57P05', 'Idle for too long.'),
    );
    if (rest.length) onData(rest);
  }

  // ── Running data statements ───────────────────────────────────────────

  private runner(entry: Live): DataRunner {
    let maxRows = 10_000;
    return {
      get maxRows() {
        return maxRows;
      },
      run: (input, signal): Promise<DataResult> =>
        this.runData(entry, input, signal, (rows) => (maxRows = rows)),
    };
  }

  private async runData(
    entry: Live,
    input: { sql: string; tables: string[]; searchPath: string[] },
    signal: AbortSignal,
    setMaxRows: (rows: number) => void,
  ): Promise<DataResult> {
    const row = await this.inWorkspace(entry.ns, () =>
      this.connections.current(entry.connectionId),
    );
    if (!row)
      throw new DataError('28000', 'This SQL connection is no longer active.');
    await this.refreshPrincipal(entry);
    return this.within(
      entry.ns,
      entry.principal,
      entry.connectionId,
      async () => {
        const settings = await this.catalog.settings();
        const maxRows = entry.principal.capabilities.has('data.export')
          ? settings.exportMaxRows
          : settings.maxRows;
        setMaxRows(maxRows);
        let resolve!: (runId: string) => void;
        const done = new Promise<string>((r) => (resolve = r));
        const created = await this.queryRuns.createForConnection({
          sql: input.sql,
          tables: input.tables,
          database: entry.ns.slug,
          searchPath: input.searchPath,
          maxRows,
          onDone: (runId) => resolve(runId),
        });
        if ('refused' in created) {
          throw new DataError(
            created.refused.sqlState,
            created.refused.message,
          );
        }
        // The abort comes from the cancel request's own connection, outside
        // this workspace's context: cancel inside it.
        const onAbort = () =>
          void this.inWorkspace(entry.ns, () =>
            this.queryRuns.cancelConnectionRun(created.runId),
          ).catch(() => undefined);
        signal.addEventListener('abort', onAbort, { once: true });
        // A cancel that came while the run was being created.
        if (signal.aborted) onAbort();
        try {
          await done;
        } finally {
          signal.removeEventListener('abort', onAbort);
        }
        const result = await this.queryRuns.takeConnectionResult(created.runId);
        if (result.status === QueryRunStatus.CANCELLED) {
          throw new DataError(
            '57014',
            'canceling statement due to user request',
          );
        }
        if (result.status !== QueryRunStatus.SUCCESS || !result.arrow) {
          const code = result.error?.code ?? 'execution_error';
          throw new DataError(
            result.status === QueryRunStatus.TIMEOUT
              ? '57014'
              : (SQLSTATE[code] ?? 'XX000'),
            result.error?.message ?? 'The query failed.',
          );
        }
        return {
          rows: decodeArrow(result.arrow),
          truncated: result.truncated,
        };
      },
      DataConnectionService.scopeOf(row),
    );
  }

  private async refreshPrincipal(entry: Live): Promise<void> {
    if (Date.now() - entry.principal.at < PRINCIPAL_TTL_MS) return;
    const row = await this.inWorkspace(entry.ns, () =>
      this.connections.current(entry.connectionId),
    );
    const sub = row?.personRef.replace(/^user:/, '');
    const next = sub
      ? await this.identity.principalFor(sub, entry.ns.namespaceId, {
          kind: 'sql',
          id: entry.connectionId,
        })
      : null;
    if (!next)
      throw new DataError(
        '28000',
        'The person this SQL connection belongs to no longer has access.',
      );
    entry.principal = {
      value: next.principal,
      capabilities: next.capabilities,
      at: Date.now(),
    };
  }

  /** GOV's descriptions, shown by BI tools as comments. */
  private async notes(assetIds: string[]): Promise<CatalogNotes> {
    const [governance, annotations] = await Promise.all([
      this.prisma.assetGovernance.findMany({
        where: { assetId: { in: assetIds }, description: { not: null } },
        select: { assetId: true, description: true },
      }),
      this.prisma.assetColumnAnnotation.findMany({
        where: { assetId: { in: assetIds } },
        select: {
          assetId: true,
          columnName: true,
          businessName: true,
          description: true,
        },
      }),
    ]);
    const columns: CatalogNotes['columns'] = new Map();
    for (const a of annotations) {
      const map = columns.get(a.assetId) ?? new Map();
      map.set(a.columnName, {
        businessName: a.businessName,
        description: a.description,
      });
      columns.set(a.assetId, map);
    }
    return {
      tables: new Map(
        governance.map((g) => [
          g.assetId,
          (g.description ?? '').split(/\n\s*\n/)[0].slice(0, 500),
        ]),
      ),
      columns,
    };
  }

  // ── Contexts ──────────────────────────────────────────────────────────

  /** The workspace's database context, nobody's rights (sign-in lookups). */
  private inWorkspace<T>(
    ns: NamespaceContext,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    return this.cls.run(async () => {
      this.cls.set(CLS_SCHEMA, ns.schemaName);
      this.cls.set(CLS_NAMESPACE_ID, ns.namespaceId);
      this.cls.set(CLS_SLUG, ns.slug);
      this.cls.set(CLS_DATABASE_LANE, 'interactive');
      this.prismaManager.pin(ns.schemaName);
      try {
        return await fn();
      } finally {
        this.prismaManager.unpin(ns.schemaName);
      }
    });
  }

  /** The connection's person, as a signed-in request would have them, narrowed to the connection. */
  private within<T>(
    ns: NamespaceContext,
    principal: Live['principal'],
    _connectionId: string,
    fn: () => Promise<T>,
    scope: ReturnType<typeof DataConnectionService.scopeOf>,
  ): Promise<T> {
    return this.inWorkspace(ns, async () => {
      await applyPrincipalContext(
        this.cls,
        this.identity,
        principal.value,
        principal.capabilities,
        ns.namespaceId,
      );
      this.cls.set(CLS_CONNECTION_SCOPE, scope);
      return fn();
    });
  }

  // ── Cancel, revoke, close ─────────────────────────────────────────────

  private cancel(pid: number, secret: number): void {
    const entry = this.live.get(pid);
    const matches = Boolean(entry && entry.secret === secret);
    if (/^(1|true|yes|on)$/i.test(process.env.SQL_GATEWAY_TRACE ?? '')) {
      this.logger.log(
        `sql ${pid}: cancel request (${matches ? 'cancelling' : 'no such session'})`,
      );
    }
    if (matches) entry!.session.cancel();
  }

  /** Every 30 s: sessions of revoked or expired connections end. */
  private async sweep(): Promise<void> {
    for (const entry of [...this.live.values()]) {
      const row = await this.inWorkspace(entry.ns, () =>
        this.connections.current(entry.connectionId),
      ).catch(() => undefined);
      if (row === null) {
        await this.end(
          entry,
          '57P01',
          'This SQL connection was revoked or has expired.',
        );
      }
    }
  }

  private async end(entry: Live, code: string, message: string): Promise<void> {
    if (!entry.socket.destroyed) {
      entry.socket.end(errorResponse({ severity: 'FATAL', code, message }));
    }
    await this.drop(entry);
  }

  private async drop(entry: Live): Promise<void> {
    if (!this.live.has(entry.pid)) return;
    this.live.delete(entry.pid);
    if (!entry.socket.destroyed) entry.socket.end();
    await entry.session.close().catch(() => undefined);
  }
}

/** The job's Arrow result as plain rows. */
export function decodeArrow(bytes: Buffer): DataResult['rows'] {
  const table = tableFromIPC(bytes);
  const columns = table.schema.fields.map((field, i) => ({
    vector: table.getChildAt(i)!,
    type: field.type,
  }));
  const rows: DataResult['rows'] = [];
  for (let r = 0; r < table.numRows; r++) {
    rows.push(columns.map((c) => plainValue(c.vector.get(r), c.type)));
  }
  return rows;
}
