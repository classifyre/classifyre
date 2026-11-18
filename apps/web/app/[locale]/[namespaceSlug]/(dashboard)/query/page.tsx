"use client";

import { ConnectToolButton } from "@/components/sql-connections/connect-tool-button";
import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "@/hooks/use-translation";
import { QueryExplorer } from "@/components/data-query/query-explorer";
import { Lock, TerminalSquare } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { useTenant } from "@/hooks/use-tenant";
import {
  QueryWorkbench,
  type QueryWorkbenchHandle,
} from "@/components/data-query/query-workbench";
import { useNsPath } from "@/lib/ns-path";
import { ShareDatasetSheet } from "@/components/shared-datasets/share-dataset-sheet";
import {
  useSharedDataset,
  useSharedDatasetOptions,
} from "@/lib/shared-datasets";
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
  const router = useRouter();
  const nsPath = useNsPath();
  // DQ §5.12: `?dataset=<id>` edits a shared dataset's SQL (a new version).
  const editing = useSharedDataset(params.get("dataset"));
  const shareOptions = useSharedDatasetOptions();
  const [shareSql, setShareSql] = React.useState<string | null>(null);

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
    if (params.get("dataset") && !editing.data) return;
    seeded.current = true;
    workbench.current?.setSql(
      editing.data?.sql ?? params.get("sql") ?? starterSql(catalog).sql,
    );
  }, [catalog, params, editing.data]);

  const editable = editing.data?.canEdit ? editing.data : null;
  const canShare = Boolean(editable || shareOptions.data?.canShare);

  return (
    <div className="-mx-4 -mb-4 flex min-h-[calc(100vh-10rem)] min-w-0 flex-col">
      <div className="flex flex-wrap items-start gap-3 px-4 pb-2 pt-1">
        <TerminalSquare className="mt-1 size-7 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
            {t("dataQuery.title")}
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t("dataQuery.subtitle")}
          </p>
        </div>
        <ConnectToolButton />
      </div>
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
            onShare={canShare ? (sql) => setShareSql(sql) : undefined}
            shareLabel={
              editable
                ? t("sharedDatasets.share.editButton", {
                    name: editable.sqlName,
                  })
                : undefined
            }
          />
          <ShareDatasetSheet
            open={shareSql !== null}
            sql={shareSql ?? ""}
            dataset={editable}
            onClose={() => setShareSql(null)}
            onShared={(dataset) => {
              setShareSql(null);
              router.push(nsPath(`/assets/${dataset.assetId}?tab=definition`));
            }}
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

/** What the teaser shows: the kind of question SQL answers across sources. */
const TEASER_SQL = `-- Join tables of different sources in one query
SELECT c.region, count(*) AS orders, sum(o.amount) AS revenue
FROM crm_db.public.customers AS c
JOIN shop_lake.shop.orders AS o ON o.customer_id = c.id
GROUP BY ALL
ORDER BY revenue DESC
LIMIT 100`;

/**
 * The SQL page as the public sees it: the real editor and toolbar, with an
 * example query, every action disabled — what signing in opens. The API
 * refuses visitors every SQL route (catalog, runs, saved queries) anyway.
 */
function QueryTeaser() {
  const { t } = useTranslation();
  const returnTo =
    typeof window === "undefined" ? "/" : window.location.pathname;
  return (
    <div
      className="-mx-4 -mb-4 flex min-h-[calc(100vh-10rem)] min-w-0 flex-col"
      data-testid="query-teaser"
    >
      <div className="mx-3 mt-2 flex flex-wrap items-center gap-3 rounded-md border border-dashed bg-muted/30 p-4">
        <Lock className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t("dataQuery.teaser.title")}</p>
          <p className="text-sm text-muted-foreground">
            {t("dataQuery.teaser.description")}
          </p>
        </div>
        <Button asChild size="sm" data-testid="query-teaser-sign-in">
          <a href={`/auth/login/?returnTo=${encodeURIComponent(returnTo)}`}>
            {t("dataQuery.teaser.signIn")}
          </a>
        </Button>
      </div>
      <section className="min-w-0 px-3 py-2">
        <QueryWorkbench
          catalog={null}
          initialSql={TEASER_SQL}
          editorPath="query://teaser/example.sql"
          editorHeight={240}
          resultHeight={320}
          disabled
        />
      </section>
    </div>
  );
}

export default function QueryPage() {
  // SQL is never the public's to run: visitors of a public workspace see
  // what it can do, and are asked to sign in to use it.
  if (useTenant()?.visitor) return <QueryTeaser />;
  return (
    <Suspense>
      <QueryPageContent />
    </Suspense>
  );
}
