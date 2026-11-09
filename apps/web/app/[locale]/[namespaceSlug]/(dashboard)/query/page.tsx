"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Database, Info } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { CatalogPanel } from "@/components/data-query/catalog-panel";
import {
  QueryWorkbench,
  type QueryWorkbenchHandle,
} from "@/components/data-query/query-workbench";
import { fetchCatalog, type QueryCatalog } from "@/lib/data-query";

function firstQueryableSql(catalog: QueryCatalog | null): string {
  for (const source of catalog?.sources ?? []) {
    const table = source.tables.find((t) => t.canQuery);
    if (table) return `SELECT *\nFROM ${table.sqlName}\nLIMIT 100`;
  }
  return "SELECT 1";
}

/**
 * SQL over the workspace's tables (docs/prd/DQ-data-query.md): what you may
 * query on the left, an editor and its result on the right. A query can join
 * tables of different sources.
 */
function QueryPageContent() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const [catalog, setCatalog] = React.useState<QueryCatalog | null>(null);
  const [failed, setFailed] = React.useState(false);
  const workbench = React.useRef<QueryWorkbenchHandle>(null);
  const seeded = React.useRef(false);

  React.useEffect(() => {
    fetchCatalog()
      .then(setCatalog)
      .catch(() => setFailed(true));
  }, []);

  React.useEffect(() => {
    if (!catalog || seeded.current) return;
    seeded.current = true;
    workbench.current?.setSql(params.get("sql") ?? firstQueryableSql(catalog));
  }, [catalog, params]);

  const queryable = (catalog?.sources ?? []).reduce(
    (n, source) => n + source.tables.filter((t) => t.canQuery).length,
    0,
  );

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Database className="h-6 w-6" />
          {t("dataQuery.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("dataQuery.subtitle")}
        </p>
      </div>

      {catalog && !catalog.enabled && (
        <div className="flex items-start gap-2 rounded-md border border-dashed p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-medium">{t("dataQuery.disabledTitle")}</div>
            <div className="text-muted-foreground">
              {t("dataQuery.disabledBody")}
            </div>
          </div>
        </div>
      )}
      {catalog?.enabled && !catalog.canQueryAll && (
        <p className="text-xs text-muted-foreground">
          {t("dataQuery.partialAccess", { count: queryable })}
        </p>
      )}
      {failed && (
        <p className="text-sm text-destructive">
          {t("dataQuery.catalogFailed")}
        </p>
      )}

      <div className="grid min-h-0 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="rounded-md border p-3 lg:sticky lg:top-4 lg:h-[calc(100vh-12rem)]">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("dataQuery.catalogTitle")}
          </div>
          <CatalogPanel
            catalog={catalog}
            onInsert={(text) => workbench.current?.insert(text)}
          />
        </aside>
        <section className="min-w-0">
          <QueryWorkbench
            ref={workbench}
            catalog={catalog}
            initialSql=""
            editorPath="query://workspace/main.sql"
            editorHeight={240}
            resultHeight={520}
            disabled={!catalog?.enabled}
          />
        </section>
      </div>
    </div>
  );
}

export default function QueryPage() {
  return (
    <Suspense>
      <QueryPageContent />
    </Suspense>
  );
}
