import {
  type BindMessage,
  type FieldDescription,
  type Message,
  commandComplete,
  dataRow,
  frontend,
  parseBind,
  parseClose,
  parseDescribe,
  parseExecute,
  parseParse,
  parseQuery,
  parseRowDescription,
  portalSuspended,
  readErrorFields,
  readyForQuery,
  splitMessages,
  BodyReader,
} from './pg-protocol';
import type { PgliteSession } from './pglite-host';
import { EncodeError, OID, type PlainValue, encodeValue } from './pg-types';
import {
  READING_KEYWORDS,
  firstKeyword,
  quoteLiteral,
  splitStatements,
  substituteParams,
  parseCursorStatement,
  type CursorStatement,
} from './sql-text';

/** A data statement failed: what the client is told, as PostgreSQL would. */
export class DataError extends Error {
  constructor(
    readonly sqlState: string,
    message: string,
  ) {
    super(message);
  }
}

export interface DataResult {
  rows: PlainValue[][];
  /** The job stopped at the row cap: there were more. */
  truncated: boolean;
}

/**
 * The session left the connection's role inside its PGlite (`RESET SESSION
 * AUTHORIZATION`, `set_config('session_authorization', …)`): the catalog
 * runs as the connection, read-only (§5.7), and the bootstrap superuser it
 * was set up as must stay out of reach. The gateway ends the session.
 */
export class SessionEscape extends Error {}

/** What a session needs from outside: running a data statement as a query job. */
export interface DataRunner {
  run(
    input: { sql: string; tables: string[]; searchPath: string[] },
    signal: AbortSignal,
  ): Promise<DataResult>;
  /** Rows a result may have; more is refused, never cut silently. */
  readonly maxRows: number;
}

interface Statement {
  sql: string;
  paramTypes: number[];
  /** `source.schema.table` names it reads; empty for a catalog statement. */
  tables: string[];
}

interface Portal {
  statement: string;
  /**
   * The statement as it was when bound. A portal keeps it, as in
   * PostgreSQL: pgJDBC pages through a portal of the unnamed statement and
   * re-parses that statement between pages (BIC J3, Metabase downloads M13).
   */
  parsed?: Statement;
  /** Its parameter types, read when bound (for the same reason). */
  paramTypes?: number[];
  bind: BindMessage;
  fields?: FieldDescription[];
  rows?: PlainValue[][];
  truncated?: boolean;
  offset: number;
}

/** A data cursor: its query ran once, as a job; FETCH reads it forward. */
interface DataCursor {
  description: Buffer | null;
  fields: FieldDescription[];
  rows: PlainValue[][];
  truncated: boolean;
  offset: number;
  /** WITH HOLD: kept past its transaction, until CLOSE. */
  hold: boolean;
}

/** Internal statement and portal names; clients never see them. */
const READS = '__classifyre_reads';
const FAIL = '__classifyre_fail';
const PATH = '__classifyre_path';
const PROBE = '__classifyre_probe';
const WHO = '__classifyre_who';
const WHO_PORTAL = '__classifyre_who_p';
const DECODE = '__classifyre_decode';

const NUMERIC_OIDS = new Set<number>([
  OID.int2,
  OID.int4,
  OID.int8,
  OID.float4,
  OID.float8,
  OID.numeric,
  OID.oid,
]);
const CAST: Record<number, string> = {
  [OID.date]: 'date',
  [OID.timestamp]: 'timestamp',
  [OID.timestamptz]: 'timestamptz',
  [OID.time]: 'time',
  [OID.interval]: 'interval',
  [OID.uuid]: 'uuid',
};

/** A bound parameter's text as a literal the query job's SQL can hold. */
export function paramLiteral(text: string | null, oid: number): string {
  if (text === null) return 'NULL';
  if (
    NUMERIC_OIDS.has(oid) &&
    /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)
  ) {
    return text;
  }
  if (oid === OID.bool) return /^t/i.test(text) ? 'TRUE' : 'FALSE';
  const cast = CAST[oid];
  return cast ? `CAST(${quoteLiteral(text)} AS ${cast})` : quoteLiteral(text);
}

/** `"src.sch"|tbl` pairs from `classifyre.reads`, split by kind. */
export function readTables(
  reads: string[],
  dataSchemas: ReadonlySet<string>,
): { data: string[]; other: string[] } {
  const data: string[] = [];
  const other: string[] = [];
  for (const entry of reads) {
    const bar = entry.lastIndexOf('|');
    const schema = entry.slice(0, bar);
    const relation = entry.slice(bar + 1);
    if (dataSchemas.has(schema))
      data.push(`${schema}.${relation}`.toLowerCase());
    else other.push(`${schema}.${relation}`);
  }
  return { data: [...new Set(data)], other };
}

