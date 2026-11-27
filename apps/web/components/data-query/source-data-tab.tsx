"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Network, TerminalSquare } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { useTranslation } from "@/hooks/use-translation";
import {
  catalogOfSource,
  previewSql,
  type QueryCatalog,
} from "@/lib/data-query";
import { DataNotice, DataTab } from "./data-tab";
import { RequestAccess } from "@/components/access-requests/request-access";

const QuerySchemaTab = dynamic(
  () => import("./query-schema-tab").then((m) => m.QuerySchemaTab),
  { ssr: false },
);

/**
 * A source's tables, queried in place: the same layout as a table's Data
 * tab, with this source's tables beside the editor to pick from, plus a
 * Visual Schema ER & query builder toggle. Access given here opens every
 * table of the source; Activity shows reads of any of them and access given
 * on the source or one of its tables.
 */
export function SourceDataTab({
  catalog,
  sourceId,
  sourceName,
}: {
  catalog: QueryCatalog;
  sourceId: string;
  sourceName: string;
}) {
  const { t } = useTranslation();
  const [view, setView] = React.useState<"sql" | "schema">("sql");
  const [seedSql, setSeedSql] = React.useState<string | null>(null);
  // Only this source, for the explorer and the editor's completions alike.
  const own = React.useMemo(
    () => catalogOfSource(catalog, sourceId),
    [catalog, sourceId],
  );
  const source = own.sources[0];
  const queryable = (source?.tables ?? []).filter((table) => table.canQuery);

  if (!source || !source.tables.some((table) => table.queryable)) {
    return (
      <DataNotice title={t("dataQuery.notQueryable")}>
        {source?.tables[0]?.reason ?? t("dataQuery.noTables")}
      </DataNotice>
    );
  }

  const viewToggle = (
    <div
      className="inline-flex items-center rounded-xs border border-border bg-card p-0.5"
      role="tablist"
      data-testid="source-data-view-toggle"
    >
      <Button
        type="button"
        size="sm"
        variant={view === "sql" ? "default" : "ghost"}
        className="h-7 gap-1.5 rounded-xs px-2.5 text-xs"
        onClick={() => setView("sql")}
        data-testid="source-data-view-sql"
      >
        <TerminalSquare className="h-3.5 w-3.5" />
        {t("dataQuery.schema.viewSql")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={view === "schema" ? "default" : "ghost"}
        className="h-7 gap-1.5 rounded-xs px-2.5 text-xs"
        onClick={() => setView("schema")}
        data-testid="source-data-view-schema"
      >
        <Network className="h-3.5 w-3.5" />
        {t("dataQuery.objectView.subtabs.visualSchema")}
      </Button>
    </div>
  );

  if (view === "schema") {
    return (
      <div className="space-y-3" data-testid="source-data-tab">
        <div className="flex items-center justify-between gap-2">
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {source.sqlName}
          </code>
          {viewToggle}
        </div>
        <div className="h-[680px] overflow-hidden rounded-xs border border-border">
          <QuerySchemaTab
            catalog={own}
            scopeKey={`source:${sourceId}`}
            autoPopulateSourceId={sourceId}
            onOpenInSql={
              queryable.length > 0
                ? (sql) => {
                    setSeedSql(sql);
                    setView("sql");
                  }
                : undefined
            }
          />
        </div>
      </div>
    );
  }

  if (!queryable.length) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-end">{viewToggle}</div>
        <DataNotice title={t("dataQuery.assetLockedTitle")} locked>
          {t("dataQuery.sourceLocked", { name: sourceName })}
        </DataNotice>
        <RequestAccess target={{ scopeType: "source", scopeId: sourceId }} />
      </div>
    );
  }
  return (
    <DataTab
      key={seedSql ?? "default"}
      testId="source-data-tab"
      scope={{ kind: "source", sourceId, name: sourceName }}
      catalog={own}
      sqlName={source.sqlName}
      summary={t("dataQuery.sourceTables", {
        count: queryable.length,
        total: source.tables.length,
      })}
      initialSql={seedSql ?? previewSql(queryable[0]!.sqlName)}
      editorPath={`query://source/${sourceId}.sql`}
      explorer
      actions={viewToggle}
    />
  );
}
