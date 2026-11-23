"use client";

import * as React from "react";
import { Table2, TerminalSquare } from "lucide-react";
import { NamespaceProvider } from "@/components/namespace-provider";
import {
  NamespaceTabs,
  type NamespaceTabItem,
} from "@workspace/ui/components/namespace-tabs";
import { SourceIcon } from "@workspace/ui/components/source-icon";
import { QueryExplorer } from "@/components/data-query/query-explorer";
import { QuerySourceTab } from "@/components/data-query/query-source-tab";
import { QueryAssetTab } from "@/components/data-query/query-asset-tab";
import type {
  QueryCatalog,
  QueryCatalogSource,
  QueryCatalogTable,
} from "@/lib/data-query";

export const SAMPLE_CATALOG: QueryCatalog = {
  canQueryAll: true,
  limits: {
    maxRows: 10000,
    timeoutSeconds: 60,
    exportMaxRows: 100000,
  },
  sources: [
    {
      id: "src-pg",
      name: "Shop Postgres",
      type: "POSTGRESQL",
      sqlName: "shop_pg",
      queryable: true,
      tables: [
        {
          assetId: "asset-orders",
          sourceId: "src-pg",
          name: "orders",
          schema: "public",
          table: "orders",
          sqlName: "shop_pg.public.orders",
          columns: [
            { name: "order_id", type: "INTEGER" },
            { name: "amount", type: "DOUBLE" },
          ],
          queryable: true,
          canQuery: true,
        },
        {
          assetId: "asset-customers",
          sourceId: "src-pg",
          name: "customers",
          schema: "analytics",
          table: "customers",
          sqlName: "shop_pg.analytics.customers",
          columns: [{ name: "customer_id", type: "INTEGER" }],
          queryable: true,
          canQuery: true,
        },
      ],
    },
    {
      id: "src-s3",
      name: "Bucket Files",
      type: "S3",
      sqlName: "bucket_files",
      queryable: true,
      tables: [
        {
          assetId: "asset-events",
          sourceId: "src-s3",
          name: "events.parquet",
          schema: "default",
          table: "events",
          sqlName: "bucket_files.default.events",
          columns: [{ name: "event_id", type: "VARCHAR" }],
          queryable: true,
          canQuery: true,
        },
      ],
    },
  ],
};

type OpenTab =
  | { kind: "source"; id: string; source: QueryCatalogSource }
  | {
      kind: "asset";
      id: string;
      table: QueryCatalogTable;
      source: QueryCatalogSource;
    };

function QueryGuiInner() {
  const [openTabs, setOpenTabs] = React.useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = React.useState("query");
  const [mainSql, setMainSql] = React.useState("SELECT 1");

  const openSource = (source: QueryCatalogSource) => {
    const id = `source:${source.id}`;
    setOpenTabs((cur) =>
      cur.some((t) => t.id === id) ? cur : [...cur, { kind: "source", id, source }],
    );
    setActiveTabId(id);
  };

  const openAsset = (table: QueryCatalogTable, source: QueryCatalogSource) => {
    const id = `asset:${table.assetId}`;
    setOpenTabs((cur) =>
      cur.some((t) => t.id === id)
        ? cur
        : [...cur, { kind: "asset", id, table, source }],
    );
    setActiveTabId(id);
  };

  const closeTab = (id: string) => {
    if (id === "query") return;
    setOpenTabs((cur) => {
      const idx = cur.findIndex((t) => t.id === id);
      const next = cur.filter((t) => t.id !== id);
      if (activeTabId === id) {
        setActiveTabId(next[idx]?.id ?? next[idx - 1]?.id ?? "query");
      }
      return next;
    });
  };

  const editInQuery = (sql: string) => {
    setMainSql(sql);
    setActiveTabId("query");
  };

  const tabItems: NamespaceTabItem[] = [
    {
      id: "query",
      label: "SQL Query",
      icon: <TerminalSquare className="size-3.5" />,
      closable: false,
    },
    ...openTabs.map<NamespaceTabItem>((tab) =>
      tab.kind === "source"
        ? {
            id: tab.id,
            label: tab.source.name,
            icon: <SourceIcon source={tab.source.type} size="sm" />,
          }
        : {
            id: tab.id,
            label: tab.table.table,
            icon: <Table2 className="size-3.5" />,
          },
    ),
  ];

  return (
    <div className="grid h-[680px] grid-cols-[minmax(0,1fr)_20rem] overflow-hidden border">
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="shrink-0 border-b bg-muted/35 px-2">
          <NamespaceTabs
            items={tabItems}
            activeId={activeTabId}
            ariaLabel="Query workspace tabs"
            closeLabel={(item) => `Close ${item.label}`}
            onActivate={setActiveTabId}
            onClose={closeTab}
            data-testid="query-workbench-tabs"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <div
            className={activeTabId === "query" ? "p-3" : "hidden"}
            data-testid="main-query-pane"
          >
            <pre data-testid="main-query-sql">{mainSql}</pre>
          </div>
          {openTabs.map((tab) => (
            <div
              key={tab.id}
              className={
                activeTabId === tab.id ? "h-full overflow-hidden" : "hidden"
              }
            >
              {tab.kind === "source" ? (
                <QuerySourceTab
                  source={tab.source}
                  onOpenTable={openAsset}
                  onEditInQuery={editInQuery}
                />
              ) : (
                <QueryAssetTab
                  table={tab.table}
                  source={tab.source}
                  onEditInQuery={editInQuery}
                  onOpenSource={openSource}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex h-full min-h-0 flex-col overflow-hidden border-l p-2">
        <QueryExplorer
          catalog={SAMPLE_CATALOG}
          onInsert={(text) => setMainSql((prev) => `${prev} ${text}`)}
          onRunTable={(name) => editInQuery(`SELECT *\nFROM ${name}\nLIMIT 200`)}
          onOpenSource={openSource}
          onOpenTable={openAsset}
          activeSourceId={
            activeTabId.startsWith("source:")
              ? activeTabId.slice("source:".length)
              : null
          }
          activeAssetId={
            activeTabId.startsWith("asset:")
              ? activeTabId.slice("asset:".length)
              : null
          }
        />
      </div>
    </div>
  );
}

export function QueryGuiHarness() {
  return (
    <NamespaceProvider slug="shop">
      <QueryGuiInner />
    </NamespaceProvider>
  );
}
