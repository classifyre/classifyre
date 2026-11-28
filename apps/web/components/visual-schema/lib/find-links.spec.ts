import type {
  DataRequestJoin,
  DataRequestTable,
} from "@workspace/schemas/data-request";
import type { QueryCatalog } from "@/lib/data-query";
import { findLinks } from "./find-links";

function makeTable(
  id: string,
  assetId: string,
  sqlName: string,
  alias: string,
): DataRequestTable {
  return {
    id,
    assetId,
    sqlName,
    alias,
    x: 0,
    y: 0,
    keep: ["id"],
    filters: [],
  };
}

const CATALOG: QueryCatalog = {
  canQueryAll: true,
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
          assetId: "a-customers",
          sourceId: "s-1",
          name: "customers",
          schema: "public",
          table: "customers",
          sqlName: "shop.public.customers",
          queryable: true,
          canQuery: true,
          columns: [
            { name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false },
            { name: "email", type: "VARCHAR", access: "mask", mask: "redact" },
          ],
        },
        {
          assetId: "a-orders",
          sourceId: "s-1",
          name: "orders",
          schema: "public",
          table: "orders",
          sqlName: "shop.public.orders",
          queryable: true,
          canQuery: true,
          hiddenColumns: 1,
          columns: [
            { name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false },
            { name: "customer_id", type: "BIGINT", nullable: false },
            { name: "product_id", type: "BIGINT", nullable: false },
            { name: "account_ref", type: "BIGINT", nullable: true },
          ],
        },
        {
          assetId: "a-products",
          sourceId: "s-1",
          name: "products",
          schema: "public",
          table: "products",
          sqlName: "shop.public.products",
          queryable: true,
          canQuery: true,
          columns: [
            { name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false },
            { name: "sku", type: "VARCHAR", nullable: false },
          ],
        },
        {
          assetId: "a-accounts",
          sourceId: "s-1",
          name: "accounts",
          schema: "public",
          table: "accounts",
          sqlName: "shop.public.accounts",
          queryable: true,
          canQuery: true,
          columns: [
            { name: "account_ref", type: "BIGINT", isPrimaryKey: true, nullable: false },
          ],
        },
      ],
    },
  ],
  relations: [
    // Tier 1: exact column-level catalog FK
    {
      fromAssetId: "a-orders",
      fromColumn: "customer_id",
      toAssetId: "a-customers",
      toColumn: "id",
      constraintName: "fk_orders_customer",
      cardinality: "N-1",
    },
    // Tier 2: table-level catalog FK (no column names)
    {
      fromAssetId: "a-orders",
      toAssetId: "a-accounts",
      cardinality: "N-1",
    },
    // Governance safety: references a column not present in visible columns (hidden)
    {
      fromAssetId: "a-orders",
      fromColumn: "hidden_secret_id",
      toAssetId: "a-customers",
      toColumn: "id",
      constraintName: "fk_orders_hidden",
      cardinality: "N-1",
    },
  ],
};

describe("findLinks", () => {
  const tCustomers = makeTable("t1", "a-customers", "shop.public.customers", "c");
  const tOrders = makeTable("t2", "a-orders", "shop.public.orders", "o");
  const tProducts = makeTable("t3", "a-products", "shop.public.products", "p");
  const tAccounts = makeTable("t4", "a-accounts", "shop.public.accounts", "a");

  it("discovers Tier 1 exact FK, Tier 2 table-level FK, and Tier 3 naming heuristics while skipping hidden columns", () => {
    const links = findLinks(
      [tCustomers, tOrders, tProducts, tAccounts],
      [],
      CATALOG,
    );

    expect(links).toEqual(
      expect.arrayContaining([
        // Tier 1 exact FK
        {
          left: { tableId: "t2", column: "customer_id" },
          right: { tableId: "t1", column: "id" },
          cardinality: "N-1",
          origin: "fk",
          constraintName: "fk_orders_customer",
        },
        // Tier 2 table-level FK resolved to account_ref -> account_ref
        {
          left: { tableId: "t2", column: "account_ref" },
          right: { tableId: "t4", column: "account_ref" },
          cardinality: "N-1",
          origin: "fk",
        },
        // Tier 3 heuristic product_id -> products.id
        {
          left: { tableId: "t2", column: "product_id" },
          right: { tableId: "t3", column: "id" },
          cardinality: "N-1",
          origin: "inferred",
        },
      ]),
    );
    expect(links).toHaveLength(3);
    expect(JSON.stringify(links)).not.toContain("hidden_secret_id");
  });

  it("avoids duplicating existing joins in either direction and skips self-joins", () => {
    const existing: DataRequestJoin[] = [
      {
        id: "j1",
        left: { tableId: "t1", column: "id" },
        right: { tableId: "t2", column: "customer_id" },
        type: "INNER",
      },
    ];
    const links = findLinks([tCustomers, tOrders], existing, CATALOG);
    expect(links).toEqual([]);

    // Same single table never self-joins
    expect(findLinks([tOrders], [], CATALOG)).toEqual([]);
  });

  it("respects scopeTableIds when finding links for a subset of tables", () => {
    const links = findLinks(
      [tCustomers, tOrders, tProducts],
      [],
      CATALOG,
      new Set(["t3"]),
    );
    expect(links).toEqual([
      {
        left: { tableId: "t2", column: "product_id" },
        right: { tableId: "t3", column: "id" },
        cardinality: "N-1",
        origin: "inferred",
      },
    ]);
  });
});
