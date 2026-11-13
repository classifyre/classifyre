import {
  OID,
  binaryOf,
  ddlType,
  numericBinary,
  plainValue,
  textOf,
} from './pg-types';

describe('ddlType', () => {
  it.each([
    ['INTEGER', 'integer'],
    ['BIGINT', 'bigint'],
    ['int64', 'bigint'],
    ['VARCHAR', 'text'],
    ['character varying(255)', 'text'],
    ['DECIMAL(12,2)', 'numeric(12,2)'],
    ['numeric', 'numeric'],
    ['DOUBLE', 'double precision'],
    ['TIMESTAMP WITH TIME ZONE', 'timestamp with time zone'],
    ['timestamp without time zone', 'timestamp'],
    ['datetime64[ns]', 'timestamp'],
    ['DATE', 'date'],
    ['BOOLEAN', 'boolean'],
    ['tinyint(1)', 'boolean'],
    ['INTEGER[]', 'integer[]'],
    ['STRUCT(a INTEGER)', 'json'],
    ['HUGEINT', 'numeric'],
    ['BLOB', 'bytea'],
    ['UUID', 'uuid'],
    ['', 'text'],
    ['GEOMETRY', 'text'],
  ])('%s → %s', (raw, expected) => {
    expect(ddlType(raw)).toBe(expected);
  });
});

describe('values', () => {
  const ts = plainValue(1794564672123.456, { typeId: 10, unit: 2 });
  it('writes timestamps and dates as PostgreSQL does', () => {
    expect(textOf(ts, OID.timestamp)).toBe('2026-11-13 10:11:12.123456');
    expect(textOf(ts, OID.timestamptz)).toBe('2026-11-13 10:11:12.123456+00');
    expect(textOf(plainValue(1794528000000, { typeId: 8 }), OID.date)).toBe(
      '2026-11-13',
    );
  });

  it('scales decimals', () => {
    expect(
      plainValue({ toString: () => '1234' }, { typeId: 7, scale: 2 }),
    ).toBe('12.34');
    expect(plainValue({ toString: () => '-5' }, { typeId: 7, scale: 2 })).toBe(
      '-0.05',
    );
  });

  it('writes booleans, numbers, arrays and bytes', () => {
    expect(textOf(true, OID.bool)).toBe('t');
    expect(textOf(1e21, OID.numeric)).toBe('1000000000000000000000');
    expect(textOf(['a', null, 'b c'], 1009)).toBe('{a,NULL,"b c"}');
    expect(textOf(Buffer.from('A'), OID.bytea)).toBe('\\x41');
  });

  it('encodes binary like the server', () => {
    expect(binaryOf(5, OID.int4)).toEqual(Buffer.from([0, 0, 0, 5]));
    expect(binaryOf(9007199254740993n, OID.int8).readBigInt64BE()).toBe(
      9007199254740993n,
    );
    // 2000-01-02 00:00:00 = one day after the PostgreSQL epoch.
    expect(
      binaryOf(
        { micros: 946771200000000n, kind: 'timestamp' },
        OID.timestamp,
      ).readBigInt64BE(),
    ).toBe(86400000000n);
    expect(
      binaryOf(
        { micros: 946771200000000n, kind: 'date' },
        OID.date,
      ).readInt32BE(),
    ).toBe(1);
  });

  it('encodes numeric in base 10000', () => {
    // 12345.678 → digits [1, 2345, 6780], weight 1, dscale 3
    const b = numericBinary('12345.678');
    expect([
      b.readInt16BE(0),
      b.readInt16BE(2),
      b.readUInt16BE(4),
      b.readInt16BE(6),
    ]).toEqual([3, 1, 0, 3]);
    expect([b.readInt16BE(8), b.readInt16BE(10), b.readInt16BE(12)]).toEqual([
      1, 2345, 6780,
    ]);
    const negative = numericBinary('-0.05');
    expect([
      negative.readInt16BE(0),
      negative.readInt16BE(2),
      negative.readUInt16BE(4),
      negative.readInt16BE(6),
      negative.readInt16BE(8),
    ]).toEqual([1, -1, 0x4000, 2, 500]);
    expect(numericBinary('0').readInt16BE(0)).toBe(0);
  });
});
