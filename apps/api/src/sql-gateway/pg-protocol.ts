/**
 * The PostgreSQL frontend/backend protocol v3, as much as the SQL gateway
 * needs (https://www.postgresql.org/docs/current/protocol-message-formats.html):
 * framing, the frontend messages it reads, the backend messages it writes.
 */

export const PROTOCOL_V3 = 196608;
export const SSL_REQUEST = 80877103;
export const GSSENC_REQUEST = 80877104;
export const CANCEL_REQUEST = 80877102;

export interface Message {
  type: string;
  body: Buffer;
  /** The whole message, type byte and length included. */
  raw: Buffer;
}

/** Splits a byte stream into typed messages; keeps partial ones for later. */
export class MessageReader {
  private pending: Buffer = Buffer.alloc(0);

  constructor(private readonly maxMessage = 64 * 1024 * 1024) {}

  push(chunk: Buffer): Message[] {
    this.pending = this.pending.length
      ? Buffer.concat([this.pending, chunk])
      : chunk;
    const out: Message[] = [];
    let at = 0;
    while (this.pending.length - at >= 5) {
      const length = this.pending.readInt32BE(at + 1);
      if (length < 4 || length > this.maxMessage) {
        throw new ProtocolError(`Invalid message length ${length}.`);
      }
      if (this.pending.length - at < 1 + length) break;
      const raw = this.pending.subarray(at, at + 1 + length);
      out.push({
        type: String.fromCharCode(raw[0]),
        body: raw.subarray(5),
        raw: Buffer.from(raw),
      });
      at += 1 + length;
    }
    this.pending = Buffer.from(this.pending.subarray(at));
    return out;
  }
}

/** Splits a backend reply (from PGlite) into its messages. */
export function splitMessages(bytes: Uint8Array): Message[] {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Message[] = [];
  let at = 0;
  while (at + 5 <= buffer.length) {
    const length = buffer.readInt32BE(at + 1);
    const raw = buffer.subarray(at, at + 1 + length);
    out.push({
      type: String.fromCharCode(raw[0]),
      body: raw.subarray(5),
      raw,
    });
    at += 1 + length;
  }
  return out;
}

export class ProtocolError extends Error {}

/** Reads fields of a message body in order. */
export class BodyReader {
  private at = 0;
  constructor(private readonly body: Buffer) {}

  int16(): number {
    const value = this.body.readInt16BE(this.at);
    this.at += 2;
    return value;
  }

  int32(): number {
    const value = this.body.readInt32BE(this.at);
    this.at += 4;
    return value;
  }

  cstring(): string {
    const end = this.body.indexOf(0, this.at);
    if (end < 0) throw new ProtocolError('Unterminated string.');
    const value = this.body.toString('utf8', this.at, end);
    this.at = end + 1;
    return value;
  }

  bytes(length: number): Buffer {
    const value = this.body.subarray(this.at, this.at + length);
    this.at += length;
    return value;
  }

  byte(): string {
    return String.fromCharCode(this.body[this.at++]);
  }

  rest(): Buffer {
    return this.body.subarray(this.at);
  }
}

// ── Startup ─────────────────────────────────────────────────────────────

/** The untyped first packet: length, then a code (or protocol version). */
export function readStartupPacket(buffer: Buffer): {
  length: number;
  code: number;
} | null {
  if (buffer.length < 8) return null;
  return { length: buffer.readInt32BE(0), code: buffer.readInt32BE(4) };
}

export function parseStartupParameters(body: Buffer): Record<string, string> {
  const params: Record<string, string> = {};
  const reader = new BodyReader(body);
  for (;;) {
    const key = reader.cstring();
    if (!key) break;
    params[key] = reader.cstring();
  }
  return params;
}

// ── Frontend messages ───────────────────────────────────────────────────

export interface ParseMessage {
  name: string;
  sql: string;
  paramTypes: number[];
}

export function parseParse(body: Buffer): ParseMessage {
  const reader = new BodyReader(body);
  const name = reader.cstring();
  const sql = reader.cstring();
  const count = reader.int16();
  const paramTypes: number[] = [];
  for (let i = 0; i < count; i++) paramTypes.push(reader.int32());
  return { name, sql, paramTypes };
}

export interface BindMessage {
  portal: string;
  statement: string;
  paramFormats: number[];
  params: (Buffer | null)[];
  resultFormats: number[];
}