/**
 * One client connection after sign-in (docs/prd/DQ-data-query.md §5.7).
 *
 * Every message goes to the session's PGlite, which owns the catalog, the
 * prepared statements, portals, transactions and errors, so clients see a
 * real PostgreSQL. The one exception is a statement whose plan reads the
 * person's tables: its Execute (or simple Query) runs as a query job instead,
 * and the gateway sends the rows in the formats PGlite described. A data
 * statement that fails fails through PGlite (`classifyre.fail`), so its error
 * aborts the transaction and skips to Sync exactly as PostgreSQL does.
 */
export class PgSession {
  private readonly statements = new Map<string, Statement>();
  private readonly portals = new Map<string, Portal>();
  /** Cursors over data (`DECLARE … FOR` a statement that reads tables), by name. */
  private readonly cursors = new Map<string, DataCursor>();
  /** After an error in the extended protocol: ignore everything until Sync. */
  private skipping = false;
  private status = 'I';
  private queue: Promise<void> = Promise.resolve();
  private running: AbortController | null = null;
  private decoders = new Map<string, string>();
  private inSimpleQuery = false;

  constructor(
    private readonly pg: PgliteSession,
    private readonly dataSchemas: ReadonlySet<string>,
    private readonly data: DataRunner,
    private readonly sendRaw: (bytes: Buffer) => void,
    /** Debugging only (`SQL_GATEWAY_TRACE`): message types, statements, errors — never values. */
    private readonly trace?: (line: string) => void,
    /** The role the catalog runs as; any report of another ends the session. */
    private readonly role?: string,
  ) {}

  /**
   * PGlite's reply to protocol messages. Whenever one finishes a request
   * (ReadyForQuery), the session is asked who it runs as: PGlite signs in as
   * its bootstrap superuser, so `SET SESSION AUTHORIZATION postgres` or
   * `set_config('session_authorization', …)` would leave the connection's
   * read-only role, and PGlite reports no ParameterStatus to notice it by.
   * The client never sees that reply; the session ends.
   */
  private async raw(bytes: Buffer): Promise<Uint8Array> {
    const reply = await this.pg.raw(bytes);
    if (!this.role) return reply;
    const ready = splitMessages(reply).find((m) => m.type === 'Z');
    if (ready && ready.body[0] !== 'E'.charCodeAt(0)) await this.assertRole();
    return reply;
  }

  private async assertRole(): Promise<void> {
    const reply = splitMessages(
      await this.pg.raw(
        Buffer.concat([
          frontend.bind(WHO_PORTAL, WHO, []),
          frontend.execute(WHO_PORTAL),
          frontend.close('P', WHO_PORTAL),
          frontend.sync(),
        ]),
      ),
    );
    const row = reply.find((m) => m.type === 'D');
    const values: string[] = [];
    if (row) {
      const reader = new BodyReader(row.body);
      const count = reader.int16();
      for (let i = 0; i < count; i += 1) {
        const length = reader.int32();
        values.push(length < 0 ? '' : reader.bytes(length).toString('utf8'));
      }
    }
    const [user, superuser] = values;
    if (user !== this.role || superuser !== 'off') {
      throw new SessionEscape(
        `session runs as ${user ?? '?'} (superuser ${superuser ?? '?'})`,
      );
    }
  }

  private send(bytes: Buffer): void {
    if (this.trace) {
      const out: string[] = [];
      for (const m of splitMessages(bytes)) {
        out.push(
          m.type === 'E' || m.type === 'N'
            ? `${m.type}(${Object.entries(readErrorFields(m.body))
                .filter(([k]) => k === 'C' || k === 'M')
                .map(([, v]) => v)
                .join(' ')})`
            : m.type,
        );
      }
      this.trace(`<- ${out.join(' ')}`);
    }
    this.sendRaw(bytes);
  }

