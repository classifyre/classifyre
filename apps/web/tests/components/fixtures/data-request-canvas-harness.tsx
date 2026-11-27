"use client";

import * as React from "react";
import type {
  DataRequestCheckResultDto,
  DataRequestDescribeResultDto,
  DataRequestDetailDto,
  QueryCatalogDto,
} from "@workspace/api-client";
import { NamespaceProvider } from "@/components/namespace-provider";
import { createRequestStore } from "@/components/data-request/store/request-store";
import { DataRequestWorkspaceView } from "@/components/data-request/data-request-workspace";

export const SAMPLE_REQUEST_CATALOG: QueryCatalogDto = {
  limits: { maxRows: 1000, timeoutSeconds: 60, exportMaxRows: 10000 },
  sources: [
    {
      id: "src-shop",
      name: "Shop Postgres",
      type: "POSTGRESQL",
      sqlName: "shop",
      tables: [
        {
          assetId: "asset-orders",
          sourceId: "src-shop",
          name: "orders",
          schema: "public",
          table: "orders",
          sqlName: "shop.public.orders",
          queryable: true,
          canQuery: true,
          columns: [
            { name: "id", type: "integer" },
            { name: "customer_id", type: "integer" },
            { name: "amount", type: "numeric" },
          ],
        },
      ],
    },
    {
      id: "src-crm",
      name: "CRM Warehouse",
      type: "POSTGRESQL",
      sqlName: "crm",
      tables: [
        {
          assetId: "asset-customers",
          sourceId: "src-crm",
          name: "customers",
          schema: "public",
          table: "customers",
          sqlName: "crm.public.customers",
          queryable: true,
          canQuery: false,
          columns: [
            { name: "id", type: "integer" },
            { name: "region", type: "varchar" },
            {
              name: "email",
              type: "varchar",
              access: "mask",
              mask: "redact",
              inClear: false,
            },
          ],
        },
      ],
    },
  ],
} as unknown as QueryCatalogDto;

function buildDetail(role: "requester" | "team"): DataRequestDetailDto {
  const isTeam = role === "team";
  return {
    id: "case-dr-1",
    kind: "DATA_REQUEST",
    title: "Q3 revenue by region",
    description: "Join orders and customers by region",
    status: "OPEN",
    priority: "HIGH",
    state: isTeam ? "SUBMITTED" : "DRAFT",
    requester: { ref: "user:alice", name: "Alice" },
    routeGroup: { id: "g-fin", name: "Finance data" },
    audienceGroup: { id: "g-sales", name: "Sales" },
    assignee: null,
    datasetAssetId: null,
    datasetName: null,
    deliveredVersion: null,
    declineReason: null,
    submittedAt: null,
    deliveredAt: null,
    closedAt: null,
    createdAt: new Date("2026-11-24T10:00:00Z"),
    updatedAt: new Date("2026-11-24T10:00:00Z"),
    spec: { tables: [], joins: [], pins: [], groups: [] },
    specVersion: 1,
    draftSql: "",
    sqlEdited: false,
    lastCheck: null,
    lastCheckSqlHash: null,
    dataset: null,
    deliveries: [],
    threads: [],
    permissions: {
      isRequester: !isTeam,
      isTeam,
      isManager: false,
      canEditSpec: true,
      canEditSql: isTeam,
      canPreview: isTeam,
      canSelfServe: false,
      allowedActions: isTeam ? ["claim", "deliver", "decline"] : ["submit", "withdraw"],
    },
  } as DataRequestDetailDto;
}

export function DataRequestCanvasHarness({
  role = "requester",
}: {
  role?: "requester" | "team";
}) {
  const store = React.useMemo(() => {
    const initial = buildDetail(role);
    const s = createRequestStore(initial.id, {
      saveSpec: async (_id, payload) => ({
        ...initial,
        spec: payload.spec as unknown as Record<string, unknown>,
        specVersion: payload.baseVersion + 1,
        draftSql: s.getState().draftSql,
      }),
      saveSql: async (_id, payload) => ({
        ...initial,
        specVersion: payload.baseVersion + 1,
        draftSql: payload.sql ?? "",
        sqlEdited: !payload.regenerate,
      }),
      check: async () =>
        ({
          ok: true,
          sql: s.getState().draftSql,
          routeGroup: initial.routeGroup,
          precheckError: null,
          diagnostics: [],
          tables: [],
          problems: [],
        }) as unknown as DataRequestCheckResultDto,
      describe: async () =>
        ({
          cached: false,
          sqlHash: "hash",
          describe: null,
          error: null,
          check: {
            ok: true,
            sql: s.getState().draftSql,
            routeGroup: initial.routeGroup,
            precheckError: null,
            diagnostics: [],
            tables: [],
            problems: [],
          },
        }) as unknown as DataRequestDescribeResultDto,
      reload: async () => initial,
      saveDebounceMs: 50,
      checkDebounceMs: 50,
    });
    s.getState().hydrate(initial, SAMPLE_REQUEST_CATALOG);
    return s;
  }, [role]);

  React.useEffect(() => {
    return () => store.getState().dispose();
  }, [store]);

  return (
    <NamespaceProvider slug="demo">
      <div
        className="h-[720px] w-[1280px]"
        style={{ position: "relative", width: 1280, height: 720 }}
      >
        <DataRequestWorkspaceView
          store={store}
          catalog={SAMPLE_REQUEST_CATALOG}
        />
        {/* Helper button exposed for deterministic join wiring in CT */}
        <button
          type="button"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            zIndex: 50,
            opacity: 0.01,
          }}
          data-testid="harness-join-orders-customers"
          onClick={() => {
            const tables = store.getState().spec.tables;
            const o = tables.find((t) => t.sqlName === "shop.public.orders");
            const c = tables.find((t) => t.sqlName === "crm.public.customers");
            if (o && c) {
              store
                .getState()
                .addJoin(
                  { tableId: o.id, column: "customer_id" },
                  { tableId: c.id, column: "id" },
                  "INNER",
                );
            }
          }}
        >
          Join orders and customers
        </button>
      </div>
    </NamespaceProvider>
  );
}
