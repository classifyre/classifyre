"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Clock,
  Columns3,
  Copy,
  Database,
  ExternalLink,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  History,
  Lock,
  Search,
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
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { ColumnAccessChip } from "@/components/governance/column-access-chip";
import { useTranslation } from "@/hooks/use-translation";
import { useRowWords } from "@/hooks/use-row-words";
import { describeFilter } from "@/lib/row-filters";
import { useNamespace } from "@/components/namespace-provider";
import { formatDate, formatRelative } from "@/lib/date";
import {
  copyText,
  type QueryCatalog,
  type QueryCatalogSource,
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

/** The explorer tree while the catalog loads: sources with a few tables. */
function TreeSkeleton({ label }: { label: string }) {
  const widths = [
    ["w-28", "w-24", "w-32", "w-20"],
    ["w-32", "w-28", "w-20"],
    ["w-24", "w-32", "w-28", "w-24"],
  ];
  return (
    <div
      className="space-y-3 px-1 pt-1"
      role="status"
      aria-busy="true"
      aria-label={label}
      data-testid="query-catalog-skeleton"
    >
      {widths.map((tables, index) => (
        <div key={index} className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Skeleton className="size-3.5" />
            <Skeleton className="size-4 rounded-full" />
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="ml-auto h-3.5 w-7" />
          </div>
          <div className="ml-3 space-y-1.5 border-l border-border/60 pl-3">
            {tables.map((width, row) => (
              <div key={row} className="flex items-center gap-1.5">
                <Skeleton className="size-3" />
                <Skeleton className={cn("h-3", width)} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** History and Saved while they load: a few query cards. */
function CardsSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-1" role="status" aria-busy="true" aria-label={label}>
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="space-y-2 rounded border p-2">
          <div className="flex items-center gap-1.5">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className={cn("h-3", index % 2 ? "w-40" : "w-52")} />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-2.5 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface SchemaGroup {
  key: string;
  schema: string;
  tables: QueryCatalogTable[];
}

function groupTablesBySchema(source: QueryCatalogSource): SchemaGroup[] {
  const bySchema = new Map<string, QueryCatalogTable[]>();
  for (const table of source.tables) {
    const schema = table.schema || "default";
    const list = bySchema.get(schema);
    if (list) list.push(table);
    else bySchema.set(schema, [table]);
  }
  return Array.from(bySchema.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([schema, tables]) => ({
      key: `${source.id}:${schema}`,
      schema,
      tables: [...tables].sort((a, b) => a.table.localeCompare(b.table)),
    }));
}

/**
 * The database explorer beside the SQL workbench: a classic DB-GUI tree
 * (`Source → Folder/Schema → Tables → Columns`), plus History and Saved
 * queries. Scrolls strictly inside itself so the workbench stays fixed in the
 * viewport.
 *
 * Everything is one click. When `onOpenSource` / `onOpenTable` are supplied
 * (the main `/query` IDE), clicking a source opens a Source tab and clicking a
 * table opens a DBeaver-style Asset tab preloaded with 200 rows. Without them
 * (`SourceDataTab`), clicking a source folds it and clicking a table inserts
 * its SQL name. Chevrons fold; the only row action is Copy.
 */
export function QueryExplorer({
  catalog,
  onInsert,
  onOpenSource,
  onOpenTable,
  activeSourceId,
  activeAssetId,
  tablesOnly = false,
  history = [],
  historyLoading = false,
  saved = [],
  savedLoading = false,
  onOpenRun,
  onOpenSaved,
  activeRunId,
  recent = [],
}: {
  catalog: QueryCatalog | null;
  /** Writes a table or column name where the editor's cursor stands. */
  onInsert: (text: string) => void;
  /** Opens a database/source overview + tables tab inside the workbench. */
  onOpenSource?: (source: QueryCatalogSource) => void;
  /** Opens a table/asset data + info tab inside the workbench. */
  onOpenTable?: (table: QueryCatalogTable, source: QueryCatalogSource) => void;
  /** Highlights the source row whose tab is currently active. */
  activeSourceId?: string | null;
  /** Highlights the table row whose tab is currently active. */
  activeAssetId?: string | null;
  tablesOnly?: boolean;
  history?: QueryRun[];
  historyLoading?: boolean;
  saved?: SavedQueryDto[];
  savedLoading?: boolean;
  onOpenRun?: (run: QueryRun) => void;
  onOpenSaved?: (saved: SavedQueryDto) => void;
  activeRunId?: string | null;
  /** The last assets opened, newest first, listed above the tree. */
  recent?: { table: QueryCatalogTable; source: QueryCatalogSource }[];
}) {
  const { t } = useTranslation();
  const rowWords = useRowWords();
  const { nsHref } = useNamespace();
  const insert = onInsert;
  const [tab, setTab] = React.useState("tables");
  const [filter, setFilter] = React.useState("");
  const [onlyQueryable, setOnlyQueryable] = React.useState(false);
  const [openSources, setOpenSources] = React.useState<Record<string, boolean>>(
    {},
  );
  const [openFolders, setOpenFolders] = React.useState<Record<string, boolean>>(
    {},
  );
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
                source.name.toLowerCase().includes(needle) ||
                source.sqlName.toLowerCase().includes(needle) ||
                table.sqlName.toLowerCase().includes(needle) ||
                table.name.toLowerCase().includes(needle) ||
                table.columns.some((c) =>
                  c.name.toLowerCase().includes(needle),
                )),
          ),
        }))
        .filter((source) => source.tables.length)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [catalog, needle, onlyQueryable],
  );

  const queryableCount = React.useMemo(
    () =>
      (catalog?.sources ?? []).reduce(
        (n, source) => n + source.tables.filter((s) => s.canQuery).length,
        0,
      ),
    [catalog],
  );

  const toggleSource = React.useCallback((id: string, open: boolean) => {
    setOpenSources((state) => ({ ...state, [id]: !open }));
  }, []);

  const doCopy = React.useCallback(
    (text: string) => {
      void copyText(text).then((ok) => {
        if (ok) toast.success(t("dataQuery.explorer.copied", { name: text }));
      });
    },
    [t],
  );

  const tableIcon = (table: QueryCatalogTable) =>
    !table.queryable ? (
      <CircleSlash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    ) : !table.canQuery ? (
      <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    ) : (
      <Table2 className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
    );

  return (
    <TooltipProvider delayDuration={300}>
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
      >
        {!tablesOnly && onOpenTable && recent.length > 0 && (
          <div
            className="mb-2 shrink-0 border-b pb-2"
            data-testid="query-recent-assets"
          >
            <p className="flex items-center gap-1.5 px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden />
              {t("dataQuery.explorer.recent")}
            </p>
            {recent.map(({ table, source }) => (
              <button
                key={table.assetId}
                type="button"
                onClick={() => onOpenTable(table, source)}
                className={cn(
                  "flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted",
                  activeAssetId === table.assetId &&
                    "bg-accent/60 font-medium text-foreground",
                )}
                title={table.sqlName}
                data-testid={`query-recent-${table.assetId}`}
              >
                {tableIcon(table)}
                <span className="min-w-0 truncate font-mono text-xs">
                  {table.table}
                </span>
                <span className="ml-auto min-w-0 max-w-[45%] shrink truncate text-[11px] text-muted-foreground">
                  {source.name}
                </span>
              </button>
            ))}
          </div>
        )}

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
          className="mt-1.5 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <div
            className="flex h-full min-h-0 flex-col gap-1.5 overflow-hidden"
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
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden overscroll-contain pr-0.5 text-sm">
              {!catalog && <TreeSkeleton label={t("dataQuery.explorer.tables")} />}
              {catalog && !sources.length && (
                <p className="px-0.5 text-xs text-muted-foreground">
                  {t("dataQuery.noTables")}
                </p>
              )}
              {sources.map((source) => {
                const sourceOpen = needle
                  ? true
                  : (openSources[source.id] ?? true);
                const tablesCount = source.tables.length;
                const canCount = source.tables.filter((s) => s.canQuery).length;
                const schemaGroups = groupTablesBySchema(source);
                const singleSchema = schemaGroups.length === 1;
                const isSourceActive = activeSourceId === source.id;
                // Keep the full unfiltered source from catalog when opening a tab
                // so the Source tab always shows every table of the source.
                const fullSource =
                  catalog?.sources.find((s) => s.id === source.id) ?? source;

                return (
                  <div key={source.id} className="select-none">
                    {/*
                     * One click on the row opens the source (in a tab on the
                     * /query IDE, else it folds the tree); the chevron always
                     * folds. Copy reserves its slot so nothing jumps on hover.
                     */}
                    <div
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group flex min-h-7 cursor-pointer items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-muted",
                        isSourceActive &&
                          "bg-accent/50 font-semibold text-foreground",
                      )}
                      onClick={() =>
                        onOpenSource
                          ? onOpenSource(fullSource)
                          : toggleSource(source.id, sourceOpen)
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        if (onOpenSource) onOpenSource(fullSource);
                        else toggleSource(source.id, sourceOpen);
                      }}
                      data-testid={`catalog-source-${source.id}`}
                    >
                      <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-background/60"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleSource(source.id, sourceOpen);
                        }}
                        aria-label={source.sqlName}
                        tabIndex={-1}
                      >
                        {sourceOpen ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </button>
                      <SourceIcon source={source.type} size="sm" />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                            {source.name}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                          {onOpenSource
                            ? t("dataQuery.explorer.openSourceTabHint", {
                                name: source.name,
                              })
                            : source.name}
                        </TooltipContent>
                      </Tooltip>
                      <span className="shrink-0 rounded bg-muted/80 px-1 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                        {canCount}/{tablesCount}
                      </span>
                      {!onOpenSource && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link
                              href={nsHref(`/sources/${source.id}`)}
                              className="invisible shrink-0 rounded p-1 text-muted-foreground group-hover:visible hover:text-foreground"
                              onClick={(event) => event.stopPropagation()}
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
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="invisible shrink-0 cursor-pointer rounded p-1 text-muted-foreground group-hover:visible hover:text-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              doCopy(source.sqlName);
                            }}
                            data-testid={`catalog-copy-source-${source.id}`}
                            tabIndex={-1}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent
                          side="left"
                          className="font-mono text-xs"
                        >
                          {t("dataQuery.explorer.copySourceHint", {
                            name: source.sqlName,
                          })}
                        </TooltipContent>
                      </Tooltip>
                    </div>

                    {sourceOpen && (
                      <div className="ml-2.5 space-y-0.5 border-l border-border/60 pl-2 pt-0.5">
                        {schemaGroups.map((group) => {
                          const folderOpen = needle
                            ? true
                            : (openFolders[group.key] ?? true);
                          const folderLabel = singleSchema
                            ? t("dataQuery.explorer.tablesFolder")
                            : group.schema;
                          return (
                            <div key={group.key}>
                              <button
                                type="button"
                                className="flex w-full cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                                onClick={() =>
                                  setOpenFolders((state) => ({
                                    ...state,
                                    [group.key]: !folderOpen,
                                  }))
                                }
                                data-testid={`catalog-folder-${group.key}`}
                              >
                                {folderOpen ? (
                                  <ChevronDown className="h-3 w-3 shrink-0" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 shrink-0" />
                                )}
                                {folderOpen ? (
                                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-600/80 dark:text-amber-400/80" />
                                ) : (
                                  <Folder className="h-3.5 w-3.5 shrink-0 text-amber-600/80 dark:text-amber-400/80" />
                                )}
                                <span className="truncate font-medium">
                                  {folderLabel}
                                </span>
                                {singleSchema && group.schema && (
                                  <span className="truncate font-mono text-[10px] text-muted-foreground/80">
                                    ({group.schema})
                                  </span>
                                )}
                                <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/80">
                                  {group.tables.length}
                                </span>
                              </button>

                              {folderOpen && (
                                <div className="ml-2 space-y-px border-l border-border/50 pl-1.5 pt-0.5">
                                  {group.tables.map((table) => {
                                    const expanded =
                                      openTables[table.assetId] ?? false;
                                    const isTableActive =
                                      activeAssetId === table.assetId;
                                    const clickable =
                                      Boolean(onOpenTable) || table.canQuery;
                                    const openTable = () => {
                                      if (onOpenTable) {
                                        onOpenTable(table, fullSource);
                                      } else if (table.canQuery) {
                                        insert(table.sqlName);
                                      }
                                    };
                                    return (
                                      <div key={table.assetId}>
                                        <div
                                          role="button"
                                          tabIndex={clickable ? 0 : -1}
                                          aria-disabled={!clickable}
                                          className={cn(
                                            "group flex min-h-6 items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-muted",
                                            clickable
                                              ? "cursor-pointer"
                                              : "cursor-not-allowed",
                                            !table.canQuery &&
                                              "text-muted-foreground",
                                            isTableActive &&
                                              "bg-accent/60 font-medium text-foreground",
                                          )}
                                          onClick={openTable}
                                          onKeyDown={(event) => {
                                            if (
                                              event.key !== "Enter" &&
                                              event.key !== " "
                                            )
                                              return;
                                            event.preventDefault();
                                            openTable();
                                          }}
                                          data-testid={`catalog-table-${table.sqlName}`}
                                        >
                                          <button
                                            type="button"
                                            className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-background/60"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              setOpenTables((state) => ({
                                                ...state,
                                                [table.assetId]: !expanded,
                                              }));
                                            }}
                                            aria-label={table.sqlName}
                                            tabIndex={-1}
                                          >
                                            {expanded ? (
                                              <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                            ) : (
                                              <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                            )}
                                          </button>
                                          {tableIcon(table)}
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span className="min-w-0 flex-1 truncate text-left font-mono text-xs">
                                                {table.table}
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent
                                              side="left"
                                              className="font-mono text-xs"
                                            >
                                              {!table.canQuery
                                                ? (table.reason ??
                                                  t("dataQuery.locked"))
                                                : onOpenTable
                                                  ? t(
                                                      "dataQuery.explorer.openTableTabHint",
                                                      { name: table.sqlName },
                                                    )
                                                  : t(
                                                      "dataQuery.explorer.insertHint",
                                                      { name: table.sqlName },
                                                    )}
                                            </TooltipContent>
                                          </Tooltip>

                                          {table.canQuery && (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <button
                                                  type="button"
                                                  className="invisible shrink-0 cursor-pointer rounded p-1 text-muted-foreground group-hover:visible hover:text-foreground"
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    doCopy(table.sqlName);
                                                  }}
                                                  data-testid={`catalog-copy-${table.sqlName}`}
                                                  tabIndex={-1}
                                                >
                                                  <Copy className="h-3 w-3" />
                                                </button>
                                              </TooltipTrigger>
                                              <TooltipContent
                                                side="left"
                                                className="font-mono text-xs"
                                              >
                                                {t(
                                                  "dataQuery.explorer.copyNameHint",
                                                  { name: table.sqlName },
                                                )}
                                              </TooltipContent>
                                            </Tooltip>
                                          )}

                                          {!onOpenTable && (
                                            <Link
                                              href={nsHref(
                                                `/assets/${table.assetId}`,
                                              )}
                                              className="invisible shrink-0 rounded p-1 text-muted-foreground group-hover:visible hover:text-foreground"
                                              onClick={(event) =>
                                                event.stopPropagation()
                                              }
                                              title={table.name}
                                              tabIndex={-1}
                                            >
                                              <ExternalLink className="h-3 w-3" />
                                            </Link>
                                          )}
                                        </div>

                                        {expanded && (
                                          <div className="ml-3 space-y-px border-l border-border/50 py-0.5 pl-2">
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
                                                    className="flex w-full cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left font-mono text-[11px] hover:bg-muted"
                                                    onClick={() =>
                                                      insert(column.name)
                                                    }
                                                  >
                                                    <Columns3 className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                                                    <span className="truncate">
                                                      {column.name}
                                                    </span>
                                                    {column.access && (
                                                      <ColumnAccessChip
                                                        action={column.access}
                                                        mask={column.mask}
                                                        inClear={column.inClear}
                                                        compact
                                                      />
                                                    )}
                                                    <span className="ml-auto shrink-0 truncate text-[10px] text-muted-foreground">
                                                      {column.type}
                                                    </span>
                                                  </button>
                                                </TooltipTrigger>
                                                <TooltipContent
                                                  side="left"
                                                  className="font-mono text-xs"
                                                >
                                                  {t(
                                                    "dataQuery.explorer.insertHint",
                                                    { name: column.name },
                                                  )}
                                                </TooltipContent>
                                              </Tooltip>
                                            ))}
                                            {table.rowFilter && (
                                              <p
                                                className="flex items-start gap-1 px-1 text-[11px] text-muted-foreground"
                                                data-testid="explorer-row-filter"
                                              >
                                                <Filter
                                                  className="mt-0.5 h-3 w-3 shrink-0"
                                                  aria-hidden
                                                />
                                                {t("rowFilters.tableFiltered", {
                                                  rows: describeFilter(
                                                    table.rowFilter.anyOf,
                                                    rowWords,
                                                  ),
                                                })}
                                              </p>
                                            )}
                                            {(table.hiddenColumns ?? 0) > 0 && (
                                              <p
                                                className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground"
                                                data-testid="explorer-hidden-columns"
                                              >
                                                <ColumnAccessChip
                                                  action="hide"
                                                  compact
                                                />
                                                {t("columnAccess.hiddenCount", {
                                                  count:
                                                    table.hiddenColumns ?? 0,
                                                })}
                                              </p>
                                            )}
                                            {table.columns.length === 0 &&
                                              table.canQuery && (
                                                <p className="px-1 text-[11px] text-muted-foreground">
                                                  {t(
                                                    "dataQuery.explorer.noColumns",
                                                  )}
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
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="history"
          className="mt-1.5 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <div
            className="flex h-full min-h-0 w-full min-w-0 flex-col gap-1 overflow-y-auto overflow-x-hidden overscroll-contain pr-0.5"
            data-testid="query-history"
          >
            {historyLoading && !history.length && (
              <CardsSkeleton label={t("dataQuery.explorer.loadingHistory")} />
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
                  "group w-full min-w-0 shrink-0 cursor-pointer rounded border p-2 text-left hover:bg-muted",
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
          className="mt-1.5 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <div
            className="flex h-full min-h-0 w-full min-w-0 flex-col gap-1 overflow-y-auto overflow-x-hidden overscroll-contain pr-0.5"
            data-testid="query-saved"
          >
            {savedLoading && !saved.length && (
              <CardsSkeleton label={t("dataQuery.explorer.loadingSaved")} />
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
                className="group w-full min-w-0 shrink-0 cursor-pointer rounded border p-2 text-left hover:bg-muted"
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