  /** Internal statements, prepared once; their results never reach the client. */
  async start(settings: Record<string, string>): Promise<void> {
    const sets = Object.entries(settings)
      .map(([key, value]) => `SET ${key} = ${quoteLiteral(value)};`)
      .join(' ');
    if (sets) await this.pg.exec(sets).catch(() => undefined);
    await this.raw(
      Buffer.concat([
        frontend.parse(READS, 'SELECT classifyre.reads($1, $2)', [
          OID.text,
          OID.text,
        ]),
        frontend.parse(FAIL, 'SELECT classifyre.fail($1, $2)', [
          OID.text,
          OID.text,
        ]),
        frontend.parse(
          PATH,
          'SELECT array_to_json(current_schemas(false))::text',
        ),
        frontend.parse(
          WHO,
          "SELECT current_user::text, current_setting('is_superuser')",
        ),
        frontend.sync(),
      ]),
    );
  }

  /** Messages from the client, handled one after another. */
  receive(messages: Message[]): Promise<void> {
    this.queue = this.queue.then(async () => {
      for (const message of messages) await this.handle(message);
    });
    return this.queue;
  }

  /** A CancelRequest for this session: stops the query job it is waiting on. */
  cancel(): void {
    this.running?.abort();
  }

  async close(): Promise<void> {
    this.cancel();
    await this.pg.close();
  }

  // ── Dispatch ──────────────────────────────────────────────────────────

  private async handle(message: Message): Promise<void> {
    if (this.trace) {
      const sql =
        message.type === 'Q'
          ? parseQuery(message.body)
          : message.type === 'P'
            ? parseParse(message.body).sql
            : '';
      this.trace(
        `-> ${message.type}${sql ? ` ${sql.slice(0, 300)}` : ''}${this.skipping ? ' (skipping)' : ''}`,
      );
    }
    switch (message.type) {
      case 'Q':
        return this.simpleQuery(parseQuery(message.body));
      case 'P':
        return this.parse(message);
      case 'B':
        return this.bind(message);
      case 'D':
        return this.describe(message);
      case 'E':
        return this.execute(message);
      case 'C':
        return this.close_(message);
      case 'S':
        return this.sync(message);
      case 'H':
        return;
      default:
        // COPY data, function calls: not on offer; let PGlite refuse them.
        await this.forward(message.raw);
        return;
    }
  }

  /** To PGlite and back to the client; true when PGlite answered an error. */
  private async forward(bytes: Buffer, keepReady = true): Promise<boolean> {
    if (this.skipping && bytes[0] !== 'S'.charCodeAt(0)) return true;
    const reply = await this.raw(bytes);
    let failed = false;
    const out: Buffer[] = [];
    for (const m of splitMessages(reply)) {
      if (m.type === 'E') failed = true;
      if (m.type === 'Z') {
        this.status = String.fromCharCode(m.body[0]);
        if (!keepReady) continue;
      }
      out.push(Buffer.from(m.raw));
    }
    if (out.length) this.send(Buffer.concat(out));
    if (failed) this.skipping = true;
    return failed;
  }

  /**
   * PGlite's reply to internal messages, never shown to the client. Inside a
   * simple query they end with their own Sync: unsynced extended messages
   * before a Query would leave a transaction open (status T) that clients
   * act on — psqlODBC then wraps every statement in a SAVEPOINT. In the
   * extended protocol the client's own Sync closes them.
   */
  private async internal(...messages: Buffer[]): Promise<Message[]> {
    const reply = splitMessages(
      await this.raw(
        Buffer.concat(
          this.inSimpleQuery ? [...messages, frontend.sync()] : messages,
        ),
      ),
    );
    return this.inSimpleQuery ? reply.filter((m) => m.type !== 'Z') : reply;
  }

  // ── Classification ────────────────────────────────────────────────────

  /** The tables of ours a statement reads; throws when it mixes them with others. */
  private async classify(sql: string): Promise<string[]> {
    if (!READING_KEYWORDS.has(firstKeyword(sql)) || this.status === 'E') {
      return [];
    }
    const nulls = substituteParams(
      sql,
      Array.from({ length: 100 }, () => 'NULL'),
    );
    const reply = await this.internal(
      frontend.bind(PROBE, READS, [Buffer.from(sql), Buffer.from(nulls)]),
      frontend.execute(PROBE),
      frontend.close('P', PROBE),
    );
    const row = reply.find((m) => m.type === 'D');
    if (!row) return [];
    const reader = new BodyReader(row.body);
    reader.int16();
    const length = reader.int32();
    if (length < 0) return [];
    const reads = JSON.parse(reader.bytes(length).toString('utf8')) as string[];
    const { data, other } = readTables(reads, this.dataSchemas);
    if (data.length && other.length) {
      throw new DataError(
        '0A000',
        `A statement reads either your tables or the catalog, not both (it reads ${other.join(', ')}).`,
      );
    }
    return data;
  }

