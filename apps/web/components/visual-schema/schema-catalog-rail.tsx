"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  EyeOff,
  KeyRound,
  Lock,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Wand2,
} from "lucide-react";
import { Input } from "@workspace/ui/components/input";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { SourceIcon } from "@workspace/ui/components/source-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import type {
  QueryCatalog,
  QueryCatalogSource,
  QueryCatalogTable,
} from "@/lib/data-query";
import { ColumnAccessChip } from "@/components/governance/column-access-chip";
import type { ColumnAction, MaskKind } from "@/lib/column-access";
import {
  LEGACY_REQUEST_TABLE_DRAG_MIME,
  SCHEMA_DRAG_MIME,
} from "./types";

export interface SchemaCatalogRailProps {
  catalog: QueryCatalog | null;
  loading?: boolean;
  canEdit: boolean;
  hideSharedDatasets?: boolean;
  allowLockedTables?: boolean;
  placedAssetIds: ReadonlySet<string>;
  onAddTables: (tables: QueryCatalogTable[]) => void;
  onGenerateSource: (source: QueryCatalogSource) => void;
  onRefresh?: () => void;
  onCollapse?: () => void;
  testId?: string;
}

export function SchemaCatalogRail({
  catalog,
  loading = false,
  canEdit,
  hideSharedDatasets = false,
  allowLockedTables = false,
  placedAssetIds,
  onAddTables,
  onGenerateSource,
  onRefresh,
  onCollapse,
  testId = "request-catalog-rail",
}: SchemaCatalogRailProps) {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState("");
  const [collapsedSources, setCollapsedSources] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [expandedTables, setExpandedTables] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [selectedAssetIds, setSelectedAssetIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  const needle = search.trim().toLowerCase();

  const sources = React.useMemo(() => {
    const raw = catalog?.sources ?? [];
    return raw
      .filter((s) => !hideSharedDatasets || s.sqlName.toLowerCase() !== "shared")
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
  }, [catalog, hideSharedDatasets, needle]);

  const totalTables = React.useMemo(
    () => sources.reduce((sum, s) => sum + s.tables.length, 0),
    [sources],
  );

  const tableByAssetId = React.useMemo(() => {
    const map = new Map<string, QueryCatalogTable>();
    for (const src of sources) {
      for (const tbl of src.tables) map.set(tbl.assetId, tbl);
    }
    return map;
  }, [sources]);

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

  const handleRowClick = (e: React.MouseEvent, assetId: string) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setSelectedAssetIds((prev) => {
        const next = new Set(prev);
        if (next.has(assetId)) next.delete(assetId);
        else next.add(assetId);
        return next;
      });
    } else if (selectedAssetIds.size > 0) {
      setSelectedAssetIds(new Set());
    }
  };

  const addSelected = () => {
    const picked: QueryCatalogTable[] = [];
    for (const id of selectedAssetIds) {
      const tbl = tableByAssetId.get(id);
      if (tbl && (tbl.queryable || allowLockedTables)) picked.push(tbl);
    }
    if (picked.length > 0) {
      onAddTables(picked);
      setSelectedAssetIds(new Set());
    }
  };

  return (
    <aside
      className="flex h-full flex-col border-r border-border/50 bg-muted/20"
      data-testid={testId}
    >
      <div className="border-b border-border/50 px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-1">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("dataRequest.rail.title")}
          </span>
          <div className="flex items-center gap-0.5">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="rounded-xs p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title={t("visualSchema.rail.refresh")}
                aria-label={t("visualSchema.rail.refresh")}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                className="rounded-xs p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title={t("visualSchema.rail.collapse")}
                aria-label={t("visualSchema.rail.collapse")}
              >
                <PanelLeftClose className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
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
                  <div className="group flex items-center gap-1 rounded-xs px-1.5 py-1 hover:bg-muted/70">
                    <button
                      type="button"
                      onClick={() => toggleSource(source.id)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium"
                    >
                      {collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <SourceIcon source={source.type} size="sm" />
                      <span className="truncate">{source.name}</span>
                      <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                        {source.tables.length}
                      </span>
                    </button>
                    {canEdit && source.tables.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onGenerateSource(source);
                            }}
                            className="shrink-0 rounded-xs p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            aria-label={t("visualSchema.rail.generateSource", {
                              name: source.name,
                            })}
                            data-testid={`vs-generate-source-${source.id}`}
                          >
                            <Wand2 className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("visualSchema.rail.generateSource", {
                            name: source.name,
                          })}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {!collapsed && (
                    <div className="space-y-0.5 pl-3">
                      {source.tables.map((table) => {
                        const disabled = !table.queryable && !allowLockedTables;
                        const locked = table.queryable && !table.canQuery;
                        const expanded = expandedTables.has(table.assetId);
                        const onCanvas = placedAssetIds.has(table.assetId);
                        const isSelected = selectedAssetIds.has(table.assetId);

                        const row = (
                          <div
                            key={table.assetId}
                            draggable={!disabled && canEdit}
                            onClick={(e) => handleRowClick(e, table.assetId)}
                            onDragStart={(e) => {
                              if (disabled || !canEdit) return;
                              const ids =
                                selectedAssetIds.has(table.assetId) &&
                                selectedAssetIds.size > 1
                                  ? [...selectedAssetIds]
                                  : [table.assetId];
                              e.dataTransfer.setData(
                                SCHEMA_DRAG_MIME,
                                JSON.stringify({ assetIds: ids }),
                              );
                              e.dataTransfer.setData(
                                LEGACY_REQUEST_TABLE_DRAG_MIME,
                                JSON.stringify({ assetId: table.assetId }),
                              );
                              e.dataTransfer.effectAllowed = "copy";
                            }}
                            className={cn(
                              "group rounded-xs border text-xs transition-colors",
                              disabled
                                ? "cursor-not-allowed border-transparent opacity-50"
                                : "border-transparent hover:border-border/60 hover:bg-card",
                              isSelected && "border-foreground bg-muted",
                            )}
                            data-testid={`catalog-table-${table.sqlName}`}
                          >
                            <div className="flex items-center gap-1 px-1.5 py-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleTableExpand(table.assetId);
                                }}
                                className="rounded-xs p-0.5 text-muted-foreground hover:bg-muted"
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
                              {onCanvas && (
                                <Check
                                  className="h-3 w-3 shrink-0 text-[var(--accent-ink)]"
                                  aria-label={t("visualSchema.rail.onCanvas")}
                                />
                              )}
                              {locked && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Lock
                                      className="h-3 w-3 shrink-0 text-[var(--cb-amber)]"
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onAddTables([table]);
                                  }}
                                  className="rounded-xs p-0.5 text-muted-foreground opacity-75 hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"
                                  title={t("dataRequest.rail.addToCanvas")}
                                  aria-label={`Add ${table.sqlName}`}
                                  data-testid={`add-table-${table.sqlName}`}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            {expanded && (
                              <ul className="space-y-0.5 border-t border-border/40 px-2.5 py-1.5">
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
                                      {col.isPrimaryKey && (
                                        <KeyRound className="h-2.5 w-2.5 shrink-0 text-[var(--cb-amber)]" />
                                      )}
                                      <span className="truncate font-mono text-foreground/90">
                                        {col.name}
                                      </span>
                                      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                                        {col.type}
                                        {col.nullable === true ? "?" : ""}
                                      </span>
                                      {col.access && (
                                        <ColumnAccessChip
                                          action={col.access as ColumnAction}
                                          mask={col.mask as MaskKind | undefined}
                                          inClear={col.inClear}
                                          compact
                                        />
                                      )}
                                    </li>
                                  ))
                                )}
                                {(table.hiddenColumns ?? 0) > 0 && (
                                  <li className="flex items-center gap-1 pt-0.5 font-mono text-[10px] text-muted-foreground">
                                    <EyeOff className="h-2.5 w-2.5 text-[var(--cb-amber)]" />
                                    {t("visualSchema.node.hiddenColumns", {
                                      count: table.hiddenColumns ?? 0,
                                    })}
                                  </li>
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

      {/* Footer strip */}
      <div className="border-t border-border/50 bg-muted/30 px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <span>
            {t("visualSchema.rail.tableCount", { count: totalTables })}
          </span>
          {selectedAssetIds.size > 0 && canEdit ? (
            <button
              type="button"
              onClick={addSelected}
              className="rounded-xs bg-foreground px-1.5 py-0.5 font-semibold text-background hover:opacity-90"
              data-testid="vs-add-selected-tables"
            >
              {t("visualSchema.rail.addSelected", {
                count: selectedAssetIds.size,
              })}
            </button>
          ) : (
            <span className="truncate opacity-75">
              {t("visualSchema.rail.multiSelectHint")}
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
