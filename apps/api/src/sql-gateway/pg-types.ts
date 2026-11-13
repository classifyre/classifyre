/**
 * Types between the query job's Arrow results and PostgreSQL clients.
 *
 * The catalog a client sees is PostgreSQL (PGlite): every table's columns get
 * a PostgreSQL type from the scan's recorded type ({@link ddlType}), and
 * PGlite decides each result column's type (RowDescription). The job answers
 * in DuckDB's types, as Arrow; {@link encodeValue} turns each value into the
 * type the client was told, in text or binary format — Npgsql (Power BI) and
 * pgJDBC ask for binary.
 */

export const OID = {
  bool: 16,
  bytea: 17,
  char: 18,
  name: 19,
  int8: 20,
  int2: 21,
  int4: 23,
  text: 25,
  oid: 26,
  json: 114,
  float4: 700,
  float8: 701,
  unknown: 705,
  bpchar: 1042,
  varchar: 1043,
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  interval: 1186,
  numeric: 1700,
  uuid: 2950,
  jsonb: 3802,
} as const;

/** Array type → element type, for the arrays a table column can have. */
export const ARRAY_ELEMENT: Record<number, number> = {
  1000: OID.bool,
  1001: OID.bytea,
  1005: OID.int2,
  1007: OID.int4,
  1016: OID.int8,
  1009: OID.text,
  1015: OID.varchar,
  1021: OID.float4,
  1022: OID.float8,
  1182: OID.date,
  1115: OID.timestamp,
  1185: OID.timestamptz,
  1231: OID.numeric,
  2951: OID.uuid,
  199: OID.json,
  3807: OID.jsonb,
};

/**
 * A scan's column type (DuckDB, the source's own, pandas-ish) as a
 * PostgreSQL type. Unknown and empty types are `text`: always encodable.
 */
