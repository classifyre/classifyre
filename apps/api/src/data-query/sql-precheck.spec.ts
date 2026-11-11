import {
  codeOnly,
  extractThreePartNames,
  precheckSql,
  stripLiteralsAndComments,
} from './sql-precheck';

const allowed = new Set(['shop.public.orders', 'lake.tables.events']);
const sources = new Set(['shop', 'lake', 'other']);
const check = (sql: string) => precheckSql(sql, allowed, sources)?.code ?? null;

describe('SQL pre-check (before a job is started)', () => {
  it.each([
    ['SELECT * FROM shop.public.orders', null],
    ['  with x as (select * from shop.public.orders) select * from x', null],
    ['FROM lake.tables.events LIMIT 5', null],
    ["SELECT o.id FROM shop.public.orders o WHERE o.note = 'a; b'", null],
    ['SELECT 1;', null],
    ["SELECT 'read_csv(1)' AS s, x.y.z FROM shop.public.orders", null],
    ['SELECT * FROM "shop"."public"."orders"', null],
    ['SELECT * FROM shop.public.orders -- DROP TABLE x;', null],
    // Leaves what it cannot be sure about to the gate in the job.
    ['SELECT * FROM unknown.schema.thing', null],
  ])('lets %s through', (sql, code) => {
    expect(check(sql)).toBe(code);
  });

  it.each([
    ['', 'invalid_sql'],
    ['-- only a comment', 'invalid_sql'],
    ['SELECT 1; SELECT 2', 'select_only'],
    ['DELETE FROM shop.public.orders', 'select_only'],
    ["ATTACH 'x' AS y", 'select_only'],
    ["SELECT * FROM read_csv('/etc/passwd')", 'function_not_allowed'],
    ["SELECT getenv('HOME')", 'function_not_allowed'],
    ["SELECT * FROM 's3://bucket/a.parquet'", 'function_not_allowed'],
    ['SELECT * FROM shop.public.secrets', 'table_not_available'],
    ['SELECT * FROM "shop"."public"."secrets"', 'table_not_available'],
    [
      'SELECT * FROM lake.tables.events JOIN other.x.y ON 1=1',
      'table_not_available',
    ],
  ])('refuses %s', (sql, code) => {
    expect(check(sql)).toBe(code);
  });

  it('blanks strings and comments but keeps their length', () => {
    const sql = "SELECT 'a;b' -- c;\nFROM t /* d; */";
    const code = codeOnly(sql);
    expect(code).toHaveLength(sql.length);
    expect(code).not.toContain(';');
  });

  it('exposes the executable code under its new name', () => {
    expect(stripLiteralsAndComments("SELECT 'x' -- y")).toBe(
      codeOnly("SELECT 'x' -- y"),
    );
  });

  it('finds only the tables named in code', () => {
    const names = extractThreePartNames(
      stripLiteralsAndComments(
        "SELECT * FROM shop.public.orders WHERE note = 'lake.tables.events' -- other.x.y",
      ).toLowerCase(),
    );
    expect(names).toEqual(['shop.public.orders']);
  });
});
