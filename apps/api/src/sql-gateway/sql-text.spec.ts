import {
  firstKeyword,
  parseCursorStatement,
  splitStatements,
  substituteParams,
} from './sql-text';
import { paramLiteral, readTables } from './pg-session';
import { OID } from './pg-types';

describe('splitStatements', () => {
  it('splits on semicolons in code only', () => {
    expect(
      splitStatements(
        `SET search_path = 'a;b'; SELECT ';' AS "x;y" -- c;d\n; SELECT $$a;b$$, $t$;$t$; /* ; /* ; */ */ SELECT E'\\';'`,
      ),
    ).toEqual([
      "SET search_path = 'a;b'",
      `SELECT ';' AS "x;y" -- c;d`,
      'SELECT $$a;b$$, $t$;$t$',
      "/* ; /* ; */ */ SELECT E'\\';'",
    ]);
  });

  it('drops empty and comment-only statements', () => {
    expect(splitStatements(';; -- nothing\n ;')).toEqual([]);
  });
});

describe('firstKeyword', () => {
  it('skips comments and parentheses', () => {
    expect(firstKeyword('/* x */ -- y\n ( select 1)')).toBe('SELECT');
    expect(firstKeyword('with a as (select 1) select * from a')).toBe('WITH');
  });
});

describe('substituteParams', () => {
  it('replaces $n in code, not in strings or identifiers', () => {
    expect(
      substituteParams(`SELECT '$1', "$2", $1, $2, $10 FROM t WHERE a = $1`, [
        '5',
        "'x'",
      ]),
    ).toBe(`SELECT '$1', "$2", 5, 'x', $10 FROM t WHERE a = 5`);
  });
});

describe('paramLiteral', () => {
  it('writes numbers bare, text quoted, dates cast', () => {
    expect(paramLiteral('42', OID.int4)).toBe('42');
    expect(paramLiteral('1; DROP', OID.int4)).toBe("'1; DROP'");
    expect(paramLiteral("O'Brien", OID.text)).toBe("'O''Brien'");
    expect(paramLiteral('2026-11-13', OID.date)).toBe(
      "CAST('2026-11-13' AS date)",
    );
    expect(paramLiteral('t', OID.bool)).toBe('TRUE');
    expect(paramLiteral(null, OID.text)).toBe('NULL');
  });
});

describe('readTables', () => {
  it('separates the person’s tables from the catalog', () => {
    expect(
      readTables(
        ['lab_s3.tables|delta_orders', 'pg_catalog|pg_class'],
        new Set(['lab_s3.tables']),
      ),
    ).toEqual({
      data: ['lab_s3.tables.delta_orders'],
      other: ['pg_catalog.pg_class'],
    });
  });
});

describe('cursor statements (psqlODBC UseDeclareFetch, BIC D5)', () => {
  it('reads DECLARE … CURSOR … FOR as psqlODBC and others write it', () => {
    expect(
      parseCursorStatement(
        'declare "SQL_CUR0x1e68" cursor with hold for SELECT id FROM "a.b".t ORDER BY id',
      ),
    ).toEqual({
      kind: 'declare',
      name: 'SQL_CUR0x1e68',
      hold: true,
      scroll: false,
      query: 'SELECT id FROM "a.b".t ORDER BY id',
    });
    expect(
      parseCursorStatement('DECLARE C1 BINARY NO SCROLL CURSOR FOR select 1;'),
    ).toEqual({
      kind: 'declare',
      name: 'c1',
      hold: false,
      scroll: false,
      query: 'select 1',
    });
    expect(
      parseCursorStatement(
        'declare c insensitive cursor without hold for select 1',
      ),
    ).toMatchObject({ name: 'c', hold: false, query: 'select 1' });
  });

  it('reads FETCH counts and CLOSE', () => {
    expect(parseCursorStatement('fetch 100 in "SQL_CUR0x1"')).toEqual({
      kind: 'fetch',
      name: 'SQL_CUR0x1',
      count: 100,
    });
    expect(parseCursorStatement('FETCH NEXT FROM c')).toMatchObject({
      count: 1,
    });
    expect(parseCursorStatement('fetch all from c')).toMatchObject({
      count: 'all',
    });
    expect(parseCursorStatement('FETCH FORWARD 5 FROM c')).toMatchObject({
      count: 5,
    });
    expect(parseCursorStatement('fetch c')).toMatchObject({
      name: 'c',
      count: 1,
    });
    expect(parseCursorStatement('close "SQL_CUR0x1"')).toEqual({
      kind: 'close',
      name: 'SQL_CUR0x1',
    });
    expect(parseCursorStatement('CLOSE ALL')).toEqual({
      kind: 'close',
      name: null,
    });
  });

  it('reads a DECLARE after comments, with its options in any order', () => {
    // Review: a DECLARE the old pattern missed went to PGlite, and its
    // FETCH answered 0 rows as if that were the result.
    expect(
      parseCursorStatement(
        '-- x\n/* y */ DECLARE c SCROLL BINARY CURSOR WITH HOLD FOR select 1',
      ),
    ).toEqual({
      kind: 'declare',
      name: 'c',
      hold: true,
      scroll: true,
      query: 'select 1',
    });
    expect(
      parseCursorStatement(
        'declare c no scroll insensitive cursor for select 1',
      ),
    ).toMatchObject({ scroll: false });
  });

  it('marks cursor statements it cannot serve, so they are refused, not guessed', () => {
    expect(parseCursorStatement('SELECT 1')).toBeNull();
    expect(parseCursorStatement('fetch backward 1 from c')).toEqual({
      kind: 'unsupported',
      verb: 'FETCH',
      name: 'c',
    });
    expect(parseCursorStatement('fetch absolute 3 from "C x"')).toEqual({
      kind: 'unsupported',
      verb: 'FETCH',
      name: 'C x',
    });
    expect(parseCursorStatement('move 1 in c')).toEqual({
      kind: 'unsupported',
      verb: 'MOVE',
      name: 'c',
    });
    expect(parseCursorStatement('declare c cursor')).toEqual({
      kind: 'unsupported',
      verb: 'DECLARE',
      name: 'c',
    });
  });
});
