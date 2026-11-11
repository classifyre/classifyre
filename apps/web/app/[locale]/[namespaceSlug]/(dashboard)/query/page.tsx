"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "@/hooks/use-translation";
import {
  DataAccessTabs,
  GiveDataAccessDialog,
  useDataAccessGrants,
  type DataScope,
} from "@/components/data-query/data-access";
import { QueryExplorer } from "@/components/data-query/query-explorer";
import { useCan } from "@/hooks/use-me";
import { useTenant } from "@/hooks/use-tenant";
import {
  QueryWorkbench,
  type QueryWorkbenchHandle,
} from "@/components/data-query/query-workbench";
import {
  fetchCatalog,
  fetchRecentRuns,
  fetchSavedQueries,
  previewSql,
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
          <WorkspaceDataAccess />
        </section>
        <section className="w-full min-w-0 shrink-0 overflow-x-clip px-2 py-2 xl:w-80 xl:border-l">
          <QueryExplorer
            catalog={catalog}
            history={history}
            historyLoading={historyLoading}
            saved={saved}
            savedLoading={savedLoading}
            activeRunId={activeRunId}
            onInsert={(text) => workbench.current?.insert(text)}
            onOpenRun={(run) => {
              setActiveRunId(run.id);
              workbench.current?.showRun(run);
            }}
            onOpenSaved={(item) => {
              setActiveRunId(null);
              workbench.current?.setSql(item.sql);
            }}
            onRunTable={(sqlName) => {
              setActiveRunId(null);
              workbench.current?.setSql(previewSql(sqlName));
            }}
          />
        </section>
      </div>
    </div>
  );
}

const WORKSPACE: DataScope = { kind: "workspace" };

/**
 * Who can query this workspace's tables, and what was read: every Data
 * reader grant (on the workspace, a source or a table) and the trail of
 * reads, exports and access changes. Give access here opens every table.
 */
function WorkspaceDataAccess() {
  const access = useDataAccessGrants(WORKSPACE);
  const canManage = useCan("access.manage");
  return (
    <div className="mt-6 border-t pt-4">
      <DataAccessTabs
        scope={WORKSPACE}
        access={access}
        actions={
          canManage && <GiveDataAccessDialog scope={WORKSPACE} access={access} />
        }
      />
    </div>
  );
}

export default function QueryPage() {
  const { t } = useTranslation();
  // SQL is never the public's: visitors of a public workspace are asked to
  // sign in (the API refuses them every SQL route as well).
  if (useTenant()?.visitor) {
    return (
      <div
        className="mx-auto mt-10 max-w-lg rounded-md border border-dashed p-8 text-center"
        data-testid="query-sign-in"
      >
        <p className="font-medium">{t("dataQuery.signInTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("dataQuery.signInDescription")}
        </p>
      </div>
    );
  }
  return (
    <Suspense>
      <QueryPageContent />
    </Suspense>
  );
}
