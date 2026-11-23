"use client";

import { ConnectToolButton } from "@/components/sql-connections/connect-tool-button";
import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "@/hooks/use-translation";
import { QueryExplorer } from "@/components/data-query/query-explorer";
import { QuerySourceTab } from "@/components/data-query/query-source-tab";
import { QueryAssetTab } from "@/components/data-query/query-asset-tab";
import { Lock, Table2, TerminalSquare } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import {
  NamespaceTabs,
  type NamespaceTabItem,
} from "@workspace/ui/components/namespace-tabs";
import { SourceIcon } from "@workspace/ui/components/source-icon";
import { cn } from "@workspace/ui/lib/utils";
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
  TABLE_PREVIEW_LIMIT,
  type QueryCatalog,
  type QueryCatalogSource,
  type QueryCatalogTable,
  type QueryRun,
  type SavedQueryDto,
} from "@/lib/data-query";

const MAIN_QUERY_TAB_ID = "query";

type DynamicTab =
  | { kind: "source"; id: string; source: QueryCatalogSource }
  | {
      kind: "asset";
      id: string;
      table: QueryCatalogTable;
      source: QueryCatalogSource;
    };

/**
 * Computes the exact remaining viewport height from the IDE container's top
 * edge so the workbench and right sidebar scroll strictly inside themselves
 * regardless of banners or workspace tabs rendered above.
 */
function useRemainingViewportHeight(
  ref: React.RefObject<HTMLDivElement | null>,
): number | null {
  const [height, setHeight] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    const update = () => {
      const node = ref.current;
      if (!node) return;
      const top = node.getBoundingClientRect().top;
      setHeight(Math.max(480, Math.floor(window.innerHeight - top)));
    };
    update();
    window.addEventListener("resize", update);
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (observer && document.body) observer.observe(document.body);
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [ref]);

  return height;
}

/**
 * SQL over the workspace's tables (docs/prd/DQ-data-query.md): a classic
 * database GUI workbench — pinned SQL Query tab plus closable Source and
 * Table/Asset tabs on the left, and an independently scrollable hierarchical
 * explorer (sources → folders → tables → columns, history, saved) on the right.
 */
