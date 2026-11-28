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
    // Arrow, as Parquet scans record it.
    ['decimal128(5, 2)', 'numeric(5,2)'],
    ['decimal256(50, 4)', 'numeric(50,4)'],
    ['date32[day]', 'date'],
    ['date64[ms]', 'date'],
    ['time64[us]', 'time'],
    ['time32[ms]', 'time'],
    ['timestamp[us]', 'timestamp'],
    ['timestamp[us, tz=UTC]', 'timestamp with time zone'],
    ['halffloat', 'real'],
    ['large_binary', 'bytea'],
    ['fixed_size_binary[16]', 'bytea'],
    ['list<element: int32>', 'integer[]'],
    ['list<item: string>', 'text[]'],
    ['large_list<item: int64>', 'bigint[]'],
    ['fixed_size_list<item: double>[3]', 'double precision[]'],
    ['list<element: struct<a: int32>>', 'json'],
    ['struct<a: int32, b: list<item: string>>', 'json'],
    ['map<string, int32>', 'json'],
    ['dictionary<values=int32, indices=int8, ordered=0>', 'integer'],
    ['duration[us]', 'text'],
    // DuckDB, as CSV, JSON, Avro and geo files record it.
    ['VARCHAR[]', 'text[]'],
    ['INTEGER[3]', 'integer[]'],
    ['STRUCT(email VARCHAR)[]', 'json'],
    ['MAP(VARCHAR, INTEGER)', 'json'],
    ['TIME WITH TIME ZONE', 'text'],
    ['TIMESTAMP_NS', 'timestamp'],
    ['UTINYINT', 'smallint'],
    ['UBIGINT', 'numeric'],
    // Delta and Iceberg.
    ['long', 'bigint'],
    ['byte', 'smallint'],
    ['fixed[16]', 'bytea'],
    ['timestamptz', 'timestamp with time zone'],
    ['timestamp_ntz', 'timestamp'],
    // MySQL.
    ['int unsigned', 'bigint'],
    ['int(10) unsigned', 'bigint'],
    ['bigint unsigned', 'numeric'],
    ['smallint unsigned', 'integer'],
    ['tinyint unsigned', 'smallint'],
    ['decimal(10,2) unsigned', 'numeric(10,2)'],
    ['float(10,2)', 'real'],
    ['mediumblob', 'bytea'],
    // PostgreSQL's information_schema.
    ['time without time zone', 'time'],
    ['time with time zone', 'text'],
    ['ARRAY', 'text'],
    // As the PostgreSQL scan records arrays, bit strings and money.
    ['int4[]', 'integer[]'],
    ['int2[]', 'smallint[]'],
    ['int8[]', 'bigint[]'],
    ['float8[]', 'double precision[]'],
    ['text[]', 'text[]'],
    ['timestamptz[]', 'timestamp with time zone[]'],
    ['mood[]', 'text[]'],
    ['bit', 'boolean'],
    ['bit(4)', 'text'],
    ['text (money)', 'text'],
    ['USER-DEFINED', 'text'],
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

  // Seen over a SQL connection: every TIME column failed with "Cannot show
  // 05:06:07 as a date or time".
  it('writes a time of day the job answered as text', () => {
    expect(textOf('05:06:07', OID.time)).toBe('05:06:07');
    expect(textOf('05:06:07.500000', OID.time)).toBe('05:06:07.5');
    expect(binaryOf('00:00:01.000002', OID.time).readBigInt64BE()).toBe(
      1_000_002n,
    );
    expect(() => textOf('half past', OID.time)).toThrow('Cannot show');
  });

  // Seen over a SQL connection: the value read `MonthDayNano(months=0, …)`.
  it('writes an interval in the binary format', () => {
    const bytes = binaryOf('1 year 2 mons -3 days -04:05:06.5', OID.interval);
    expect(bytes.readBigInt64BE(0)).toBe(-14_706_500_000n);
    expect(bytes.readInt32BE(8)).toBe(-3);
    expect(bytes.readInt32BE(12)).toBe(14);
    expect(binaryOf('00:00:00', OID.interval)).toEqual(Buffer.alloc(16));
    expect(() => binaryOf('soon', OID.interval)).toThrow('interval');
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
