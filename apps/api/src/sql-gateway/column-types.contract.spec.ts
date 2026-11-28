import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tableFromIPC } from 'apache-arrow';
import { arrowRows } from './arrow-rows';
import type { FieldDescription } from './pg-protocol';
import { ARRAY_ELEMENT, OID, ddlType } from './pg-types';

/**
 * Real files, scanned and queried by the CLI
 * (apps/cli/tests/test_sql_column_types.py, which fails when these fixtures go
 * stale): what the scan recorded types each column of a SQL connection, and
 * what the query returned has to encode into that type, in both wire formats.
 */
const FIXTURES = join(__dirname, 'fixtures', 'column-types');

interface Contract {
  recorded: { name: string; type: string }[];
}

const SCALAR: Record<string, number> = {
  smallint: OID.int2,
  integer: OID.int4,
  bigint: OID.int8,
  numeric: OID.numeric,
  real: OID.float4,
  'double precision': OID.float8,
  boolean: OID.bool,
  text: OID.text,
  date: OID.date,
  time: OID.time,
  timestamp: OID.timestamp,
  'timestamp with time zone': OID.timestamptz,
  interval: OID.interval,
  uuid: OID.uuid,
  json: OID.json,
  jsonb: OID.jsonb,
  bytea: OID.bytea,
};

function oidOf(type: string): number {
  const base = type.replace(/\(.*\)$/, '');
  if (!base.endsWith('[]')) {
    expect(SCALAR).toHaveProperty([base]);
    return SCALAR[base];
  }
  const element = oidOf(base.slice(0, -2));
  const array = Object.entries(ARRAY_ELEMENT).find(([, e]) => e === element);
  expect(array).toBeDefined();
  return Number(array![0]);
}

/** What each column of the fixtures must be to a BI tool: sums need numbers. */
const EXPECTED: Record<string, Record<string, string>> = {
  parquet: {
    c_bool: 'boolean',
    c_tinyint: 'bigint',
    c_smallint: 'smallint',
    c_int: 'integer',
    c_bigint: 'bigint',
    c_utinyint: 'smallint',
    c_usmallint: 'integer',
    c_uinteger: 'bigint',
    c_ubigint: 'numeric',
    c_float: 'real',
    c_double: 'double precision',
    c_decimal: 'numeric(5,2)',
    c_decimal18: 'numeric(18,3)',
    c_decimal38: 'numeric(38,6)',
    c_text: 'text',
    c_blob: 'bytea',
    c_date: 'date',
    c_time: 'time',
    c_timestamp: 'timestamp',
    c_timestamptz: 'timestamp with time zone',
    c_uuid: 'uuid',
    c_ints: 'integer[]',
    c_texts: 'text[]',
    c_struct: 'json',
    c_map: 'json',
    c_structs: 'json',
  },
  jsonl: {
    i: 'bigint',
    big: 'bigint',
    f: 'double precision',
    flag: 'boolean',
    name: 'text',
    day: 'date',
    at: 'timestamp',
    id: 'uuid',
    tags: 'text[]',
    nested: 'json',
    clock: 'time',
  },
};

describe.each(Object.keys(EXPECTED))(
  'column types of a %s file over a SQL connection',
  (name) => {
    const contract = JSON.parse(
      readFileSync(join(FIXTURES, `${name}.json`), 'utf8'),
    ) as Contract;
    const bytes = readFileSync(join(FIXTURES, `${name}.arrow`));

    it('types every column from what the scan recorded', () => {
      expect(
        Object.fromEntries(
          contract.recorded.map((c) => [c.name, ddlType(c.type)]),
        ),
      ).toEqual(EXPECTED[name]);
    });

    it.each([
      ['text', 0 as const],
      ['binary', 1 as const],
    ])('encodes what the query returned, in %s format', (_label, format) => {
      const rows = arrowRows(bytes);
      expect(rows.numRows).toBe(tableFromIPC(bytes).numRows);
      for (const [column, recorded] of contract.recorded.entries()) {
        // One column at a time, so a failure names it.
        const fields = contract.recorded.map(
          (c, i): FieldDescription => ({
            name: c.name,
            tableOid: 0,
            column: 0,
            typeOid: i === column ? oidOf(ddlType(recorded.type)) : OID.text,
            typeSize: -1,
            typeModifier: -1,
            format: i === column ? format : 0,
          }),
        );
        for (let row = 0; row < rows.numRows; row += 1) {
          expect(() => rows.encodeRow(row, fields)).not.toThrow();
        }
      }
    });
  },
);
