import {
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Socket } from 'node:net';
import {
  CatalogBackendDisconnectedError,
  type CatalogSession,
} from './catalog-backend';
import {
  type CatalogPgConfig,
  connectCatalogSocket,
} from './catalog-pg-config';
import {
  BodyReader,
  MessageReader,
  frontend,
  parseRowDescription,
  readErrorFields,
  splitMessages,
} from './pg-protocol';

/** PostgreSQL v3 Authentication message subtype codes. */
export const PG_AUTH = {
  OK: 0,
  CLEARTEXT_PASSWORD: 3,
  MD5_PASSWORD: 5,
  SASL: 10,
  SASL_CONTINUE: 11,
  SASL_FINAL: 12,
} as const;

export function hmacSha256(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

export function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

export function xorBuffers(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] ^ b[i];
  return out;
}

export function parseScramAttrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

export function md5Password(
  user: string,
  password: string,
  salt: Buffer,
): string {
  const inner = createHash('md5')
    .update(`${password}${user}`, 'utf8')
    .digest('hex');
  const outer = createHash('md5')
    .update(Buffer.concat([Buffer.from(inner, 'utf8'), salt]))
    .digest('hex');
  return `md5${outer}`;
}

/**
 * Stateful PostgreSQL v3 startup authentication handler supporting trust,
 * cleartext password, MD5, and SCRAM-SHA-256.
 */
export class PgStartupAuth {
  private clientNonce = '';
  private clientFirstBare = '';
  private serverSignature: Buffer | null = null;

  constructor(
    private readonly role: string,
    private readonly password: string,
    private readonly nonceGenerator: () => string = () =>
      randomBytes(18).toString('base64'),
  ) {}

  /** Processes one backend `R` (Authentication) message body and returns any frontend reply. */
  handle(body: Buffer): Buffer | null {
    const authType = body.readInt32BE(0);
    switch (authType) {
      case PG_AUTH.OK:
        return null;
      case PG_AUTH.CLEARTEXT_PASSWORD:
        return frontend.password(this.password);
      case PG_AUTH.MD5_PASSWORD: {
        const salt = body.subarray(4, 8);
        return frontend.password(md5Password(this.role, this.password, salt));
      }
      case PG_AUTH.SASL:
        this.clientNonce = this.nonceGenerator();
        this.clientFirstBare = `n=,r=${this.clientNonce}`;
        return frontend.saslInitial(
          'SCRAM-SHA-256',
          `n,,${this.clientFirstBare}`,
        );
      case PG_AUTH.SASL_CONTINUE:
        return this.handleSaslContinue(body.subarray(4).toString('utf8'));
      case PG_AUTH.SASL_FINAL:
        this.verifySaslFinal(body.subarray(4).toString('utf8'));
        return null;
      default:
        throw new Error(`Unsupported PostgreSQL auth method: ${authType}`);
    }
  }