export function ddlType(raw: string | null | undefined): string {
  const type = (raw ?? '').trim().toLowerCase();
  if (!type) return 'text';
  const list =
    /^(.*)\[\]$/.exec(type) ?? /^(?:list|array)\s*<\s*(.*)\s*>$/.exec(type);
  if (list) {
    const inner = ddlType(list[1]);
    return /\[\]$/.test(inner) || inner === 'json' ? 'json' : `${inner}[]`;
  }
  if (/^(struct|map|union|row)\b|^\{/.test(type)) return 'json';
  if (/^(bool|boolean|bit)$|^tinyint\(1\)$/.test(type)) return 'boolean';
  if (
    /^(tinyint|smallint|int2|int16|uint8|utinyint|int8_t|short)\b/.test(type)
  ) {
    return 'smallint';
  }
  if (
    /^(bigint|int8|int64|long|uint32|uinteger|bigserial|serial8)\b/.test(type)
  ) {
    return 'bigint';
  }
  if (/^(hugeint|uhugeint|uint64|ubigint|int128)\b/.test(type))
    return 'numeric';
  if (
    /^(int|integer|int4|int32|mediumint|serial|usmallint|uint16)\b/.test(type)
  ) {
    return 'integer';
  }
  if (/^(real|float4|float32|float)$/.test(type)) return 'real';
  if (/^(double|float8|float64|double precision|binary_double)\b/.test(type)) {
    return 'double precision';
  }
  const decimal =
    /^(?:decimal|numeric|number|dec)\s*\(\s*(\d+)\s*(?:,\s*(-?\d+)\s*)?\)/.exec(
      type,
    );
  if (decimal) {
    const precision = Number(decimal[1]);
    const scale = Number(decimal[2] ?? 0);
    return precision >= 1 &&
      precision <= 1000 &&
      scale >= 0 &&
      scale <= precision
      ? `numeric(${precision},${scale})`
      : 'numeric';
  }
  if (/^(decimal|numeric|number|money|bignumeric)\b/.test(type))
    return 'numeric';
  if (/^date$/.test(type)) return 'date';
  if (
    /with time zone|^timestamptz|^timestamp_tz|^datetimeoffset|tz=|datetime64\[.*,/.test(
      type,
    )
  ) {
    return 'timestamp with time zone';
  }
  if (
    /^(timestamp|datetime|datetime2|smalldatetime|timestamp_ntz|timestamp_ms|timestamp_s|timestamp_ns|datetime64)/.test(
      type,
    )
  ) {
    return 'timestamp';
  }
  if (/^time\b/.test(type)) return 'time';
  if (/^interval/.test(type)) return 'interval';
  if (/^uuid|^uniqueidentifier/.test(type)) return 'uuid';
  if (/^jsonb$/.test(type)) return 'jsonb';
  if (/^json/.test(type)) return 'json';
  if (
    /^(blob|bytea|binary|varbinary|bytes|image|longblob|mediumblob)\b/.test(
      type,
    )
  ) {
    return 'bytea';
  }
  return 'text';
}

/** Arrow type ids (apache-arrow `Type`) the encoder looks at. */
const ARROW = {
  binary: 4,
  decimal: 7,
  date: 8,
  time: 9,
  timestamp: 10,
  list: 12,
  struct: 13,
  map: 17,
  largeBinary: -4,
} as const;

export interface ArrowFieldType {
  typeId: number;
  scale?: number;
  unit?: number;
  children?: { type: ArrowFieldType }[];
}

/** A value from the job, made plain: what both formats are written from. */
export type PlainValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Buffer
  | { micros: bigint; kind: 'date' | 'timestamp' | 'time' }
  | PlainValue[]
  | { json: string };

const TIME_UNIT_TO_MICROS = [1_000_000, 1_000, 1, 0.001];

function decimalString(raw: unknown, scale: number): string {
  let digits = String(raw);
  const negative = digits.startsWith('-');
  if (negative) digits = digits.slice(1);
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  return negative ? `-${digits}` : digits;
}

/** Arrow value → {@link PlainValue}. */
export function plainValue(value: unknown, type: ArrowFieldType): PlainValue {
  if (value === null || value === undefined) return null;
  switch (type.typeId) {
    case ARROW.decimal:
      return decimalString(value, type.scale ?? 0);
    case ARROW.date:
      return {
        micros: BigInt(Math.round(Number(value))) * 1000n,
        kind: 'date',
      };
    case ARROW.timestamp:
      return {
        micros: BigInt(Math.round(Number(value) * 1000)),
        kind: 'timestamp',
      };
    case ARROW.time: {
      const factor = TIME_UNIT_TO_MICROS[type.unit ?? 2] ?? 1;
      return {
        micros: BigInt(Math.round(Number(value) * factor)),
        kind: 'time',
      };
    }
    case ARROW.binary:
    case ARROW.largeBinary:
      return Buffer.from(value as Uint8Array);
    case ARROW.list: {
      const child = type.children?.[0]?.type ?? { typeId: 0 };
      const items = (value as { toArray(): unknown[] }).toArray
        ? [...(value as { toArray(): unknown[] }).toArray()]
        : (value as unknown[]);
      return items.map((item) => plainValue(item, child));
    }
    case ARROW.struct:
    case ARROW.map:
      return { json: jsonText(value) };
    default:
      if (value instanceof Date) {
        return { micros: BigInt(value.getTime()) * 1000n, kind: 'timestamp' };
      }
      if (value instanceof Uint8Array) return Buffer.from(value);
      if (
        typeof value === 'boolean' ||
        typeof value === 'number' ||
        typeof value === 'bigint' ||
        typeof value === 'string'
      ) {
        return value;
      }
      return { json: jsonText(value) };
  }
}

function jsonText(value: unknown): string {
  const plain =
    value && typeof (value as { toJSON?: () => unknown }).toJSON === 'function'
      ? (value as { toJSON: () => unknown }).toJSON()
      : value;
  return JSON.stringify(plain, (_key, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
}

export class EncodeError extends Error {}

// ── Text ────────────────────────────────────────────────────────────────

const EPOCH_2000_MICROS = 946_684_800_000_000n;
const pad = (n: number | bigint, width = 2) => String(n).padStart(width, '0');

function splitMicros(micros: bigint): { ms: number; frac: number } {
  const ms = micros / 1000n;
  let frac = Number(micros % 1_000_000n);
  if (frac < 0) frac += 1_000_000;
  return {
    ms: Number(ms - (micros < 0n && micros % 1000n !== 0n ? 1n : 0n)),
    frac,
  };
}

function dateText(micros: bigint): string {
  const d = new Date(splitMicros(micros).ms);
  const year = d.getUTCFullYear();
  const text = `${pad(Math.abs(year), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return year <= 0 ? `${pad(1 - year, 4)}${text.slice(4)} BC` : text;
}

function timeOfDay(micros: bigint): string {
  let day = micros % 86_400_000_000n;
  if (day < 0n) day += 86_400_000_000n;
  const seconds = day / 1_000_000n;
  const frac = Number(day % 1_000_000n);
  const text = `${pad(seconds / 3600n)}:${pad((seconds / 60n) % 60n)}:${pad(seconds % 60n)}`;
  return frac ? `${text}.${pad(frac, 6).replace(/0+$/, '')}` : text;
}

function timestampText(micros: bigint, zoned: boolean): string {
  return `${dateText(micros)} ${timeOfDay(micros)}${zoned ? '+00' : ''}`;
}

function numberText(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  return String(value);
}

/** A number as a plain decimal, never in exponent form (numeric text). */
function plainDecimal(value: number | bigint | string): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value.trim();
  if (!Number.isFinite(value)) return numberText(value);
  const text = String(value);
  if (!/e/i.test(text)) return text;
  const [mantissa, exp] = text.toLowerCase().split('e');
  const e = Number(exp);
  const negative = mantissa.startsWith('-');
  const [intPart, fracPart = ''] = mantissa.replace('-', '').split('.');
  const digits = intPart + fracPart;
  const point = intPart.length + e;
  const out =
    point <= 0
      ? `0.${'0'.repeat(-point)}${digits}`
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return negative ? `-${out}` : out;
}

function asText(value: PlainValue): string {
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return numberText(value);
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (Array.isArray(value)) return jsonText(value.map((v) => toJsonValue(v)));
  if ('json' in value) return value.json;
  if (value.kind === 'date') return dateText(value.micros);
  if (value.kind === 'time') return timeOfDay(value.micros);
  return timestampText(value.micros, false);
}

function toJsonValue(value: PlainValue): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if ('json' in value) return JSON.parse(value.json) as unknown;
  return asText(value);
}

function micros(value: PlainValue, oid: number): bigint {
  if (value && typeof value === 'object' && 'micros' in value) {
    return value.micros;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(
      oid === OID.date
        ? `${value}T00:00:00Z`
        : value.replace(' ', 'T') +
            (/[zZ+-]\d*:?\d*$/.test(value.slice(10)) ? '' : 'Z'),
    );
    if (!Number.isNaN(parsed)) return BigInt(parsed) * 1000n;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return BigInt(value) * 1000n;
  }
  throw new EncodeError(`Cannot show ${asText(value)} as a date or time.`);
}

function arrayText(items: PlainValue[], element: number): string {
  const parts = items.map((item) => {
    if (item === null) return 'NULL';
    if (Array.isArray(item)) return arrayText(item, element);
    const text = textOf(item, element);
    return /^[^{}",\\\s]+$/.test(text) && text.toUpperCase() !== 'NULL'
      ? text
      : `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  });
  return `{${parts.join(',')}}`;
}

/** The text format of a value as the PostgreSQL type `oid`. */
export function textOf(value: PlainValue, oid: number): string {
  if (value === null) return '';
  switch (oid) {
    case OID.bool:
      if (typeof value === 'boolean') return value ? 't' : 'f';
      return /^(t|true|1|y|yes|on)$/i.test(asText(value)) ? 't' : 'f';
    case OID.int2:
    case OID.int4:
    case OID.int8:
    case OID.oid:
      if (typeof value === 'number') return String(Math.trunc(value));
      return asText(value);
    case OID.float4:
    case OID.float8:
      return typeof value === 'number' ? numberText(value) : asText(value);
    case OID.numeric:
      return typeof value === 'number' ||
        typeof value === 'bigint' ||
        typeof value === 'string'
        ? plainDecimal(value)
        : asText(value);
    case OID.date:
      return dateText(micros(value, oid));
    case OID.timestamp:
      return timestampText(micros(value, oid), false);
    case OID.timestamptz:
      return timestampText(micros(value, oid), true);
    case OID.time:
      return timeOfDay(micros(value, oid));
    case OID.bytea:
      return Buffer.isBuffer(value)
        ? `\\x${value.toString('hex')}`
        : `\\x${Buffer.from(asText(value), 'utf8').toString('hex')}`;
    case OID.json:
    case OID.jsonb:
      if (typeof value === 'string') return value;
      return jsonText(toJsonValue(value));
    default: {
      const element = ARRAY_ELEMENT[oid];
      if (element !== undefined && Array.isArray(value)) {
        return arrayText(value, element);
      }
      return asText(value);
    }
  }
}

// ── Binary ──────────────────────────────────────────────────────────────

function int(bytes: 2 | 4 | 8, value: PlainValue): Buffer {
  const b = Buffer.alloc(bytes);
  const text =
    typeof value === 'number' ? String(Math.trunc(value)) : asText(value);
  if (bytes === 8) b.writeBigInt64BE(BigInt(text));
  else if (bytes === 4) b.writeInt32BE(Number(text));
  else b.writeInt16BE(Number(text));
  return b;
}

/** numeric in PostgreSQL's binary form: base-10000 digits, weight, sign, scale. */
export function numericBinary(text: string): Buffer {
  const value = text.trim();
  const header = Buffer.alloc(8);
  if (/^nan$/i.test(value)) {
    header.writeUInt16BE(0xc000, 4);
    return header;
  }
  if (/^-?infinity$/i.test(value)) {
    header.writeUInt16BE(value.startsWith('-') ? 0xf000 : 0xd000, 4);
    return header;
  }
  const match = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(value);
  if (!match) throw new EncodeError(`${value} is not a number.`);
  const negative = match[1] === '-';
  const intDigits = (match[2] || '0').replace(/^0+(?=\d)/, '');
  const fracDigits = match[3] ?? '';
  const dscale = fracDigits.length;
  const intPadded = intDigits.padStart(
    Math.ceil(intDigits.length / 4) * 4,
    '0',
  );
  const fracPadded = fracDigits.padEnd(
    Math.ceil(fracDigits.length / 4) * 4,
    '0',
  );
  const groups: number[] = [];
  for (let i = 0; i < intPadded.length; i += 4) {
    groups.push(Number(intPadded.slice(i, i + 4)));
  }
  let weight = groups.length - 1;
  for (let i = 0; i < fracPadded.length; i += 4) {
    groups.push(Number(fracPadded.slice(i, i + 4)));
  }
  while (groups.length && groups[0] === 0) {
    groups.shift();
    weight -= 1;
  }
  while (groups.length && groups[groups.length - 1] === 0) groups.pop();
  if (!groups.length) weight = 0;
  const out = Buffer.alloc(8 + groups.length * 2);
  out.writeInt16BE(groups.length, 0);
  out.writeInt16BE(weight, 2);
  out.writeUInt16BE(negative && groups.length ? 0x4000 : 0, 4);
  out.writeInt16BE(dscale, 6);
  groups.forEach((g, i) => out.writeInt16BE(g, 8 + i * 2));
  return out;
}

function arrayBinary(items: PlainValue[], element: number): Buffer {
  const encoded = items.map((item) =>
    item === null ? null : binaryOf(item, element),
  );
  const header = Buffer.alloc(20);
  header.writeInt32BE(1, 0);
  header.writeInt32BE(encoded.some((e) => e === null) ? 1 : 0, 4);
  header.writeUInt32BE(element, 8);
  header.writeInt32BE(encoded.length, 12);
  header.writeInt32BE(1, 16);
  const parts: Buffer[] = [header];
  for (const e of encoded) {
    const length = Buffer.alloc(4);
    length.writeInt32BE(e === null ? -1 : e.length);
    parts.push(length);
    if (e) parts.push(e);
  }
  return Buffer.concat(parts);
}

/** The binary format of a value as the PostgreSQL type `oid`. */
export function binaryOf(value: PlainValue, oid: number): Buffer {
  switch (oid) {
    case OID.bool:
      return Buffer.from([textOf(value, oid) === 't' ? 1 : 0]);
    case OID.int2:
      return int(2, value);
    case OID.int4:
      return int(4, value);
    case OID.int8:
      return int(8, value);
    case OID.oid: {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(Number(asText(value)));
      return b;
    }
    case OID.float4: {
      const b = Buffer.alloc(4);
      b.writeFloatBE(Number(typeof value === 'number' ? value : asText(value)));
      return b;
    }
    case OID.float8: {
      const b = Buffer.alloc(8);
      b.writeDoubleBE(
        Number(typeof value === 'number' ? value : asText(value)),
      );
      return b;
    }
    case OID.numeric:
      return numericBinary(textOf(value, oid));
    case OID.text:
    case OID.varchar:
    case OID.bpchar:
    case OID.name:
    case OID.char:
    case OID.unknown:
    case OID.json:
      return Buffer.from(textOf(value, oid), 'utf8');
    case OID.jsonb:
      return Buffer.concat([
        Buffer.from([1]),
        Buffer.from(textOf(value, oid), 'utf8'),
      ]);
    case OID.bytea:
      return Buffer.isBuffer(value)
        ? value
        : Buffer.from(asText(value), 'utf8');
    case OID.uuid: {
      const hex = asText(value).replace(/-/g, '');
      if (!/^[0-9a-f]{32}$/i.test(hex)) {
        throw new EncodeError(`${asText(value)} is not a UUID.`);
      }
      return Buffer.from(hex, 'hex');
    }
    case OID.date: {
      const b = Buffer.alloc(4);
      const days = (micros(value, oid) - EPOCH_2000_MICROS) / 86_400_000_000n;
      b.writeInt32BE(Number(days));
      return b;
    }
    case OID.timestamp:
    case OID.timestamptz: {
      const b = Buffer.alloc(8);
      b.writeBigInt64BE(micros(value, oid) - EPOCH_2000_MICROS);
      return b;
    }
    case OID.time: {
      const b = Buffer.alloc(8);
      let day = micros(value, oid) % 86_400_000_000n;
      if (day < 0n) day += 86_400_000_000n;
      b.writeBigInt64BE(day);
      return b;
    }
    default: {
      const element = ARRAY_ELEMENT[oid];
      if (element !== undefined && Array.isArray(value)) {
        return arrayBinary(value, element);
      }
      throw new EncodeError(
        `Type ${oid} cannot be sent in binary; cast the column to text.`,
      );
    }
  }
}

export function encodeValue(
  value: PlainValue,
  oid: number,
  format: number,
): Buffer | null {
  if (value === null) return null;
  return format === 1
    ? binaryOf(value, oid)
    : Buffer.from(textOf(value, oid), 'utf8');
}