export function parseBind(body: Buffer): BindMessage {
  const reader = new BodyReader(body);
  const portal = reader.cstring();
  const statement = reader.cstring();
  const formatCount = reader.int16();
  const paramFormats: number[] = [];
  for (let i = 0; i < formatCount; i++) paramFormats.push(reader.int16());
  const paramCount = reader.int16();
  const params: (Buffer | null)[] = [];
  for (let i = 0; i < paramCount; i++) {
    const length = reader.int32();
    params.push(length < 0 ? null : Buffer.from(reader.bytes(length)));
  }
  const resultCount = reader.int16();
  const resultFormats: number[] = [];
  for (let i = 0; i < resultCount; i++) resultFormats.push(reader.int16());
  return { portal, statement, paramFormats, params, resultFormats };
}

export function parseDescribe(body: Buffer): { kind: 'S' | 'P'; name: string } {
  const reader = new BodyReader(body);
  const kind = reader.byte() === 'S' ? 'S' : 'P';
  return { kind, name: reader.cstring() };
}

export function parseExecute(body: Buffer): {
  portal: string;
  maxRows: number;
} {
  const reader = new BodyReader(body);
  return { portal: reader.cstring(), maxRows: reader.int32() };
}

export function parseClose(body: Buffer): { kind: 'S' | 'P'; name: string } {
  return parseDescribe(body);
}

export function parseQuery(body: Buffer): string {
  return new BodyReader(body).cstring();
}

/** SASLInitialResponse: mechanism, then the client-first message. */
export function parseSaslInitial(body: Buffer): {
  mechanism: string;
  data: string;
} {
  const reader = new BodyReader(body);
  const mechanism = reader.cstring();
  const length = reader.int32();
  return {
    mechanism,
    data: length < 0 ? '' : reader.bytes(length).toString('utf8'),
  };
}

// ── Building messages ───────────────────────────────────────────────────

/** Writes one message: type byte, then length, then the fields. */
export class MessageWriter {
  private parts: Buffer[] = [];
  private size = 0;

  int16(value: number): this {
    const b = Buffer.alloc(2);
    b.writeInt16BE(value);
    return this.push(b);
  }

  int32(value: number): this {
    const b = Buffer.alloc(4);
    b.writeInt32BE(value);
    return this.push(b);
  }

  cstring(value: string): this {
    return this.push(Buffer.from(`${value}\0`, 'utf8'));
  }

  bytes(value: Buffer): this {
    return this.push(value);
  }

  byte(value: string): this {
    return this.push(Buffer.from(value, 'latin1'));
  }

  private push(b: Buffer): this {
    this.parts.push(b);
    this.size += b.length;
    return this;
  }

  /** The message with `type` (none for a startup-style packet). */
  build(type?: string): Buffer {
    const header = Buffer.alloc(type ? 5 : 4);
    if (type) {
      header.write(type, 0, 'latin1');
      header.writeInt32BE(this.size + 4, 1);
    } else {
      header.writeInt32BE(this.size + 4, 0);
    }
    return Buffer.concat([header, ...this.parts]);
  }
}

export const authenticationOk = () => new MessageWriter().int32(0).build('R');

export const authenticationSasl = (mechanisms: string[]) => {
  const w = new MessageWriter().int32(10);
  for (const m of mechanisms) w.cstring(m);
  return w.byte('\0').build('R');
};

export const authenticationSaslContinue = (data: string) =>
  new MessageWriter().int32(11).bytes(Buffer.from(data, 'utf8')).build('R');

export const authenticationSaslFinal = (data: string) =>
  new MessageWriter().int32(12).bytes(Buffer.from(data, 'utf8')).build('R');

export const parameterStatus = (name: string, value: string) =>
  new MessageWriter().cstring(name).cstring(value).build('S');

export const backendKeyData = (pid: number, secret: number) =>
  new MessageWriter().int32(pid).int32(secret).build('K');

export const readyForQuery = (status: string) =>
  new MessageWriter().byte(status).build('Z');

export const commandComplete = (tag: string) =>
  new MessageWriter().cstring(tag).build('C');

export const portalSuspended = () => new MessageWriter().build('s');

export const emptyQueryResponse = () => new MessageWriter().build('I');

