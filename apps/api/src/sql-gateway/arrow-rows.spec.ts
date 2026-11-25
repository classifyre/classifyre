import {
  tableFromArrays,
  tableToIPC,
  Utf8,
  Int64,
  Float64,
  Bool,
  DateMillisecond,
  TimestampMicrosecond,
  makeVector,
  vectorFromArray,
  Table,
} from 'apache-arrow';
import { BodyReader, type FieldDescription } from './pg-protocol';
import { OID } from './pg-types';
import { arrowRows, DataError, plainRows } from './arrow-rows';

function decodeDataRow(frame: Buffer): (Buffer | null)[] {
  expect(String.fromCharCode(frame[0])).toBe('D');
  const reader = new BodyReader(frame.subarray(5));
  const count = reader.int16();
  const out: (Buffer | null)[] = [];
  for (let i = 0; i < count; i += 1) {
    const len = reader.int32();
    out.push(len < 0 ? null : Buffer.from(reader.bytes(len)));
  }
  return out;
}

const field = (
  name: string,
  typeOid: number,
  format: 0 | 1 = 0,
): FieldDescription => ({
  name,
  tableOid: 0,
  column: 0,
  typeOid,
  typeSize: -1,
  typeModifier: -1,
  format,
});

describe('arrowRows direct wire encoding', () => {
  it('encodes Arrow IPC columns directly into text and binary PG DataRow frames', () => {
    const table = tableFromArrays({
      id: new BigInt64Array([1n, 2n]),
      name: ['Ana', null],
      score: new Float64Array([12.5, 99.25]),
      active: [true, false],
    });
    const ipc = Buffer.from(tableToIPC(table, 'stream'));
    const rows = arrowRows(ipc);

    expect(rows.numRows).toBe(2);
    expect(rows.numCols).toBe(4);

    const textFields = [
      field('id', OID.int8, 0),
      field('name', OID.text, 0),
      field('score', OID.float8, 0),
      field('active', OID.bool, 0),
    ];
    const r0 = decodeDataRow(rows.encodeRow(0, textFields)).map((b) =>
      b ? b.toString('utf8') : null,
    );
    expect(r0).toEqual(['1', 'Ana', '12.5', 't']);

    const r1 = decodeDataRow(rows.encodeRow(1, textFields)).map((b) =>
      b ? b.toString('utf8') : null,
    );
    expect(r1).toEqual(['2', null, '99.25', 'f']);

    const binFields = [
      field('id', OID.int8, 1),
      field('name', OID.text, 1),
      field('score', OID.float8, 1),
      field('active', OID.bool, 1),
    ];
    const b0 = decodeDataRow(rows.encodeRow(0, binFields));
    expect(b0[0]?.readBigInt64BE()).toBe(1n);
    expect(b0[1]?.toString('utf8')).toBe('Ana');
    expect(b0[2]?.readDoubleBE()).toBe(12.5);
    expect(b0[3]).toEqual(Buffer.from([1]));
  });

  it('encodes Arrow date and timestamp vectors accurately', () => {
    const table = new Table({
      d: makeVector({
        data: new BigInt64Array([BigInt(Date.UTC(2026, 10, 13))]),
        type: new DateMillisecond(),
      }),
      ts: makeVector({
        data: new BigInt64Array([1794564672123456n]),
        type: new TimestampMicrosecond(),
      }),
      label: vectorFromArray(['ok'], new Utf8()),
      flag: vectorFromArray([true], new Bool()),
      n: makeVector({ data: new BigInt64Array([42n]), type: new Int64() }),
      f: makeVector({ data: new Float64Array([3.5]), type: new Float64() }),
    });
    const ipc = Buffer.from(tableToIPC(table, 'stream'));
    const rows = arrowRows(ipc);
    const fields = [
      field('d', OID.date, 0),
      field('ts', OID.timestamptz, 0),
      field('label', OID.text, 0),
      field('flag', OID.bool, 0),
      field('n', OID.int8, 0),
      field('f', OID.float8, 0),
    ];
    const decoded = decodeDataRow(rows.encodeRow(0, fields)).map((b) =>
      b ? b.toString('utf8') : null,
    );
    expect(decoded).toEqual([
      '2026-11-13',
      '2026-11-13 10:11:12.123456+00',
      'ok',
      't',
      '42',
      '3.5',
    ]);
  });

  it('throws DataError XX000 when column counts mismatch', () => {
    const rows = plainRows([[1, 'a']]);
    expect(() => rows.encodeRow(0, [field('only_one', OID.int4)])).toThrow(
      DataError,
    );
    try {
      rows.encodeRow(0, [field('only_one', OID.int4)]);
    } catch (e) {
      expect((e as DataError).sqlState).toBe('XX000');
    }
  });

  it('throws DataError 22P03 on unencodable values', () => {
    const rows = plainRows([['not-a-uuid']]);
    try {
      rows.encodeRow(0, [field('u', OID.uuid, 1)]);
      fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(DataError);
      expect((e as DataError).sqlState).toBe('22P03');
    }
  });
});