  private async searchPath(): Promise<string[]> {
    const reply = await this.internal(
      frontend.bind(PROBE, PATH, []),
      frontend.execute(PROBE),
      frontend.close('P', PROBE),
    );
    const row = reply.find((m) => m.type === 'D');
    if (!row) return [];
    const reader = new BodyReader(row.body);
    reader.int16();
    const length = reader.int32();
    return length < 0
      ? []
      : (JSON.parse(reader.bytes(length).toString('utf8')) as string[]);
  }

  // ── Simple query ──────────────────────────────────────────────────────

  private async simpleQuery(sql: string): Promise<void> {
    this.inSimpleQuery = true;
    try {
      await this.simpleStatements(sql);
    } finally {
      this.inSimpleQuery = false;
    }
  }

  private async simpleStatements(sql: string): Promise<void> {
    this.skipping = false;
    const statements = splitStatements(sql);
    if (!statements.length) {
      await this.forward(frontend.query(sql));
      return;
    }
    for (const statement of statements) {
      const cursor = parseCursorStatement(statement);
      if (cursor) {
        const handled = await this.cursorStatement(cursor);
        if (handled === 'failed') return;
        if (handled === 'served') continue;
      }
      let tables: string[] = [];
      try {
        tables = await this.classify(statement);
      } catch (error) {
        await this.failSimple(error);
        return;
      }
      if (!tables.length) {
        if (await this.forward(frontend.query(statement), false)) break;
        continue;
      }
      // Its columns, as PGlite plans them over the empty tables.
      const described = await this.internal(
        frontend.parse(PROBE, statement),
        frontend.describe('S', PROBE),
        frontend.close('S', PROBE),
      );
      const error = described.find((m) => m.type === 'E');
      if (error) {
        this.send(Buffer.from(error.raw));
        await this.forward(frontend.sync(), false);
        break;
      }
      const description = described.find((m) => m.type === 'T');
      const fields = description ? parseRowDescription(description.body) : [];
      try {
        const result = await this.run(statement, tables);
        if (description) this.send(Buffer.from(description.raw));
        this.sendRows(fields, result.rows, 0, result.rows.length);
        if (result.truncated) throw this.tooMany();
        this.send(commandComplete(`SELECT ${result.rows.length}`));
      } catch (failure) {
        await this.failSimple(failure);
        return;
      }
    }
    this.skipping = false;
    if (this.status === 'I') {
      for (const [name, cursor] of this.cursors) {
        if (!cursor.hold) this.cursors.delete(name);
      }
    }
    this.send(readyForQuery(this.status));
  }

  /**
   * DECLARE, FETCH and CLOSE of a cursor over data (BIC D5): the query runs
   * once as a job when declared, and FETCH reads its rows forward. A cursor
   * over the catalog is PGlite's (`'pglite'`). A result over the row cap is
   * refused when a FETCH reaches the cap, never cut short.
   */
  private async cursorStatement(
    cursor: CursorStatement,
  ): Promise<'served' | 'pglite' | 'failed'> {
    if (cursor.kind === 'declare') {
      let tables: string[];
      try {
        tables = await this.classify(cursor.query);
      } catch (error) {
        await this.failSimple(error);
        return 'failed';
      }
      if (!tables.length) return 'pglite';
      const described = await this.internal(
        frontend.parse(PROBE, cursor.query),
        frontend.describe('S', PROBE),
        frontend.close('S', PROBE),
      );
      const error = described.find((m) => m.type === 'E');
      if (error) {
        this.send(Buffer.from(error.raw));
        await this.forward(frontend.sync(), false);
        return 'failed';
      }
      const description = described.find((m) => m.type === 'T');
      try {
        const result = await this.run(cursor.query, tables);
        this.cursors.set(cursor.name, {
          description: description ? Buffer.from(description.raw) : null,
          fields: description ? parseRowDescription(description.body) : [],
          rows: result.rows,
          truncated: result.truncated,
          offset: 0,
          hold: cursor.hold,
        });
      } catch (failure) {
        await this.failSimple(failure);
        return 'failed';
      }
      this.send(commandComplete('DECLARE CURSOR'));
      return 'served';
    }
    if (cursor.kind === 'close') {
      if (cursor.name === null) {
        this.cursors.clear();
        return 'pglite';
      }
      if (!this.cursors.delete(cursor.name)) return 'pglite';
      this.send(commandComplete('CLOSE CURSOR'));
      return 'served';
    }
    const open = this.cursors.get(cursor.name);
    if (!open) return 'pglite';
    const start = open.offset;
    const wanted =
      cursor.count === 'all' ? Number.POSITIVE_INFINITY : cursor.count;
    const end = Math.min(start + wanted, open.rows.length);
    if (open.description) this.send(open.description);
    this.sendRows(open.fields, open.rows, start, end);
    open.offset = end;
    if (open.truncated && start + wanted > open.rows.length) {
      await this.failSimple(this.tooMany());
      return 'failed';
    }
    this.send(commandComplete(`FETCH ${end - start}`));
    return 'served';
  }

