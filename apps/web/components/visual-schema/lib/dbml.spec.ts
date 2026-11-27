import type { DataRequestSpec } from "@workspace/schemas/data-request";
import type { QueryCatalog } from "@/lib/data-query";
import { specToDbml } from "./dbml";

const CATALOG: QueryCatalog = {
  canQueryAll: true,
  limits: { maxRows: 1000, timeoutSeconds: 30, exportMaxRows: 10000 },
  sources: [
    {
      id: "src-1",
      name: "Shop",
      type: "POSTGRESQL",
      sqlName: "shop",
      queryable: true,
      tables: [
        {
          assetId: "a-orders",
          sourceId: "src-1",
          name: "orders",
          schema: "public",
          table: "orders",
          sqlName: "shop.public.orders",
          queryable: true,
          canQuery: true,
          columns: [
            { name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false },
            { name: "customer_id", type: "BIGINT", nullable: false },
            { name: "total", type: "NUMERIC", nullable: true },
          ],
          hiddenColumns: 1,
        },
        {
          assetId: "a-customers",
          sourceId: "src-1",
          name: "customers",
          schema: "public",
          table: "customers",
          sqlName: "shop.public.customers",
          queryable: true,
          canQuery: true,
          columns: [
            { name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false },
            {
              name: "email",
              type: "VARCHAR",
              nullable: false,
              access: "mask",
            },
          ],
        },
      ],
    },
  ],
  relations: [],
};

describe("specToDbml", () => {
  it("renders visible tables, PK/not-null attributes, and typed Ref cardinality", () => {
    const spec: DataRequestSpec = {
      tables: [
        {
          id: "o",
          assetId: "a-orders",
          sqlName: "shop.public.orders",
          alias: "o",
          x: 0,
          y: 0,
          keep: ["id", "customer_id", "secret_token"],
          filters: [],
        },
        {
          id: "c",
          assetId: "a-customers",
          sqlName: "shop.public.customers",
          alias: "c",
          x: 300,
          y: 0,
          keep: ["id", "email"],
          filters: [],
        },
      ],
      joins: [
        {
          id: "j-1",
          left: { tableId: "o", column: "customer_id" },
          right: { tableId: "c", column: "id" },
          type: "INNER",
          cardinality: "N-1",
          constraintName: "fk_orders_customer",
          origin: "fk",
        },
        // Stale/tampered join referencing a hidden column must be omitted fail-closed
        {
          id: "j-secret",
          left: { tableId: "o", column: "secret_token" },
          right: { tableId: "c", column: "id" },
          type: "INNER",
          cardinality: "N-1",
          constraintName: "fk_secret_leak",
          origin: "manual",
        },
      ],
      pins: [],
    };

    const dbml = specToDbml(spec, CATALOG);
    expect(dbml).toContain("Table public.orders as o {");
    expect(dbml).toContain("id BIGINT [pk, not null]");
    expect(dbml).toContain("customer_id BIGINT [not null]");
    expect(dbml).toContain("total NUMERIC\n");
    expect(dbml).toContain(
      "Ref fk_orders_customer: public.orders.customer_id > public.customers.id",
    );
    // Hidden column and join touching it must NEVER appear in DBML
    expect(dbml).not.toContain("secret_token");
    expect(dbml).not.toContain("fk_secret_leak");
  });

  it("omits hidden tables and any join referencing them", () => {
    const spec: DataRequestSpec = {
      tables: [
        {
          id: "o",
          assetId: "a-orders",
          sqlName: "shop.public.orders",
          alias: "o",
          x: 0,
          y: 0,
          keep: ["id"],
          filters: [],
        },
        {
          id: "c",
          assetId: "a-customers",
          sqlName: "shop.public.customers",
          alias: "c",
          x: 300,
          y: 0,
          keep: ["id"],
          filters: [],
          hidden: true,
        },
      ],
      joins: [
        {
          id: "j-1",
          left: { tableId: "o", column: "customer_id" },
          right: { tableId: "c", column: "id" },
          type: "INNER",
        },
      ],
      pins: [],
    };

    const dbml = specToDbml(spec, CATALOG);
    expect(dbml).toContain("Table public.orders as o");
    expect(dbml).not.toContain("public.customers");
    expect(dbml).not.toContain("Ref");
  });
});
