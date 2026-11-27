import type { QueryCatalog } from "@/lib/data-query";
import {
  createQuerySchemaStore,
  sanitizeSpecAgainstCatalog,
} from "./query-schema-store";

const CATALOG: QueryCatalog = {
  canQueryAll: false,
  limits: { maxRows: 1000, timeoutSeconds: 60, exportMaxRows: 10000 },
  sources: [
    {
      id: "s-1",
      name: "Shop",
      type: "POSTGRESQL",
      sqlName: "shop",
      queryable: true,
      tables: [
        {
          assetId: "a-orders",
          sourceId: "s-1",
          name: "orders",
          schema: "public",
          table: "orders",
          sqlName: "shop.public.orders",
          queryable: true,
          canQuery: true,
          columns: [
            { name: "id", type: "BIGINT", isPrimaryKey: true },
            { name: "customer_id", type: "BIGINT" },
            { name: "amount", type: "NUMERIC" },
          ],
        },
        {
          assetId: "a-customers",
          sourceId: "s-1",
          name: "customers",
          schema: "public",
          table: "customers",
          sqlName: "shop.public.customers",
          queryable: true,
          canQuery: false,
          hiddenColumns: 1,
          columns: [
            { name: "id", type: "BIGINT", isPrimaryKey: true },
            { name: "email", type: "VARCHAR", access: "mask", mask: "redact" },
          ],
        },
      ],
    },
  ],
  relations: [],
};

describe("query-schema-store", () => {
  it("adds tables, joins them, generates DuckDB SQL live, and supports undo/redo", () => {
    const store = createQuerySchemaStore({ initialCatalog: CATALOG });
    const orders = CATALOG.sources[0]!.tables[0]!;
    const customers = CATALOG.sources[0]!.tables[1]!;

    const [t1, t2] = store.getState().addTables([orders, customers]);
    expect(store.getState().spec.tables).toHaveLength(2);
    expect(
      store.getState().diagnostics.some((d) => d.code === "disconnected_table"),
    ).toBe(true);

    store.getState().addJoin(
      { tableId: t1!.id, column: "customer_id" },
      { tableId: t2!.id, column: "id" },
      { type: "LEFT", cardinality: "N-1", origin: "fk" },
    );
    expect(store.getState().diagnostics).toHaveLength(0);
    expect(store.getState().sql).toContain("LEFT JOIN shop.public.customers");

    store.getState().undo();
    expect(store.getState().spec.joins).toHaveLength(0);

    store.getState().redo();
    expect(store.getState().spec.joins).toHaveLength(1);
    expect(store.getState().sql).toContain("LEFT JOIN shop.public.customers");
  });

  it("sanitizes stale specs against the caller's catalog so hidden columns and revoked tables are dropped", () => {
    const staleSpec = {
      tables: [
        {
          id: "t1",
          assetId: "a-orders",
          sqlName: "shop.public.orders",
          alias: "o",
          x: 0,
          y: 0,
          keep: ["id", "secret_hidden_col"],
          filters: [
            { column: "amount", op: ">" as const, value: 10 },
            { column: "secret_hidden_col", op: "=" as const, value: "x" },
          ],
        },
        {
          id: "t2",
          assetId: "a-revoked-table",
          sqlName: "secret.public.payroll",
          alias: "p",
          x: 300,
          y: 0,
          keep: ["salary"],
          filters: [],
        },
      ],
      joins: [
        {
          id: "j1",
          left: { tableId: "t1", column: "secret_hidden_col" },
          right: { tableId: "t2", column: "salary" },
          type: "INNER" as const,
        },
      ],
      pins: [],
    };

    const clean = sanitizeSpecAgainstCatalog(staleSpec, CATALOG);
    expect(clean.tables).toHaveLength(1);
    expect(clean.tables[0]!.keep).toEqual(["id"]);
    expect(clean.tables[0]!.filters).toEqual([
      { column: "amount", op: ">", value: 10 },
    ]);
    expect(clean.joins).toEqual([]);
    expect(JSON.stringify(clean)).not.toContain("secret_hidden_col");
    expect(JSON.stringify(clean)).not.toContain("payroll");
  });
});