function QueryPageContent() {
  const params = useSearchParams();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const viewportHeight = useRemainingViewportHeight(containerRef);
  const [catalog, setCatalog] = React.useState<QueryCatalog | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [history, setHistory] = React.useState<QueryRun[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(true);
  const [saved, setSaved] = React.useState<SavedQueryDto[]>([]);
  const [savedLoading, setSavedLoading] = React.useState(true);
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  const [openTabs, setOpenTabs] = React.useState<DynamicTab[]>([]);
  const [activeTabId, setActiveTabId] = React.useState<string>(
    MAIN_QUERY_TAB_ID,
  );
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

  const recordRun = React.useCallback((run: QueryRun) => {
    setHistory((current) => {
      const rest = current.filter((r) => r.id !== run.id);
      return [run, ...rest].slice(0, 30);
    });
  }, []);

  const openSourceTab = React.useCallback((source: QueryCatalogSource) => {
    const id = `source:${source.id}`;
    setOpenTabs((current) =>
      current.some((tab) => tab.id === id)
        ? current
        : [...current, { kind: "source", id, source }],
    );
    setActiveTabId(id);
  }, []);

  const openAssetTab = React.useCallback(
    (table: QueryCatalogTable, source: QueryCatalogSource) => {
      const id = `asset:${table.assetId}`;
      setOpenTabs((current) =>
        current.some((tab) => tab.id === id)
          ? current
          : [...current, { kind: "asset", id, table, source }],
      );
      setActiveTabId(id);
    },
    [],
  );

  const editInQuery = React.useCallback((sql: string) => {
    setActiveTabId(MAIN_QUERY_TAB_ID);
    setActiveRunId(null);
    workbench.current?.setSql(sql);
  }, []);

  const closeTab = React.useCallback(
    (id: string) => {
      if (id === MAIN_QUERY_TAB_ID) return;
      setOpenTabs((current) => {
        const index = current.findIndex((tab) => tab.id === id);
        if (index === -1) return current;
        const next = current.filter((tab) => tab.id !== id);
        if (activeTabId === id) {
          const neighbor = next[index] ?? next[index - 1];
          setActiveTabId(neighbor?.id ?? MAIN_QUERY_TAB_ID);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const closeOthers = React.useCallback((id: string) => {
    setOpenTabs((current) =>
      id === MAIN_QUERY_TAB_ID
        ? []
        : current.filter((tab) => tab.id === id),
    );
    setActiveTabId(id);
  }, []);

  const closeLeft = React.useCallback(
    (id: string) => {
      if (id === MAIN_QUERY_TAB_ID) return;
      setOpenTabs((current) => {
        const index = current.findIndex((tab) => tab.id === id);
        if (index <= 0) return current;
        const next = current.slice(index);
        if (
          activeTabId !== MAIN_QUERY_TAB_ID &&
          !next.some((tab) => tab.id === activeTabId)
        ) {
          setActiveTabId(id);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const closeRight = React.useCallback(
    (id: string) => {
      setOpenTabs((current) => {
        const next =
          id === MAIN_QUERY_TAB_ID
            ? []
            : (() => {
                const index = current.findIndex((tab) => tab.id === id);
                return index === -1 ? current : current.slice(0, index + 1);
              })();
        if (
          activeTabId !== MAIN_QUERY_TAB_ID &&
          !next.some((tab) => tab.id === activeTabId)
        ) {
          setActiveTabId(id);
        }
        return next;
      });
    },
    [activeTabId],
  );

  const tabItems = React.useMemo<NamespaceTabItem[]>(
    () => [
      {
        id: MAIN_QUERY_TAB_ID,
        label: t("dataQuery.tabs.mainQuery"),
        icon: <TerminalSquare className="size-3.5" />,
        closable: false,
      },
      ...openTabs.map<NamespaceTabItem>((tab) =>
        tab.kind === "source"
          ? {
              id: tab.id,
              label: tab.source.name,
              title: `${tab.source.name} (${tab.source.sqlName})`,
              icon: <SourceIcon source={tab.source.type} size="sm" />,
              href: nsPath(`/sources/${tab.source.id}`),
            }
          : {
              id: tab.id,
              label: tab.table.table,
              title: tab.table.sqlName,
              icon: (
                <Table2 className="size-3.5 text-sky-600 dark:text-sky-400" />
              ),
              href: nsPath(`/assets/${tab.table.assetId}`),
            },
      ),
    ],
    [nsPath, openTabs, t],
  );

  const activeSourceId = activeTabId.startsWith("source:")
    ? activeTabId.slice("source:".length)
    : null;
  const activeAssetId = activeTabId.startsWith("asset:")
    ? activeTabId.slice("asset:".length)
    : null;

  const editable = editing.data?.canEdit ? editing.data : null;
  const canShare = Boolean(editable || shareOptions.data?.canShare);

  return (
    <div
      ref={containerRef}
      style={
        viewportHeight
          ? ({ "--query-ide-height": `${viewportHeight}px` } as React.CSSProperties)
          : undefined
      }
      className="-mx-4 -mb-4 flex min-h-[calc(100dvh-6rem)] min-w-0 flex-col lg:h-[var(--query-ide-height,calc(100dvh-5.5rem))] lg:overflow-hidden"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2">
        <TerminalSquare className="size-6 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h1 className="font-serif text-xl font-black uppercase tracking-[0.08em] sm:text-2xl">
              {t("dataQuery.title")}
            </h1>
            <p className="hidden truncate text-xs text-muted-foreground xl:block">
              {t("dataQuery.subtitle")}
            </p>
          </div>
        </div>
        <ConnectToolButton />
      </div>

      {failed && (
        <p className="shrink-0 px-3 pt-2 text-sm text-destructive">
          {t("dataQuery.catalogFailed")}
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_20rem] lg:overflow-hidden">
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b bg-muted/35 px-2">
            <NamespaceTabs
              items={tabItems}
              activeId={activeTabId}
              ariaLabel={t("dataQuery.tabs.ariaLabel")}
              closeLabel={(item) =>
                t("dataQuery.tabs.closeAria", { name: item.label })
              }
              onActivate={setActiveTabId}
              onClose={closeTab}
              onCloseOthers={closeOthers}
              onCloseLeft={closeLeft}
              onCloseRight={closeRight}
              menuLabels={{
                openInNewTab: t("dataQuery.tabs.openInNewTab"),
                close: () => t("dataQuery.tabs.close"),
                closeOthers: t("dataQuery.tabs.closeOthers"),
                closeLeft: t("dataQuery.tabs.closeLeft"),
                closeRight: t("dataQuery.tabs.closeRight"),
              }}
              data-testid="query-workbench-tabs"
            />
          </div>

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* Keep the pinned main SQL Query tab mounted so switching tabs
                preserves editor state, undo history, and query results. */}
            <div
              className={cn(
                "min-h-0 flex-1 overflow-y-auto px-3 py-2",
                activeTabId !== MAIN_QUERY_TAB_ID && "hidden",
              )}
              aria-hidden={activeTabId !== MAIN_QUERY_TAB_ID}
            >
              <QueryWorkbench
                ref={workbench}
                catalog={catalog}
                initialSql=""
                editorPath="query://workspace/main.sql"
                editorHeight={300}
                resultHeight={480}
                disabled={!catalog}
                onRunFinished={(run) => {
                  setActiveRunId(run.id);
                  recordRun(run);
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
                  router.push(
                    nsPath(`/assets/${dataset.assetId}?tab=definition`),
                  );
                }}
              />
            </div>

            {openTabs.map((tab) => {
              const isActive = activeTabId === tab.id;
              return (
                <div
                  key={tab.id}
                  className={cn(
                    "min-h-0 flex-1 overflow-hidden",
                    !isActive && "hidden",
                  )}
                  aria-hidden={!isActive}
                >
                  {tab.kind === "source" ? (
                    <QuerySourceTab
                      source={
                        catalog?.sources.find((s) => s.id === tab.source.id) ??
                        tab.source
                      }
                      onOpenTable={openAssetTab}
                      onEditInQuery={editInQuery}
                    />
                  ) : (
                    <QueryAssetTab
                      table={tab.table}
                      source={
                        catalog?.sources.find((s) => s.id === tab.source.id) ??
                        tab.source
                      }
                      onEditInQuery={editInQuery}
                      onOpenSource={openSourceTab}
                      onRunFinished={recordRun}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <aside
          aria-label={t("dataQuery.explorer.tables")}
          className="flex min-h-[24rem] w-full min-w-0 shrink-0 flex-col overflow-hidden border-t bg-background px-2 py-2 lg:h-full lg:min-h-0 lg:w-80 lg:border-l lg:border-t-0"
        >
          <QueryExplorer
            catalog={catalog}
            history={history}
            historyLoading={historyLoading}
            saved={saved}
            savedLoading={savedLoading}
            activeRunId={activeRunId}
            activeSourceId={activeSourceId}
            activeAssetId={activeAssetId}
            onOpenSource={openSourceTab}
            onOpenTable={openAssetTab}
            onInsert={(text) => {
              setActiveTabId(MAIN_QUERY_TAB_ID);
              workbench.current?.insert(text);
            }}
            onOpenRun={(run) => {
              setActiveTabId(MAIN_QUERY_TAB_ID);
              setActiveRunId(run.id);
              workbench.current?.showRun(run);
            }}
            onOpenSaved={(item) => {
              setActiveTabId(MAIN_QUERY_TAB_ID);
              setActiveRunId(null);
              workbench.current?.setSql(item.sql);
            }}
            onRunTable={(sqlName) => {
              editInQuery(previewSql(sqlName, TABLE_PREVIEW_LIMIT));
            }}
          />
        </aside>
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