  /** An error in a simple query, through PGlite so the transaction knows. */
  private async failSimple(error: unknown): Promise<void> {
    const { sqlState, message } = this.errorOf(error);
    await this.forward(
      frontend.query(
        `SELECT classifyre.fail(${quoteLiteral(sqlState)}, ${quoteLiteral(message)})`,
      ),
    );
    this.skipping = false;
  }

  // ── Extended query ────────────────────────────────────────────────────

  private async parse(message: Message): Promise<void> {
    if (this.skipping) return;
    const parsed = parseParse(message.body);
    if (await this.forward(message.raw)) return;
    let tables: string[] = [];
    try {
      tables = await this.classify(parsed.sql);
    } catch (error) {
      await this.failExtended(error);
      return;
    }
    this.statements.set(parsed.name, {
      sql: parsed.sql,
      paramTypes: parsed.paramTypes,
      tables,
    });
  }

  private async bind(message: Message): Promise<void> {
    if (this.skipping) return;
    const bind = parseBind(message.body);
    if (await this.forward(message.raw)) return;
    const parsed = this.statements.get(bind.statement);
    this.portals.set(bind.portal, {
      statement: bind.statement,
      parsed,
      paramTypes:
        parsed?.tables.length && bind.params.length
          ? await this.paramTypes(parsed, bind)
          : undefined,
      bind,
      offset: 0,
    });
  }

  private async describe(message: Message): Promise<void> {
    if (this.skipping) return;
    const target = parseDescribe(message.body);
    const reply = await this.raw(message.raw);
    const messages = splitMessages(reply);
    if (target.kind === 'P') {
      const description = messages.find((m) => m.type === 'T');
      const portal = this.portals.get(target.name);
      if (portal && description) {
        portal.fields = parseRowDescription(description.body);
      }
    }
    if (messages.some((m) => m.type === 'E')) this.skipping = true;
    this.send(Buffer.concat(messages.map((m) => Buffer.from(m.raw))));
  }

  private async execute(message: Message): Promise<void> {
    if (this.skipping) return;
    const { portal: name, maxRows } = parseExecute(message.body);
    const portal = this.portals.get(name);
    const statement = portal?.parsed;
    if (!portal || !statement?.tables.length) {
      await this.forward(message.raw);
      return;
    }
    try {
      if (!portal.fields) {
        const described = await this.internal(frontend.describe('P', name));
        const description = described.find((m) => m.type === 'T');
        portal.fields = description
          ? parseRowDescription(description.body)
          : [];
      }
      if (!portal.rows) {
        const literals = await this.paramLiterals(portal);
        const result = await this.run(
          substituteParams(statement.sql, literals),
          statement.tables,
        );
        portal.rows = result.rows;
        portal.truncated = result.truncated;
      }
      const end =
        maxRows > 0
          ? Math.min(portal.offset + maxRows, portal.rows.length)
          : portal.rows.length;
      this.sendRows(portal.fields, portal.rows, portal.offset, end);
      portal.offset = end;
      if (end < portal.rows.length) {
        this.send(portalSuspended());
        return;
      }
      if (portal.truncated) throw this.tooMany();
      this.send(commandComplete(`SELECT ${portal.rows.length}`));
    } catch (error) {
      await this.failExtended(error);
    }
  }

  private async close_(message: Message): Promise<void> {
    if (this.skipping) return;
    const target = parseClose(message.body);
    if (target.kind === 'S') this.statements.delete(target.name);
    else this.portals.delete(target.name);
    await this.forward(message.raw);
  }

  private async sync(message: Message): Promise<void> {
    this.skipping = false;
    await this.forward(message.raw);
    // Portals end with their transaction; the unnamed one with every Sync.
    this.portals.delete('');
    if (this.status === 'I') this.portals.clear();
  }

