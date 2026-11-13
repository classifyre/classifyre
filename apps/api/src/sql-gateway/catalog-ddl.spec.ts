import { catalogDdl } from './catalog-ddl';
import type { CatalogSource } from '../data-query/query-catalog.service';

const table = (over: Record<string, unknown> = {}) => ({
  assetId: 'a1',
  sourceId: 's1',
  name: 'orders',
  schema: 'public',
  table: 'orders',
  sqlName: 'shop.public.orders',
  columns: [
    { name: 'id', type: 'BIGINT' },
    { name: 'ID', type: 'INTEGER' },
    { name: 'note', type: '' },
  ],
  queryable: true,
  canQuery: true,
  location: null,
  ...over,
});

const source = (tables: ReturnType<typeof table>[]): CatalogSource => ({
  id: 's1',
  name: 'Shop',
  type: 'POSTGRESQL',
  sqlName: 'shop',
  queryable: true,
  tables,
});

describe('catalogDdl', () => {
  it('makes one schema per source schema and one table per readable table', () => {
    const ddl = catalogDdl([
      source([
        table(),
        table({ assetId: 'a2', table: 'secret', canQuery: false }),
      ]),
    ]);
    expect([...ddl.dataSchemas]).toEqual(['shop.public']);
    expect(ddl.tables).toBe(1);
    expect(ddl.sql).toContain('CREATE SCHEMA "shop.public";');
    expect(ddl.sql).toContain(
      'CREATE TABLE "shop.public"."orders" ("id" bigint, "note" text);',
    );
    expect(ddl.sql).not.toContain('secret');
  });

  it('quotes names and comments, and puts governance notes on them', () => {
    const ddl = catalogDdl([source([table({ name: "O'Neil" })])], {
      tables: new Map([['a1', 'One row per order.']]),
      columns: new Map([
        [
          'a1',
          new Map([
            ['id', { businessName: 'Order number', description: null }],
          ]),
        ],
      ]),
    });
    expect(ddl.sql).toContain(
      `COMMENT ON TABLE "shop.public"."orders" IS 'O''Neil — One row per order.';`,
    );
    expect(ddl.sql).toContain(
      `COMMENT ON COLUMN "shop.public"."orders"."id" IS 'Order number';`,
    );
  });

  it('leaves out names PostgreSQL cannot hold', () => {
    const ddl = catalogDdl([source([table({ schema: 'x'.repeat(70) })])]);
    expect(ddl.tables).toBe(0);
    expect(ddl.skipped).toEqual(['shop.public.orders']);
  });

  it('runs the session as a read-only role named after the connection', () => {
    const ddl = catalogDdl([source([table()])], undefined, 'ana_bi');
    expect(ddl.sql).toContain('CREATE ROLE "ana_bi" LOGIN;');
    expect(ddl.sql).toContain(
      'GRANT SELECT ON ALL TABLES IN SCHEMA "shop.public" TO "ana_bi";',
    );
    expect(ddl.sql.trim().endsWith('SET SESSION AUTHORIZATION "ana_bi";')).toBe(
      true,
    );
  });
});
