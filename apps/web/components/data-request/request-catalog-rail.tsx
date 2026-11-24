"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Lock,
  Plus,
  Search,
  Table2,
} from "lucide-react";
import { Input } from "@workspace/ui/components/input";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import type { QueryCatalog, QueryCatalogTable } from "@/lib/data-query";
import { ColumnAccessChip } from "@/components/governance/column-access-chip";
import type { ColumnAction, MaskKind } from "@/lib/column-access";

export const TABLE_DRAG_MIME = "application/x-classifyre-request-table";

export interface RequestCatalogRailProps {
  catalog: QueryCatalog | null;
  loading?: boolean;
  canEdit: boolean;
  placedAssetIds: ReadonlySet<string>;
  onAddTable: (table: QueryCatalogTable) => void;
}

export function RequestCatalogRail({
  catalog,
  loading = false,
  canEdit,
  placedAssetIds,
  onAddTable,
}: RequestCatalogRailProps) {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState("");
  const [collapsedSources, setCollapsedSources] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [expandedTables, setExpandedTables] = React.useState<Set<string>>(
    () => new Set(),
  );

  const needle = search.trim().toLowerCase();

  // Hide shared.* datasets — inputsOf refuses datasets as inputs in v1 (PRD §4.5).
  const sources = React.useMemo(() => {
    const raw = catalog?.sources ?? [];
    return raw
      .filter((s) => s.sqlName.toLowerCase() !== "shared")
      .map((source) => {
        const tables = source.tables.filter((table) => {
          if (!needle) return true;
          return (
            table.sqlName.toLowerCase().includes(needle) ||
            table.name.toLowerCase().includes(needle) ||
            source.name.toLowerCase().includes(needle) ||
            table.columns.some((c) => c.name.toLowerCase().includes(needle))
          );
        });
        return { ...source, tables };
      })
      .filter((s) => s.tables.length > 0);
  }, [catalog, needle]);

  const toggleSource = (id: string) => {
    setCollapsedSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTableExpand = (id: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside
      className="flex h-full flex-col border-r bg-muted/20"
      data-testid="request-catalog-rail"
    >
      <div className="border-b px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("dataRequest.rail.title")}
          </span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("dataRequest.rail.searchPlaceholder")}
            className="h-8 pl-8 text-xs"
            data-testid="request-catalog-search"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {loading && !catalog ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              {t("common.loading")}
            </p>
          ) : sources.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              {t("dataRequest.rail.empty")}
            </p>
          ) : (
            sources.map((source) => {
              const collapsed = collapsedSources.has(source.id);
              return (
                <div key={source.id} className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => toggleSource(source.id)}
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs font-medium hover:bg-muted/70"
                  >
                    {collapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <Database className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                    <span className="truncate">{source.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {source.tables.length}
                    </span>
                  </button>

                  {!collapsed && (
                    <div className="space-y-0.5 pl-3">
                      {source.tables.map((table) => {
                        const disabled = !table.queryable;
                        const locked = table.queryable && !table.canQuery;
                        const expanded = expandedTables.has(table.assetId);
                        const onCanvas = placedAssetIds.has(table.assetId);

                        const row = (
                          <div
                            key={table.assetId}
                            draggable={!disabled && canEdit}
                            onDragStart={(e) => {
                              if (disabled || !canEdit) return;
                              e.dataTransfer.setData(
                                TABLE_DRAG_MIME,
                                JSON.stringify({ assetId: table.assetId }),
                              );
                              e.dataTransfer.effectAllowed = "copy";
                            }}
                            className={cn(
                              "group rounded border border-transparent text-xs transition-colors",
                              disabled
                                ? "cursor-not-allowed opacity-50"
                                : "hover:border-border hover:bg-background",
                              onCanvas && "bg-sky-500/5 border-sky-500/20",
                            )}
                            data-testid={`catalog-table-${table.sqlName}`}
                          >
                            <div className="flex items-center gap-1 px-1.5 py-1">
                              <button
                                type="button"
                                onClick={() => toggleTableExpand(table.assetId)}
                                className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                                aria-label={table.name}
                              >
                                {expanded ? (
                                  <ChevronDown className="h-3 w-3" />
                                ) : (
                                  <ChevronRight className="h-3 w-3" />
                                )}
                              </button>
                              <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span
                                className="min-w-0 flex-1 truncate font-mono text-[11px]"
                                title={table.sqlName}
                              >
                                {table.table || table.name}
                              </span>
                              {locked && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Lock
                                      className="h-3 w-3 shrink-0 text-amber-500"
                                      data-testid={`catalog-locked-${table.sqlName}`}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {t("dataRequest.rail.lockedHint")}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              {!disabled && canEdit && (
                                <button
                                  type="button"
                                  onClick={() => onAddTable(table)}
                                  className="rounded p-0.5 text-muted-foreground opacity-75 hover:bg-sky-500/15 hover:text-sky-600 group-hover:opacity-100 dark:hover:text-sky-400"
                                  title={t("dataRequest.rail.addToCanvas")}
                                  aria-label={`Add ${table.sqlName}`}
                                  data-testid={`add-table-${table.sqlName}`}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            {expanded && (
                              <ul className="space-y-0.5 border-t border-border/50 px-2.5 py-1.5">
                                {table.columns.length === 0 ? (
                                  <li className="text-[10px] text-muted-foreground">
                                    {t("dataRequest.rail.noColumns")}
                                  </li>
                                ) : (
                                  table.columns.map((col) => (
                                    <li
                                      key={col.name}
                                      className="flex items-center gap-1.5 text-[11px]"
                                    >
                                      <span className="truncate font-mono text-foreground/90">
                                        {col.name}
                                      </span>
                                      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                                        {col.type}
                                      </span>
                                      {col.access && !col.inClear && (
                                          <ColumnAccessChip
                                            action={col.access as ColumnAction}
                                            mask={
                                              col.mask as MaskKind | undefined
                                            }
                                            compact
                                          />
                                        )}
                                    </li>
                                  ))
                                )}
                              </ul>
                            )}
                          </div>
                        );

                        if (disabled && table.reason) {
                          return (
                            <Tooltip key={table.assetId}>
                              <TooltipTrigger asChild>{row}</TooltipTrigger>
                              <TooltipContent>{table.reason}</TooltipContent>
                            </Tooltip>
                          );
                        }
                        return row;
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
