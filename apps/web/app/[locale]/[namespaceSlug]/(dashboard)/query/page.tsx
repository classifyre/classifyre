"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "@/hooks/use-translation";
import { QueryExplorer } from "@/components/data-query/query-explorer";
import {
  QueryWorkbench,
  type QueryWorkbenchHandle,
} from "@/components/data-query/query-workbench";
import {
  fetchCatalog,
  fetchRecentRuns,
  fetchSavedQueries,
  starterSql,
  type QueryCatalog,
  type QueryRun,
  type SavedQueryDto,
} from "@/lib/data-query";

/**
 * SQL over the workspace's tables (docs/prd/DQ-data-query.md): an IDE page —
 * the editor fills the space, the explorer (sources, history, saved) sits
 * beside it. A query can join tables of different sources.
 */
function QueryPageContent() {
  const params = useSearchParams();
  const [catalog, setCatalog] = React.useState<QueryCatalog | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [history, setHistory] = React.useState<QueryRun[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(true);
  const [saved, setSaved] = React.useState<SavedQueryDto[]>([]);
  const [savedLoading, setSavedLoading] = React.useState(true);
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  const workbench = React.useRef<QueryWorkbenchHandle>(null);
  const seeded = React.useRef(false);
  const { t } = useTranslation();

  React.useEffect(() => {
    fetchCatalog()
      .then(setCatalog)
      .catch(() => setFailed(true));
  }, []);

  const reloadHistory = React.useCallback(() => {
    setHistoryLoading(true);
    fetchRecentRuns()
      .then(setHistory)
      .catch(() => undefined)
      .finally(() => setHistoryLoading(false));
  }, []);

  const reloadSaved = React.useCallback(() => {
    setSavedLoading(true);
    fetchSavedQueries()
      .then(setSaved)
      .catch(() => undefined)
      .finally(() => setSavedLoading(false));
  }, []);

  React.useEffect(() => {
    reloadHistory();
    reloadSaved();
  }, [reloadHistory, reloadSaved]);

  React.useEffect(() => {
    if (!catalog || seeded.current) return;
    seeded.current = true;
    workbench.current?.setSql(params.get("sql") ?? starterSql(catalog).sql);
  }, [catalog, params]);

  return (
    <div className="-mx-4 -mb-4 flex min-h-[calc(100vh-10rem)] min-w-0 flex-col">
      {failed && (
        <p className="px-3 pt-2 text-sm text-destructive">
          {t("dataQuery.catalogFailed")}
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 overflow-x-clip px-3 py-2">
          <QueryWorkbench
            ref={workbench}
            catalog={catalog}
            initialSql=""
            editorPath="query://workspace/main.sql"
            editorHeight={340}
            resultHeight={520}
            disabled={!catalog}
            onRunFinished={(run) => {
              setActiveRunId(run.id);
              setHistory((current) => {
                const rest = current.filter((r) => r.id !== run.id);
                return [run, ...rest].slice(0, 30);
              });
            }}
            onSaved={() => reloadSaved()}
          />
        </section>
        <section className="w-full min-w-0 shrink-0 overflow-x-clip px-2 py-2 xl:w-80 xl:border-l">
          <QueryExplorer
            catalog={catalog}
            history={history}
            historyLoading={historyLoading}
            saved={saved}
            savedLoading={savedLoading}
            activeRunId={activeRunId}
            onOpenRun={(run) => {
              setActiveRunId(run.id);
              QueryWorkbench.showRun?.(run);
            }}
            onOpenSaved={(item) => {
              setActiveRunId(null);
              workbench.current?.setSql(item.sql);
            }}
            onRunTable={(sqlName) => {
              setActiveRunId(null);
              workbench.current?.setSql(
                `SELECT *\nFROM ${sqlName}\nLIMIT 100`,
              );
            }}
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