  private handleSaslContinue(serverFirst: string): Buffer {
    const attrs = parseScramAttrs(serverFirst);
    const serverNonce = attrs.r ?? '';
    if (!this.clientNonce || !serverNonce.startsWith(this.clientNonce)) {
      throw new Error('Invalid SCRAM server nonce.');
    }
    const salt = Buffer.from(attrs.s ?? '', 'base64');
    const iterations = Number(attrs.i ?? 4096);
    const salted = pbkdf2Sync(this.password, salt, iterations, 32, 'sha256');
    const clientKey = hmacSha256(salted, 'Client Key');
    const storedKey = sha256(clientKey);
    const serverKey = hmacSha256(salted, 'Server Key');
    const clientFinalWithoutProof = `c=biws,r=${serverNonce}`;
    const authMessage = `${this.clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
    const clientSignature = hmacSha256(storedKey, authMessage);
    const proof = xorBuffers(clientKey, clientSignature).toString('base64');
    this.serverSignature = hmacSha256(serverKey, authMessage);
    return frontend.password(
      Buffer.from(`${clientFinalWithoutProof},p=${proof}`, 'utf8'),
    );
  }

  private verifySaslFinal(serverFinal: string): void {
    const attrs = parseScramAttrs(serverFinal);
    const received = Buffer.from(attrs.v ?? '', 'base64');
    if (
      !this.serverSignature ||
      received.length !== this.serverSignature.length ||
      !timingSafeEqual(received, this.serverSignature)
    ) {
      throw new Error('SCRAM server signature verification failed.');
    }
  }
}

export type ExpectKind =
  | 'ready'
  | 'parse'
  | 'bind'
  | 'close'
  | 'describeS'
  | 'describeP'
  | 'execute'
  | 'func'
  | 'anyError';

/** Computes expected backend completions and whether a trailing Flush is needed. */
export function planWireExchange(bytes: Buffer): {
  expectations: ExpectKind[];
  needsFlush: boolean;
} {
  const messages = splitMessages(bytes);
  const expectations: ExpectKind[] = [];
  let lastType = '';
  for (const m of messages) {
    lastType = m.type;
    switch (m.type) {
      case 'Q':
      case 'S':
        expectations.push('ready');
        break;
      case 'P':
        expectations.push('parse');
        break;
      case 'B':
        expectations.push('bind');
        break;
      case 'C':
        expectations.push('close');
        break;
      case 'D':
        expectations.push(
          m.body[0] === 'S'.charCodeAt(0) ? 'describeS' : 'describeP',
        );
        break;
      case 'E':
        expectations.push('execute');
        break;
      case 'F':
        expectations.push('func');
        break;
      case 'H':
        break;
      default:
        expectations.push('anyError');
        break;
    }
  }
  const needsFlush =
    expectations.length > 0 &&
    lastType !== 'Q' &&
    lastType !== 'S' &&
    lastType !== 'H';
  return { expectations, needsFlush };
}

export interface ConnectSessionOptions {
  config: CatalogPgConfig;
  database: string;
  role: string;
  password: string;
  onClose: () => void;
  onBackendLost: () => void;
}

interface SessionInit extends Omit<ConnectSessionOptions, 'password'> {
  socket: Socket;
  backendPid: number;
  backendSecret: number;
}

interface PendingExchange {
  expectations: ExpectKind[];
  collected: Buffer[];
  resolve: (bytes: Buffer) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * A 1:1 raw PostgreSQL v3 wire connection to `c_<hash>` as `r_<hash>`.
 *
 * Forwards PG v3 bytes directly over the pod-local Unix domain socket (or TCP
 * in CI) without re-parsing catalog rows in JS. Appends `Flush` (`H`) for
 * extended-protocol frames that do not end with `Sync` (`S`) or `Query` (`Q`),
 * because native PostgreSQL buffers extended responses until `Flush` or `Sync`.
 */
export class PostgresCatalogSession implements CatalogSession {
  readonly database: string;
  readonly role: string;
  private readonly socket: Socket;
  private readonly config: CatalogPgConfig;
  private readonly backendPid: number;
  private readonly backendSecret: number;
  private readonly onCloseCallback: () => void;
  private readonly onBackendLost: () => void;
  private readonly reader = new MessageReader();
  private queue: Promise<void> = Promise.resolve();
  private pending: PendingExchange | null = null;
  private closing = false;
  private closed = false;
  private readonly disconnectListeners: ((error: Error) => void)[] = [];
  private onCloseCalled = false;

  private constructor(init: SessionInit) {
    this.socket = init.socket;
    this.config = init.config;
    this.database = init.database;
    this.role = init.role;
    this.backendPid = init.backendPid;
    this.backendSecret = init.backendSecret;
    this.onCloseCallback = init.onClose;
    this.onBackendLost = init.onBackendLost;

    this.socket.on('data', (chunk: Buffer) => this.onData(chunk));
    this.socket.on('error', (error: Error) => this.handleDrop(error));
    this.socket.on('close', () =>
      this.handleDrop(
        new CatalogBackendDisconnectedError(
          'Catalog backend socket closed unexpectedly.',
        ),
      ),
    );
  }

  static async connect(
    options: ConnectSessionOptions,
  ): Promise<PostgresCatalogSession> {
    const { config, database, role, password } = options;
    const socket = connectCatalogSocket(config);
    if (!config.socketDir) socket.setNoDelay(true);
    const reader = new MessageReader();
    const auth = new PgStartupAuth(role, password);
    let backendPid = 0;
    let backendSecret = 0;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.off('data', onData);
        socket.off('error', onError);
        socket.off('close', onClose);
        if (err) {
          socket.destroy();
          reject(err);
        } else {
          resolve();
        }
      };

      const timer = setTimeout(
        () => done(new Error('Catalog backend startup timed out.')),
        10_000,
      );
      timer.unref();

      const onError = (err: Error) => done(err);
      const onClose = () =>
        done(
          new CatalogBackendDisconnectedError(
            'Catalog backend closed during startup.',
          ),
        );

      const onData = (chunk: Buffer) => {
        let messages;
        try {
          messages = reader.push(chunk);
        } catch (err) {
          done(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        for (const m of messages) {
          if (m.type === 'E') {
            const fields = readErrorFields(m.body);
            done(
              new Error(
                `Catalog backend startup failed (${fields.C ?? 'XX000'}): ${fields.M ?? 'unknown error'}`,
              ),
            );
            return;
          }
          if (m.type === 'K') {
            backendPid = m.body.readInt32BE(0);
            backendSecret = m.body.readInt32BE(4);
            continue;
          }
          if (m.type === 'R') {
            try {
              const reply = auth.handle(m.body);
              if (reply) socket.write(reply);
            } catch (err) {
              done(err instanceof Error ? err : new Error(String(err)));
              return;
            }
            continue;
          }
          if (m.type === 'Z') {
            done();
            return;
          }
        }
      };

      socket.on('data', onData);
      socket.on('error', onError);
      socket.on('close', onClose);
      socket.once('connect', () => {
        socket.write(
          frontend.startup({
            user: role,
            database,
            client_encoding: 'UTF8',
          }),
        );
      });
    });

    return new PostgresCatalogSession({
      socket,
      config,
      database,
      role,
      backendPid,
      backendSecret,
      onClose: options.onClose,
      onBackendLost: options.onBackendLost,
    });
  }

  onDisconnect(listener: (error: Error) => void): void {
    if (this.closed && !this.closing) {
      listener(new CatalogBackendDisconnectedError());
      return;
    }
    this.disconnectListeners.push(listener);
  }

  raw(bytes: Buffer): Promise<Buffer> {
    if (!bytes.length) return Promise.resolve(Buffer.alloc(0));
    const run = this.queue.then(() => this.exchange(bytes));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async exec(sql: string): Promise<void> {
    const reply = await this.raw(frontend.query(sql));
    const err = splitMessages(reply).find((m) => m.type === 'E');
    if (err) {
      const fields = readErrorFields(err.body);
      throw new Error(fields.M ?? 'Catalog exec failed.');
    }
  }

  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const reply = await this.raw(frontend.query(sql));
    const messages = splitMessages(reply);
    const err = messages.find((m) => m.type === 'E');
    if (err) {
      const fields = readErrorFields(err.body);
      throw new Error(fields.M ?? 'Catalog query failed.');
    }
    const desc = messages.find((m) => m.type === 'T');
    if (!desc) return [];
    const fields = parseRowDescription(desc.body);
    const rows: T[] = [];
    for (const m of messages) {
      if (m.type !== 'D') continue;
      const reader = new BodyReader(m.body);
      const count = reader.int16();
      const row: Record<string, unknown> = {};
      for (let i = 0; i < count; i += 1) {
        const len = reader.int32();
        const name = fields[i]?.name ?? `col_${i}`;
        row[name] = len < 0 ? null : reader.bytes(len).toString('utf8');
      }
      rows.push(row as T);
    }
    return rows;
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closing = true;
    this.closed = true;
    this.releaseOnce();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(
        new CatalogBackendDisconnectedError('Session closed.'),
      );
      this.pending = null;
    }
    if (!this.socket.destroyed) {
      try {
        this.socket.end(frontend.terminate());
      } catch {
        this.socket.destroy();
      }
    }
    return Promise.resolve();
  }

  private exchange(bytes: Buffer): Promise<Buffer> {
    if (this.closed || this.socket.destroyed) {
      return Promise.reject(new CatalogBackendDisconnectedError());
    }
    const { expectations, needsFlush } = planWireExchange(bytes);
    if (!expectations.length) {
      this.socket.write(bytes);
      return Promise.resolve(Buffer.alloc(0));
    }
    const wire = needsFlush ? Buffer.concat([bytes, frontend.flush()]) : bytes;

    return new Promise<Buffer>((resolve, reject) => {
      const backstopMs = this.config.statementTimeoutMs + 5_000;
      const timer = setTimeout(() => {
        if (this.pending) this.pending = null;
        this.sendCancel();
        this.closing = true;
        this.closed = true;
        this.releaseOnce();
        this.socket.destroy();
        reject(new Error('A catalog statement ran too long.'));
      }, backstopMs);
      timer.unref();

      this.pending = {
        expectations,
        collected: [],
        resolve,
        reject,
        timer,
      };
      this.socket.write(wire);
    });
  }

  private onData(chunk: Buffer): void {
    let messages;
    try {
      messages = this.reader.push(chunk);
    } catch (error) {
      this.handleDrop(
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }
    for (const m of messages) {
      const p = this.pending;
      if (!p) continue;
      p.collected.push(Buffer.from(m.raw));
      if (m.type === 'N' || m.type === 'S' || m.type === 'A') continue;

      if (m.type === 'E') {
        const fields = readErrorFields(m.body);
        if (fields.S === 'FATAL' || fields.S === 'PANIC') {
          this.finishPending(p);
          continue;
        }
        const readyIdx = p.expectations.indexOf('ready');
        if (readyIdx >= 0) {
          p.expectations = p.expectations.slice(readyIdx);
        } else {
          p.expectations.length = 0;
          this.finishPending(p);
        }
        continue;
      }

      const head = p.expectations[0];
      if (!head) {
        this.finishPending(p);
        continue;
      }

      switch (head) {
        case 'ready':
          if (m.type === 'Z') p.expectations.shift();
          break;
        case 'parse':
          if (m.type === '1') p.expectations.shift();
          break;
        case 'bind':
          if (m.type === '2') p.expectations.shift();
          break;
        case 'close':
          if (m.type === '3') p.expectations.shift();
          break;
        case 'describeS':
          if (m.type === 't') p.expectations[0] = 'describeP';
          break;
        case 'describeP':
          if (m.type === 'T' || m.type === 'n') p.expectations.shift();
          break;
        case 'execute':
          if (m.type === 'C' || m.type === 's' || m.type === 'I') {
            p.expectations.shift();
          }
          break;
        case 'func':
          if (m.type === 'V') p.expectations.shift();
          break;
        case 'anyError':
          if (m.type === 'Z') p.expectations.shift();
          break;
      }

      if (p.expectations.length === 0) {
        this.finishPending(p);
      }
    }
  }

  private finishPending(p: PendingExchange): void {
    if (this.pending === p) this.pending = null;
    clearTimeout(p.timer);
    p.resolve(Buffer.concat(p.collected));
  }

  private handleDrop(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.releaseOnce();
    const disconnectError =
      error instanceof CatalogBackendDisconnectedError
        ? error
        : new CatalogBackendDisconnectedError(error.message);
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.reject(disconnectError);
    }
    if (!this.closing) {
      this.onBackendLost();
      for (const listener of this.disconnectListeners) {
        try {
          listener(disconnectError);
        } catch {
          // ignore listener errors during teardown
        }
      }
    }
    this.disconnectListeners.length = 0;
  }

  private sendCancel(): void {
    if (!this.backendPid || !this.backendSecret) return;
    try {
      const cancelSock = connectCatalogSocket(this.config);
      cancelSock.on('error', () => undefined);
      cancelSock.once('connect', () => {
        cancelSock.end(frontend.cancel(this.backendPid, this.backendSecret));
      });
    } catch {
      // best effort
    }
  }

  private releaseOnce(): void {
    if (this.onCloseCalled) return;
    this.onCloseCalled = true;
    this.onCloseCallback();
  }
}
