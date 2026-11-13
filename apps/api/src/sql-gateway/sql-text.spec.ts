import { firstKeyword, splitStatements, substituteParams } from './sql-text';
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
