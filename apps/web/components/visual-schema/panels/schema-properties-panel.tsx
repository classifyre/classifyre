"use client";

import * as React from "react";
import {
  AlertTriangle,
  EyeOff,
  KeyRound,
  LayoutGrid,
  Link2,
  Lock,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  DATA_REQUEST_CARDINALITIES,
  DATA_REQUEST_JOIN_TYPES,
  type DataRequestCardinality,
  type DataRequestJoinType,
} from "@workspace/schemas/data-request";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useTranslation } from "@/hooks/use-translation";
import { ColumnAccessChip } from "@/components/governance/column-access-chip";
import type { ColumnAction, MaskKind } from "@/lib/column-access";
import {
  indexCatalogByAsset,
  indexFkColumnsByAsset,
} from "../lib/catalog-helpers";
import { formatRowCount, type VisualSchemaAdapter } from "../types";
import { TableColorSwatches } from "../nodes/table-color-swatches";
import { SchemaFilterPopover } from "../nodes/schema-filter-popover";

export interface SchemaPropertiesPanelProps {
  adapter: VisualSchemaAdapter;
  selectedTableId: string | null;
  selectedJoinId: string | null;
  onFindLinks: () => void;
  onArrangeConnected: () => void;
}

export function SchemaPropertiesPanel({
  adapter,
  selectedTableId,
  selectedJoinId,
  onFindLinks,
  onArrangeConnected,
}: SchemaPropertiesPanelProps) {
  const { t } = useTranslation();
  const { spec, catalog, capabilities } = adapter;

  const catalogByAsset = React.useMemo(
    () => indexCatalogByAsset(catalog),
    [catalog],
  );

  const fkColumnsByAsset = React.useMemo(
    () => indexFkColumnsByAsset(catalog),
    [catalog],
  );

  const selectedTable = React.useMemo(
    () => spec.tables.find((tbl) => tbl.id === selectedTableId) ?? null,
    [spec.tables, selectedTableId],
  );

  const selectedJoin = React.useMemo(
    () => spec.joins.find((j) => j.id === selectedJoinId) ?? null,
    [spec.joins, selectedJoinId],
  );

  const [aliasDraft, setAliasDraft] = React.useState("");
  const [aliasError, setAliasError] = React.useState(false);

  React.useEffect(() => {
    setAliasDraft(selectedTable?.alias ?? "");
    setAliasError(false);
  }, [selectedTable?.id, selectedTable?.alias]);

  if (selectedTable) {
    const catalogTable = catalogByAsset.get(selectedTable.assetId) ?? null;
    const isLocked = Boolean(catalogTable && !catalogTable.canQuery);
    const hasRowFilter = Boolean(catalogTable?.rowFilter);
    const hiddenColumns = catalogTable?.hiddenColumns ?? 0;
    const rowCountLabel = formatRowCount(catalogTable?.rowCount);
    const columns = catalogTable?.columns ?? [];
    const keepSet = new Set(selectedTable.keep);

    const fkCols = fkColumnsByAsset.get(selectedTable.assetId) ?? new Set<string>();

    const commitAlias = () => {
      if (!capabilities.canEdit) return;
      const trimmed = aliasDraft.trim().toLowerCase();
      if (trimmed === selectedTable.alias.toLowerCase()) {
        setAliasError(false);
        return;
      }
      const ok = adapter.renameAlias(selectedTable.id, trimmed);
      setAliasError(!ok);
    };

    return (
      <ScrollArea className="h-full" data-testid="vs-properties-table">
        <div className="space-y-4 p-3">
          {/* Table Header */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-mono text-xs font-bold">
                {selectedTable.sqlName.split(".").pop() ?? selectedTable.sqlName}
              </span>
              {rowCountLabel && (
                <Badge variant="outline" className="ml-auto font-mono text-[10px]">
                  {rowCountLabel}
                </Badge>
              )}
            </div>
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {selectedTable.sqlName}
            </p>
          </div>

          {/* Governance notices */}
          {(isLocked || hasRowFilter || hiddenColumns > 0 || !catalogTable) && (
            <div className="space-y-1.5 rounded-xs border border-border/60 bg-muted/30 p-2 text-[11px]">
              {!catalogTable && (
                <div className="flex items-center gap-1.5 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{t("dataRequest.canvas.tableMissing")}</span>
                </div>
              )}
              {isLocked && (
                <div className="flex items-center gap-1.5 text-foreground">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--cb-amber)]" />
                  <span>{t("dataRequest.rail.lockedHint")}</span>
                </div>
              )}
              {hasRowFilter && (
                <div className="flex items-center gap-1.5 text-foreground">
                  <Shield className="h-3.5 w-3.5 shrink-0 text-[var(--cb-amber)]" />
                  <span>{t("visualSchema.node.rowFilterActive")}</span>
                </div>
              )}
              {hiddenColumns > 0 && (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <EyeOff className="h-3.5 w-3.5 shrink-0 text-[var(--cb-amber)]" />
                  <span>
                    {t("visualSchema.node.hiddenColumns", {
                      count: hiddenColumns,
                    })}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Alias */}
          <div className="space-y-1">
            <label className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("visualSchema.properties.alias")}
            </label>
            <Input
              value={aliasDraft}
              disabled={!capabilities.canEdit}
              onChange={(e) => {
                setAliasDraft(e.target.value);
                setAliasError(false);
              }}
              onBlur={commitAlias}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitAlias();
              }}
              className="h-8 font-mono text-xs"
              data-testid="vs-prop-alias"
            />
            {aliasError && (
              <p className="text-[11px] text-destructive">
                {t("visualSchema.properties.aliasInvalid")}
              </p>
            )}
          </div>

          {/* Card Color */}
          {capabilities.canEdit && (
            <div className="space-y-1.5">
              <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("visualSchema.color.label")}
              </span>
              <TableColorSwatches
                value={selectedTable.color}
                onChange={(color) =>
                  adapter.setTableColor([selectedTable.id], color)
                }
              />
            </div>
          )}

          {/* Filters */}
          {capabilities.showFilters && (
            <div className="space-y-1.5 border-t border-border/50 pt-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("dataRequest.filters.title")} ({selectedTable.filters.length})
                </span>
                <SchemaFilterPopover
                  tableId={selectedTable.id}
                  columns={columns}
                  filters={selectedTable.filters}
                  canEdit={capabilities.canEdit}
                  onAdd={(f) => adapter.addFilter(selectedTable.id, f)}
                  onRemove={(idx) => adapter.removeFilter(selectedTable.id, idx)}
                />
              </div>
              {selectedTable.filters.length > 0 && (
                <ul className="space-y-1">
                  {selectedTable.filters.map((f, idx) => (
                    <li
                      key={f.id ?? idx}
                      className="flex items-center gap-1.5 rounded-xs border border-border/50 bg-muted/30 px-2 py-1 font-mono text-[11px]"
                    >
                      <span className="truncate">{f.column}</span>
                      <span className="font-semibold text-[var(--accent-ink)]">
                        {f.op}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {f.values
                          ? `(${f.values.join(", ")})`
                          : f.value !== undefined && f.value !== null
                            ? String(f.value)
                            : ""}
                      </span>
                      {capabilities.canEdit && (
                        <button
                          type="button"
                          onClick={() =>
                            adapter.removeFilter(selectedTable.id, f.id ?? idx)
                          }
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Columns */}
          <div className="space-y-1.5 border-t border-border/50 pt-3">
            <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("visualSchema.properties.columns")} ({columns.length})
            </span>
            <div className="divide-y divide-border/30 rounded-xs border border-border/50">
              {columns.map((col) => (
                <div
                  key={col.name}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs"
                >
                  {capabilities.showColumnSelection && (
                    <Checkbox
                      checked={keepSet.has(col.name)}
                      disabled={!capabilities.canEdit}
                      onCheckedChange={() =>
                        adapter.toggleColumn(selectedTable.id, col.name)
                      }
                      className="h-3.5 w-3.5"
                    />
                  )}
                  {col.isPrimaryKey ? (
                    <KeyRound className="h-3 w-3 shrink-0 text-[var(--cb-amber)]" />
                  ) : fkCols.has(col.name.toLowerCase()) ? (
                    <Link2 className="h-3 w-3 shrink-0 text-[var(--cb-violet)]" />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {col.name}
                  </span>
                  {col.access && (
                    <ColumnAccessChip
                      action={col.access as ColumnAction}
                      mask={col.mask as MaskKind | undefined}
                      inClear={col.inClear}
                      compact
                    />
                  )}
                  <span className="shrink-0 font-mono text-[9px] uppercase text-muted-foreground">
                    {col.type.split("(")[0]}
                    {col.nullable === true ? "?" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    );
  }

  if (selectedJoin) {
    const leftTable = spec.tables.find((tbl) => tbl.id === selectedJoin.left.tableId);
    const rightTable = spec.tables.find((tbl) => tbl.id === selectedJoin.right.tableId);

    return (
      <ScrollArea className="h-full" data-testid="vs-properties-join">
        <div className="space-y-4 p-3">
          <div className="space-y-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("visualSchema.properties.relation")}
            </span>
            <div className="rounded-xs border border-border/60 bg-muted/30 p-2 font-mono text-xs">
              <div>
                {leftTable?.alias ?? "?"}.{selectedJoin.left.column}
              </div>
              <div className="my-0.5 text-[10px] text-muted-foreground">=</div>
              <div>
                {rightTable?.alias ?? "?"}.{selectedJoin.right.column}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {selectedJoin.origin && (
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {t(`visualSchema.origin.${selectedJoin.origin}`)}
              </Badge>
            )}
            {selectedJoin.constraintName && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {selectedJoin.constraintName}
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <label className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("visualSchema.properties.joinType")}
            </label>
            <Select
              disabled={!capabilities.canEdit}
              value={selectedJoin.type}
              onValueChange={(v) =>
                adapter.updateJoin(selectedJoin.id, {
                  type: v as DataRequestJoinType,
                })
              }
            >
              <SelectTrigger className="h-8 font-mono text-xs" data-testid="vs-prop-join-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATA_REQUEST_JOIN_TYPES.map((jt) => (
                  <SelectItem key={jt} value={jt} className="font-mono text-xs">
                    {jt === "FULL" ? "FULL OUTER JOIN" : `${jt} JOIN`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("visualSchema.properties.cardinality")}
            </label>
            <Select
              disabled={!capabilities.canEdit}
              value={selectedJoin.cardinality ?? "none"}
              onValueChange={(v) =>
                adapter.updateJoin(selectedJoin.id, {
                  cardinality:
                    v === "none" ? undefined : (v as DataRequestCardinality),
                })
              }
            >
              <SelectTrigger className="h-8 font-mono text-xs" data-testid="vs-prop-cardinality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="font-mono text-xs">
                  {t("visualSchema.properties.cardinalityNone")}
                </SelectItem>
                {DATA_REQUEST_CARDINALITIES.map((c) => (
                  <SelectItem key={c} value={c} className="font-mono text-xs">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {capabilities.canEdit && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={() => adapter.removeJoin(selectedJoin.id)}
              data-testid="vs-prop-delete-join"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t("visualSchema.properties.deleteJoin")}
            </Button>
          )}
        </div>
      </ScrollArea>
    );
  }

  // Empty selection summary
  const sourceCount = new Set(
    spec.tables.map((tbl) => tbl.sqlName.split(".")[0]).filter(Boolean),
  ).size;

  return (
    <div className="space-y-4 p-3" data-testid="vs-properties-empty">
      <div className="space-y-1">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t("visualSchema.properties.summary")}
        </span>
        <div className="grid grid-cols-3 gap-1.5 pt-1">
          <div className="rounded-xs border border-border/50 bg-muted/20 p-2 text-center">
            <div className="font-mono text-base font-bold tabular-nums">
              {spec.tables.length}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {t("visualSchema.properties.tablesCount")}
            </div>
          </div>
          <div className="rounded-xs border border-border/50 bg-muted/20 p-2 text-center">
            <div className="font-mono text-base font-bold tabular-nums">
              {spec.joins.length}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {t("visualSchema.properties.joinsCount")}
            </div>
          </div>
          <div className="rounded-xs border border-border/50 bg-muted/20 p-2 text-center">
            <div className="font-mono text-base font-bold tabular-nums">
              {sourceCount}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {t("visualSchema.properties.sourcesCount")}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("visualSchema.properties.selectHint")}
      </p>

      {capabilities.canEdit && (
        <div className="flex flex-col gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={spec.tables.length < 2}
            onClick={onFindLinks}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {t("visualSchema.toolbar.findLinks")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={spec.tables.length === 0}
            onClick={onArrangeConnected}
          >
            <LayoutGrid className="mr-1.5 h-3.5 w-3.5" />
            {t("visualSchema.toolbar.arrangeConnected")}
          </Button>
        </div>
      )}
    </div>
  );
}