export interface ErrorFields {
  severity?: 'ERROR' | 'FATAL' | 'WARNING' | 'NOTICE';
  code: string;
  message: string;
  detail?: string;
  hint?: string;
}

function noticeFields(type: 'E' | 'N', fields: ErrorFields): Buffer {
  const w = new MessageWriter();
  const severity = fields.severity ?? (type === 'E' ? 'ERROR' : 'NOTICE');
  w.byte('S').cstring(severity);
  w.byte('V').cstring(severity);
  w.byte('C').cstring(fields.code);
  w.byte('M').cstring(fields.message);
  if (fields.detail) w.byte('D').cstring(fields.detail);
  if (fields.hint) w.byte('H').cstring(fields.hint);
  w.byte('\0');
  return w.build(type);
}

export const errorResponse = (fields: ErrorFields) => noticeFields('E', fields);
export const noticeResponse = (fields: ErrorFields) =>
  noticeFields('N', { ...fields, severity: fields.severity ?? 'NOTICE' });

/** The fields of an ErrorResponse or NoticeResponse. */
export function readErrorFields(body: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  const reader = new BodyReader(body);
  for (;;) {
    const code = reader.byte();
    if (code === '\0') break;
    out[code] = reader.cstring();
  }
  return out;
}

export interface FieldDescription {
  name: string;
  tableOid: number;
  column: number;
  typeOid: number;
  typeSize: number;
  typeModifier: number;
  format: number;
}

export function parseRowDescription(body: Buffer): FieldDescription[] {
  const reader = new BodyReader(body);
  const count = reader.int16();
  const fields: FieldDescription[] = [];
  for (let i = 0; i < count; i++) {
    fields.push({
      name: reader.cstring(),
      tableOid: reader.int32(),
      column: reader.int16(),
      typeOid: reader.int32(),
      typeSize: reader.int16(),
      typeModifier: reader.int32(),
      format: reader.int16(),
    });
  }
  return fields;
}

export function rowDescription(fields: FieldDescription[]): Buffer {
  const w = new MessageWriter().int16(fields.length);
  for (const f of fields) {
    w.cstring(f.name)
      .int32(f.tableOid)
      .int16(f.column)
      .int32(f.typeOid)
      .int16(f.typeSize)
      .int32(f.typeModifier)
      .int16(f.format);
  }
  return w.build('T');
}

export function dataRow(values: (Buffer | null)[]): Buffer {
  let size = 2;
  for (const v of values) size += 4 + (v ? v.length : 0);
  const out = Buffer.alloc(5 + size);
  out.write('D', 0, 'latin1');
  out.writeInt32BE(4 + size, 1);
  out.writeInt16BE(values.length, 5);
  let at = 7;
  for (const v of values) {
    if (v === null) {
      out.writeInt32BE(-1, at);
      at += 4;
    } else {
      out.writeInt32BE(v.length, at);
      v.copy(out, at + 4);
      at += 4 + v.length;
    }
  }
  return out;
}

// ── Frontend messages built by the gateway itself (for PGlite) ──────────

export const frontend = {
  query: (sql: string) => new MessageWriter().cstring(sql).build('Q'),
  parse: (name: string, sql: string, types: number[] = []) => {
    const w = new MessageWriter()
      .cstring(name)
      .cstring(sql)
      .int16(types.length);
    for (const t of types) w.int32(t);
    return w.build('P');
  },
  bind: (
    portal: string,
    statement: string,
    params: (Buffer | null)[],
    paramFormats: number[] = [],
    resultFormats: number[] = [],
  ) => {
    const w = new MessageWriter()
      .cstring(portal)
      .cstring(statement)
      .int16(paramFormats.length);
    for (const f of paramFormats) w.int16(f);
    w.int16(params.length);
    for (const p of params) {
      if (p === null) w.int32(-1);
      else w.int32(p.length).bytes(p);
    }
    w.int16(resultFormats.length);
    for (const f of resultFormats) w.int16(f);
    return w.build('B');
  },
  describe: (kind: 'S' | 'P', name: string) =>
    new MessageWriter().byte(kind).cstring(name).build('D'),
  execute: (portal: string, maxRows = 0) =>
    new MessageWriter().cstring(portal).int32(maxRows).build('E'),
  close: (kind: 'S' | 'P', name: string) =>
    new MessageWriter().byte(kind).cstring(name).build('C'),
  sync: () => new MessageWriter().build('S'),
};
