"use client";

import * as React from "react";
import { NamespaceProvider } from "@/components/namespace-provider";
import { QuerySchemaTab } from "@/components/data-query/query-schema-tab";
import type {
  QueryCatalog,
  QueryCatalogSource,
  QueryCatalogTable,
} from "@/lib/data-query";

const CATALOG: QueryCatalog = {
  canQueryAll: false,
  limits: { maxRows: 1000, timeoutSeconds: 60, exportMaxRows: 10000 },
  sources: [
    {
      id: "s-pg",
      name: "Shop Postgres",
      type: "POSTGRESQL",
      sqlName: "shop",
      queryable: true,
      tables: [
        {
          assetId: "a-orders",
          sourceId: "s-pg",
          name: "orders",
          schema: "public",
          table: "orders",
          sqlName: "shop.public.orders",
          queryable: true,
          canQuery: true,
          rowCount: 2500,
          hiddenColumns: 1,
          columns: [
            { name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false },
            { name: "customer_id", type: "BIGINT", nullable: false },
            { name: "total", type: "NUMERIC", nullable: true },
          ],
        },
      ],
    },
    {
      id: "s-lake",
      name: "CRM Lake",
      type: "S3",
      sqlName: "crm",
      queryable: true,
      tables: [
        {
          assetId: "a-customers",
          sourceId: "s-lake",
          name: "customers",
          schema: "public",
          table: "customers",
          sqlName: "crm.public.customers",
          queryable: true,
          canQuery: false,
          columns: [
            { name: "id", type: "BIGINT", isPrimaryKey: true, nullable: false },
            {
              name: "email",
              type: "VARCHAR",
              access: "mask",
              mask: "redact",
            },
          ],
        },
      ],
    },
  ],
  relations: [
    {
      fromAssetId: "a-orders",
      fromColumn: "customer_id",
      toAssetId: "a-customers",
      toColumn: "id",
      constraintName: "fk_orders_customer",
      cardinality: "N-1",
    },
  ],
};

export function QuerySchemaHarness() {
  const [openedSql, setOpenedSql] = React.useState("");
  const [openedTable, setOpenedTable] = React.useState("");

  return (
    <NamespaceProvider slug="demo">
      <div
        className="h-[720px] w-[1280px]"
        style={{ width: 1280, height: 720, position: "relative" }}
      >
        <QuerySchemaTab
          catalog={CATALOG}
          scopeKey="ct-workspace"
          onOpenInSql={(sql) => setOpenedSql(sql)}
          onOpenTable={(tbl: QueryCatalogTable, _src: QueryCatalogSource) =>
            setOpenedTable(tbl.sqlName)
          }
        />
        <output data-testid="harness-opened-sql" className="sr-only">
          {openedSql}
        </output>
        <output data-testid="harness-opened-table" className="sr-only">
          {openedTable}
        </output>
      </div>
    </NamespaceProvider>
  );
}