  /** An error in the extended protocol: raised in PGlite, which then skips to Sync. */
  private async failExtended(error: unknown): Promise<void> {
    const { sqlState, message } = this.errorOf(error);
    const reply = await this.internal(
      frontend.bind(FAIL, FAIL, [Buffer.from(sqlState), Buffer.from(message)]),
      frontend.execute(FAIL),
    );
    const failure = reply.find((m) => m.type === 'E');
    if (failure) this.send(Buffer.from(failure.raw));
    this.skipping = true;
  }

  // ── Data ──────────────────────────────────────────────────────────────

  /** The parameter types of a statement as PGlite inferred them, for its bound values. */
  private async paramTypes(
    statement: Statement,
    bind: BindMessage,
  ): Promise<number[]> {
    const described = await this.internal(
      frontend.describe('S', bind.statement),
    );
    const parameters = described.find((m) => m.type === 't');
    const types: number[] = [];
    if (parameters) {
      const reader = new BodyReader(parameters.body);
      const count = reader.int16();
      for (let i = 0; i < count; i++) types.push(reader.int32());
    }
    while (types.length < bind.params.length) {
      types.push(statement.paramTypes[types.length] ?? OID.unknown);
    }
    return types;
  }

  /** The bound values as text, decoded by PGlite from whatever format the client used. */
  private async paramLiterals(portal: Portal): Promise<string[]> {
    const { bind } = portal;
    if (!bind.params.length) return [];
    const types =
      portal.paramTypes ?? (await this.paramTypes(portal.parsed!, bind));
    const key = types.join(',');
    let decoder = this.decoders.get(key);
    if (!decoder) {
      decoder = `${DECODE}_${this.decoders.size}`;
      const columns = types.map((_, i) => `$${i + 1}::text`).join(', ');
      await this.internal(frontend.parse(decoder, `SELECT ${columns}`, types));
      this.decoders.set(key, decoder);
    }
    const reply = await this.internal(
      frontend.bind(PROBE, decoder, bind.params, bind.paramFormats),
      frontend.execute(PROBE),
      frontend.close('P', PROBE),
    );
    const failure = reply.find((m) => m.type === 'E');
    if (failure) throw new DataError('22P02', 'A parameter could not be read.');
    const row = reply.find((m) => m.type === 'D');
    const texts: (string | null)[] = [];
    if (row) {
      const reader = new BodyReader(row.body);
      const count = reader.int16();
      for (let i = 0; i < count; i++) {
        const length = reader.int32();
        texts.push(length < 0 ? null : reader.bytes(length).toString('utf8'));
      }
    }
    return texts.map((text, i) => paramLiteral(text, types[i]));
  }

  private async run(sql: string, tables: string[]): Promise<DataResult> {
    const controller = new AbortController();
    this.running = controller;
    try {
      return await this.data.run(
        { sql, tables, searchPath: await this.searchPath() },
        controller.signal,
      );
    } finally {
      if (this.running === controller) this.running = null;
    }
  }

  private sendRows(
    fields: FieldDescription[],
    rows: PlainValue[][],
    from: number,
    to: number,
  ): void {
    const chunk: Buffer[] = [];
    let size = 0;
    for (let r = from; r < to; r++) {
      const row = rows[r];
      if (row.length !== fields.length) {
        throw new DataError(
          'XX000',
          `The result has ${row.length} columns, the catalog says ${fields.length}: rescan the source.`,
        );
      }
      const values = row.map((value, c) => {
        try {
          return encodeValue(value, fields[c].typeOid, fields[c].format);
        } catch (error) {
          if (error instanceof EncodeError) {
            throw new DataError(
              '22P03',
              `Column ${fields[c].name}: ${error.message}`,
            );
          }
          throw new DataError(
            '22P03',
            `Column ${fields[c].name}: the value does not fit its type.`,
          );
        }
      });
      const encoded = dataRow(values);
      chunk.push(encoded);
      size += encoded.length;
      if (size > 256 * 1024) {
        this.send(Buffer.concat(chunk));
        chunk.length = 0;
        size = 0;
      }
    }
    if (chunk.length) this.send(Buffer.concat(chunk));
  }

  private tooMany(): DataError {
    return new DataError(
      '54000',
      `The result has more than ${this.data.maxRows} rows, the most a SQL connection returns: add a filter or a LIMIT.`,
    );
  }

  private errorOf(error: unknown): { sqlState: string; message: string } {
    if (error instanceof DataError) {
      return { sqlState: error.sqlState, message: error.message };
    }
    return {
      sqlState: 'XX000',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
