"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Copy,
  Database,
  ExternalLink,
  FileText,
  History,
  Lock,
  Play,
  Search,
  Star,
  Table2,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@workspace/ui/components/input";
import { Switch } from "@workspace/ui/components/switch";
import { Label } from "@workspace/ui/components/label";
import { SourceIcon } from "@workspace/ui/components/source-icon";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { Badge } from "@workspace/ui/components/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useNamespace } from "@/components/namespace-provider";
import { formatDate, formatRelative } from "@/lib/date";
import {
  type QueryCatalog,
  type QueryCatalogTable,
  type QueryRun,
  type SavedQueryDto,
} from "@/lib/data-query";

/** When a run or a saved query was last touched, in the reader's language. */
function ShortTime({ at }: { at: string | Date }) {
  return <span title={formatDate(at)}>{formatRelative(at)}</span>;
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        status === "SUCCESS" && "bg-emerald-500",
        status === "ERROR" && "bg-destructive",
        status === "TIMEOUT" && "bg-amber-500",
        status === "CANCELLED" && "bg-muted-foreground",
        (status === "PENDING" || status === "RUNNING") && "bg-sky-500",
      )}
      title={status}
    />
  );
}

function RunSqlPreview({ sql }: { sql: string }) {
  const first = sql.replace(/\s+/g, " ").trim();
  return (
    <span
      className="block min-w-0 flex-1 truncate font-mono text-xs"
      title={sql}
    >
      {first.length > 80 ? `${first.slice(0, 80)}…` : first}
    </span>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * The explorer beside an editor: Tables (sources → tables → columns),
 * History (recent SQL, reopened into the editor) and Saved. A table's play
 * button replaces the editor with a preview query over it; copy takes the
 * full `source.schema.table` name for pasting elsewhere. `tablesOnly` keeps
 * just the tables, for a source's Data tab.
 */
export function QueryExplorer({
  catalog,
  onInsert,
  onRunTable,
  tablesOnly = false,
  history = [],
  historyLoading = false,
  saved = [],
  savedLoading = false,
  onOpenRun,
  onOpenSaved,
  activeRunId,
}: {
  catalog: QueryCatalog | null;
  /** Writes a table or column name where the editor's cursor stands. */
  onInsert: (text: string) => void;
  onRunTable: (sqlName: string) => void;
  tablesOnly?: boolean;
  history?: QueryRun[];
  historyLoading?: boolean;
  saved?: SavedQueryDto[];
  savedLoading?: boolean;
  onOpenRun?: (run: QueryRun) => void;
  onOpenSaved?: (saved: SavedQueryDto) => void;
  activeRunId?: string | null;
}) {
  const { t } = useTranslation();
  const { nsHref } = useNamespace();
  const insert = onInsert;
  const [tab, setTab] = React.useState("tables");
  const [filter, setFilter] = React.useState("");
  const [onlyQueryable, setOnlyQueryable] = React.useState(false);
  const [starred, setStarred] = React.useState<Record<string, boolean>>({});
  const [openSources, setOpenSources] = React.useState<
    Record<string, boolean>
  >({});
  const [openTables, setOpenTables] = React.useState<Record<string, boolean>>(
    {},
  );

  const needle = filter.trim().toLowerCase();
  const sources = React.useMemo(
    () =>
      (catalog?.sources ?? [])
        .map((source) => ({
          ...source,
          tables: source.tables.filter(
            (table) =>
              (!onlyQueryable || table.canQuery) &&
              (!needle ||
                table.sqlName.includes(needle) ||
                table.name.toLowerCase().includes(needle) ||
                table.columns.some((c) =>
                  c.name.toLowerCase().includes(needle),
                )),
          ),
        }))
        .filter((source) => source.tables.length)
        .sort((a, b) => {
          const aStar = starred[a.id] ? 0 : 1;
          const bStar = starred[b.id] ? 0 : 1;
          return aStar - bStar || a.name.localeCompare(b.name);
        }),
    [catalog, needle, onlyQueryable, starred],
  );

  const queryableCount = React.useMemo(
    () =>
      (catalog?.sources ?? []).reduce(
        (n, source) => n + source.tables.filter((s) => s.canQuery).length,
        0,
      ),
    [catalog],
  );

  const doCopy = React.useCallback(
    (text: string) => {
      void copyText(text).then((ok) => {
        if (ok) toast.success(t("dataQuery.explorer.copied", { name: text }));
      });
    },
    [t],
  );

  const icon = (table: QueryCatalogTable) =>
    !table.queryable ? (
      <CircleSlash className="h-3 w-3 shrink-0 text-muted-foreground" />
    ) : !table.canQuery ? (
      <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
    ) : null;

  return (
    <TooltipProvider delayDuration={300}>
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex h-full min-h-0 w-full min-w-0 flex-col"
      >
        {!tablesOnly && (
          <TabsList className="grid h-8 w-full shrink-0 grid-cols-3 p-0.5">
            <TabsTrigger value="tables" className="h-7 gap-1.5 px-1 text-xs">
              <Database className="h-3.5 w-3.5" />
              {t("dataQuery.explorer.tables")}
            </TabsTrigger>
            <TabsTrigger value="history" className="h-7 gap-1.5 px-1 text-xs">
              <History className="h-3.5 w-3.5" />
              {t("dataQuery.explorer.history")}
            </TabsTrigger>
            <TabsTrigger value="saved" className="h-7 gap-1.5 px-1 text-xs">
              <FileText className="h-3.5 w-3.5" />
              {t("dataQuery.explorer.saved")}
            </TabsTrigger>
          </TabsList>
        )}

        <TabsContent
          value="tables"
          className="mt-1.5 min-h-0 w-full min-w-0 flex-1 data-[state=inactive]:hidden"
        >
          <div
            className="flex h-full min-h-0 flex-col gap-1.5"
            data-testid="query-catalog"
          >
            <div className="relative shrink-0">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t("dataQuery.catalogSearch")}
                className="h-7 pl-7 text-xs"
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 px-0.5">
              <Switch
                id="only-queryable"
                checked={onlyQueryable}
                onCheckedChange={setOnlyQueryable}
              />
              <Label htmlFor="only-queryable" className="text-xs font-normal">
                {t("dataQuery.onlyQueryable")}
              </Label>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {t("dataQuery.explorer.queryableCount", {
                  count: queryableCount,
                })}
              </span>
            </div>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-auto text-sm">
              {catalog && !sources.length && (
                <p className="px-0.5 text-xs text-muted-foreground">
                  {t("dataQuery.noTables")}
                </p>
              )}
              {sources.map((source) => {
                const sourceOpen = openSources[source.id] ?? true;
                const tablesCount = source.tables.length;
                const canCount = source.tables.filter((s) => s.canQuery).length;
                return (
                  <div key={source.id}>
                    {/*
                     * One hover zone per row: the icons reserve their width
                     * always (`invisible` keeps layout, `group-hover:visible`
                     * shows them), so nothing jumps or flickers when the
                     * pointer moves across the row.
                     */}
                    <div className="group flex min-h-7 items-center gap-1 rounded px-0.5 py-1 hover:bg-muted">
                      <button
                        type="button"
                        className="shrink-0 rounded p-0.5"
                        onClick={() =>
                          setOpenSources((state) => ({
                            ...state,
                            [source.id]: !sourceOpen,
                          }))
                        }
                        aria-label={source.sqlName}
                      >
                        {sourceOpen ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </button>
                      <SourceIcon source={source.type} size="sm" />
                      <span
                        className="min-w-0 flex-1 truncate text-[13px] font-medium"
                        title={source.name}
                      >
                        {source.name}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {canCount}/{tablesCount}
                      </span>
                      <button
                        type="button"
                        className={cn(
                          "invisible shrink-0 rounded p-1 text-muted-foreground group-hover:visible hover:text-foreground",
                          starred[source.id]
                            ? "visible text-amber-500 hover:text-amber-600"
                            : "",
                        )}
                        onClick={() =>
                          setStarred((state) => ({
                            ...state,
                            [source.id]: !state[source.id],
                          }))
                        }
                        title={t("dataQuery.explorer.star")}
                        tabIndex={-1}
                      >
                        <Star
                          className="h-3 w-3"
                          fill={starred[source.id] ? "currentColor" : "none"}
                        />
                      </button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="invisible shrink-0 rounded p-1 text-muted-foreground group-hover:visible hover:text-foreground"
                            onClick={() => doCopy(source.sqlName)}
                            tabIndex={-1}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="font-mono text-xs">
                          {t("dataQuery.explorer.copySourceHint", {
                            name: source.sqlName,
                          })}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            href={nsHref(`/sources/${source.id}`)}
                            className="invisible shrink-0 rounded p-1 text-muted-foreground group-hover:visible hover:text-foreground"
                            tabIndex={-1}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                          {t("dataQuery.explorer.openSourceHint", {
                            name: source.name,
                          })}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {sourceOpen && (
                      <div className="space-y-px pb-0.5">
                        <button
                          type="button"
                          className="block w-full truncate px-2 text-left font-mono text-[10px] text-muted-foreground hover:text-foreground"
                          onClick={() => doCopy(source.sqlName)}
                          title={t("dataQuery.explorer.copySourceHint", {
                            name: source.sqlName,
                          })}
                        >
                          {source.sqlName}
                        </button>
                        {source.tables.map((table) => {
                          const expanded = openTables[table.assetId] ?? false;
                          return (
                            <div key={table.assetId} className="pl-4">
                              {/*
                               * Same hover-zone trick as the source row above:
                               * the play/copy/asset icons always take up
                               * space, so the row never changes height and
                               * moving across icons does not flicker.
                               */}
                              <div
                                className={cn(
                                  "group flex min-h-6 items-center gap-1 rounded px-1 py-0.5 hover:bg-muted",
                                  !table.canQuery && "text-muted-foreground",
                                )}
                                title={
                                  table.canQuery
                                    ? table.sqlName
                                    : (table.reason ?? t("dataQuery.locked"))
                                }
                              >
                                <button
                                  type="button"
                                  className="shrink-0 rounded p-0.5"
                                  onClick={() =>
                                    setOpenTables((state) => ({
                                      ...state,
                                      [table.assetId]: !expanded,
                                    }))
                                  }
                                  aria-label={table.sqlName}
                                >
                                  {expanded ? (
                                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                  )}
                                </button>
                                {icon(table)}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="min-w-0 flex-1 truncate text-left font-mono text-xs"
                                      onClick={() =>
                                        table.canQuery && insert(table.sqlName)
                                      }
                                      disabled={!table.canQuery}
                                      data-testid={`catalog-table-${table.sqlName}`}
                                    >
                                      {table.schema}.{table.table}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="left"
                                    className="max-w-xs font-mono text-xs"
                                  >
                                    {table.canQuery
                                      ? t("dataQuery.explorer.insertHint", {
                                          name: table.sqlName,
                                        })
                                      : (table.reason ?? t("dataQuery.locked"))}
                                  </TooltipContent>
                                </Tooltip>
                                {table.canQuery && (
                                  <>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          className="invisible shrink-0 rounded p-1 text-emerald-600 group-hover:visible hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-500"
                                          onClick={() =>
                                            onRunTable(table.sqlName)
                                          }
                                          data-testid={`catalog-run-${table.sqlName}`}
                                          tabIndex={-1}
                                        >
                                          <Play className="h-3 w-3" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent side="left" className="text-xs">
                                        {t("dataQuery.explorer.runTableHint", {
                                          name: table.sqlName,
                                        })}
                                      </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          className="invisible shrink-0 rounded p-1 text-muted-foreground group-hover:visible hover:text-foreground"
                                          onClick={() => doCopy(table.sqlName)}
                                          data-testid={`catalog-copy-${table.sqlName}`}
                                          tabIndex={-1}
                                        >
                                          <Copy className="h-3 w-3" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent side="left" className="font-mono text-xs">
                                        {t("dataQuery.explorer.copyNameHint", {
                                          name: table.sqlName,
                                        })}
                                      </TooltipContent>
                                    </Tooltip>
                                  </>
                                )}
                                <Link
                                  href={nsHref(`/assets/${table.assetId}`)}
                                  className="invisible shrink-0 rounded p-1 text-muted-foreground group-hover:visible hover:text-foreground"
                                  title={table.name}
                                  tabIndex={-1}
                                >
                                  <Table2 className="h-3 w-3" />
                                </Link>
                              </div>
                              {expanded && (
                                <div className="space-y-px py-0.5 pl-6">
                                  {!table.canQuery && (
                                    <p className="px-1 text-[11px] text-muted-foreground">
                                      {table.queryable
                                        ? t("dataQuery.locked")
                                        : (table.reason ??
                                          t("dataQuery.notQueryable"))}
                                    </p>
                                  )}
                                  {table.columns.map((column) => (
                                    <Tooltip key={column.name}>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          className="flex w-full items-center gap-2 rounded px-1 py-px text-left font-mono text-[11px] hover:bg-muted"
                                          onClick={() => insert(column.name)}
                                        >
                                          <span className="truncate">
                                            {column.name}
                                          </span>
                                          <span className="ml-auto shrink-0 truncate text-muted-foreground">
                                            {column.type}
                                          </span>
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent
                                        side="left"
                                        className="font-mono text-xs"
                                      >
                                        {t("dataQuery.explorer.insertHint", {
                                          name: column.name,
                                        })}
                                      </TooltipContent>
                                    </Tooltip>
                                  ))}
                                  {table.columns.length === 0 &&
                                    table.canQuery && (
                                      <p className="px-1 text-[11px] text-muted-foreground">
                                        {t("dataQuery.explorer.noColumns")}
                                      </p>
                                    )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="history"
          className="mt-1.5 min-h-0 w-full min-w-0 flex-1 data-[state=inactive]:hidden"
        >
          <div
            className="flex h-full min-h-0 w-full min-w-0 flex-col gap-1 overflow-auto"
            data-testid="query-history"
          >
            {historyLoading && (
              <p className="px-0.5 text-xs text-muted-foreground">
                {t("dataQuery.explorer.loadingHistory")}
              </p>
            )}
            {!historyLoading && !history.length && (
              <p className="px-0.5 text-xs text-muted-foreground">
                {t("dataQuery.explorer.noHistory")}
              </p>
            )}
            {history.map((run) => (
              <button
                key={run.id}
                type="button"
                className={cn(
                  "group w-full min-w-0 rounded border p-2 text-left hover:bg-muted",
                  activeRunId === run.id && "border-primary bg-muted",
                )}
                onClick={() => onOpenRun?.(run)}
                title={t("dataQuery.explorer.reopenHint")}
                data-testid={`query-history-${run.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <StatusDot status={run.status} />
                  <RunSqlPreview sql={run.sql} />
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <ShortTime at={run.createdAt} />
                  {run.rowCount !== null && run.rowCount !== undefined && (
                    <span>{t("dataQuery.rows", { count: run.rowCount })}</span>
                  )}
                  {run.resultFormat && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      {run.resultFormat}
                    </Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        </TabsContent>

        <TabsContent
          value="saved"
          className="mt-1.5 min-h-0 w-full min-w-0 flex-1 data-[state=inactive]:hidden"
        >
          <div
            className="flex h-full min-h-0 w-full min-w-0 flex-col gap-1 overflow-auto"
            data-testid="query-saved"
          >
            {savedLoading && (
              <p className="px-0.5 text-xs text-muted-foreground">
                {t("dataQuery.explorer.loadingSaved")}
              </p>
            )}
            {!savedLoading && !saved.length && (
              <p className="px-0.5 text-xs text-muted-foreground">
                {t("dataQuery.explorer.noSaved")}
              </p>
            )}
            {saved.map((item) => (
              <button
                key={item.id}
                type="button"
                className="group w-full min-w-0 rounded border p-2 text-left hover:bg-muted"
                onClick={() => onOpenSaved?.(item)}
                title={t("dataQuery.explorer.reopenHint")}
                data-testid={`query-saved-${item.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {item.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    <ShortTime at={item.updatedAt} />
                  </span>
                </div>
                <RunSqlPreview sql={item.sql} />
              </button>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </TooltipProvider>
  );
}
