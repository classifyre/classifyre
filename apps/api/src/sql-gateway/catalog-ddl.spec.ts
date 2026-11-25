import { catalogDdl, computeCatalogHash } from './catalog-ddl';
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

const source = (
  tables: ReturnType<typeof table>[],
  over: Partial<CatalogSource> = {},
): CatalogSource => ({
  id: 's1',
  name: 'Shop',
  type: 'POSTGRESQL',
  sqlName: 'shop',
  queryable: true,
  tables,
  ...over,
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

  it('produces canonical DDL independent of input order and hashes opaquely per workspace', () => {
    const a = source(
      [
        table({ assetId: 'a2', table: 'zeta', sqlName: 'alpha.public.zeta' }),
        table({ assetId: 'a1', table: 'beta', sqlName: 'alpha.public.beta' }),
      ],
      { id: 's1', name: 'Alpha', sqlName: 'alpha' },
    );
    const b = source(
      [
        table({
          assetId: 'a3',
          table: 'items',
          sqlName: 'billing.public.items',
        }),
      ],
      { id: 's2', name: 'Billing', sqlName: 'billing' },
    );

    const ddl1 = catalogDdl([a, b]);
    const ddl2 = catalogDdl([b, { ...a, tables: [...a.tables].reverse() }]);
    expect(ddl1.sql).toBe(ddl2.sql);

    const h1 = computeCatalogHash('ws-acme', ddl1.sql);
    const h2 = computeCatalogHash('ws-acme', ddl2.sql);
    const hOtherWs = computeCatalogHash('ws-other', ddl1.sql);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{24}$/);
    expect(h1).not.toBe(hOtherWs);
    expect(h1).not.toContain('acme');
  });
});
