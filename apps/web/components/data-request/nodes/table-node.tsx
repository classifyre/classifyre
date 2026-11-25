"use client";

import * as React from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Lock, MessageSquarePlus, X } from "lucide-react";
import type { DataRequestTable } from "@workspace/schemas/data-request";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import type { QueryCatalogTable } from "@/lib/data-query";
import { ColumnAccessChip } from "@/components/governance/column-access-chip";
import type { ColumnAction, MaskKind } from "@/lib/column-access";
import { useRequest, useRequestStore } from "../store/request-context";
import { FilterPopover } from "./filter-popover";

export interface TableNodeData extends Record<string, unknown> {
  table: DataRequestTable;
  catalogTable: QueryCatalogTable | null;
  canEdit: boolean;
  canComment?: boolean;
  hasError?: boolean;
  onPinComment?: (
    anchor: { tableId: string; column?: string },
    screen: { x: number; y: number },
  ) => void;
}

export type RequestTableNode = Node<TableNodeData, "request-table">;

export function colHandleId(side: "l" | "r", column: string): string {
  return `col:${side}:${column}`;
}

export function parseColHandleId(
  handleId: string | null | undefined,
): string | null {
  if (!handleId || !handleId.startsWith("col:")) return null;
  const parts = handleId.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : null;
}

export const TableNode = React.memo(function TableNode({
  data,
  selected,
}: NodeProps<RequestTableNode>) {
  const { t } = useTranslation();
  const store = useRequestStore();
  const { table, catalogTable, canEdit, canComment, hasError, onPinComment } =
    data;
  const isMissing = catalogTable === null;
  const isLocked = Boolean(catalogTable && !catalogTable.canQuery);

  const joins = useRequest((s) => s.spec.joins);
  const joinedCols = React.useMemo(() => {
    const set = new Set<string>();
    for (const j of joins) {
      if (j.left.tableId === table.id) set.add(j.left.column);
      if (j.right.tableId === table.id) set.add(j.right.column);
    }
    return set;
  }, [joins, table.id]);

  // Display catalog columns when available, else fallback to kept/joined columns for missing tables
  const columns = React.useMemo(() => {
    if (catalogTable) return catalogTable.columns;
    const names = [...new Set([...table.keep, ...joinedCols])];
    return names.map((name) => ({
      name,
      type: "",
      access: undefined,
      mask: undefined,
      inClear: undefined,
    }));
  }, [catalogTable, table.keep, joinedCols]);

  const keepSet = React.useMemo(() => new Set(table.keep), [table.keep]);
  const parts = table.sqlName.split(".");
  const leafName = parts[parts.length - 1] ?? table.sqlName;
  const prefix = parts.slice(0, -1).join(".");

  const allSelected =
    columns.length > 0 && columns.every((c) => keepSet.has(c.name));

  return (
    <div
      className={cn(
        "w-[248px] rounded-xs border bg-card text-card-foreground shadow-xs transition-shadow",
        "border-t-2 border-t-sky-500",
        selected && "ring-2 ring-sky-500/60",
        hasError && "border-destructive/70 border-t-destructive",
        isMissing && "opacity-65 grayscale",
      )}
      data-testid={`request-table-node-${table.alias}`}
      data-table-id={table.id}
    >
      {/* Card Header */}
      <div className="flex items-start gap-1.5 border-b bg-muted/30 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-xs font-semibold">
              {leafName}
            </span>
            <span className="shrink-0 rounded-xs bg-sky-500/15 px-1 py-0.2 font-mono text-[10px] font-semibold text-sky-700 dark:text-sky-300">
              {table.alias}
            </span>
            {isLocked && (
              <Lock
                className="h-3 w-3 shrink-0 text-amber-500"
                aria-label={t("dataRequest.rail.lockedHint")}
              />
            )}
            {isMissing && (
              <AlertTriangle
                className="h-3 w-3 shrink-0 text-destructive"
                aria-label={t("dataRequest.canvas.tableMissing")}
              />
            )}
          </div>
          {prefix && (
            <div className="truncate font-mono text-[10px] text-muted-foreground">
              {prefix}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {canComment && onPinComment && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPinComment(
                  { tableId: table.id },
                  { x: e.clientX, y: e.clientY },
                );
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t("dataRequest.canvas.pinComment")}
              aria-label={`Comment on ${table.sqlName}`}
              data-testid={`comment-table-${table.alias}`}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </button>
          )}
          <FilterPopover
            tableId={table.id}
            columns={columns}
            filters={table.filters}
            canEdit={canEdit}
            onAdd={(filter) => store.getState().addFilter(table.id, filter)}
            onRemove={(idx) => store.getState().removeFilter(table.id, idx)}
          />
          {canEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                store.getState().removeTable(table.id);
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title={t("common.remove")}
              aria-label={`Remove ${table.sqlName}`}
              data-testid={`remove-table-${table.alias}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Column selection toolbar */}
      {canEdit && columns.length > 0 && (
        <div className="flex items-center justify-between border-b bg-muted/10 px-2.5 py-1 text-[10px] text-muted-foreground">
          <span className="font-mono">
            {keepSet.size}/{columns.length} {t("dataRequest.canvas.columnsKept")}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              store
                .getState()
                .setTableColumns(
                  table.id,
                  allSelected ? [] : columns.map((c) => c.name),
                );
            }}
            className="font-mono text-sky-600 hover:underline dark:text-sky-400"
          >
            {allSelected
              ? t("dataRequest.canvas.selectNone")
              : t("dataRequest.canvas.selectAll")}
          </button>
        </div>
      )}

      {/* Column rows with per-column join handles */}
      <div className="max-h-[260px] divide-y divide-border/50 overflow-y-auto">
        {columns.length === 0 ? (
          <div className="px-2.5 py-3 text-center text-[11px] text-muted-foreground">
            {isMissing
              ? t("dataRequest.canvas.tableMissing")
              : t("dataRequest.rail.noColumns")}
          </div>
        ) : (
          columns.map((col) => {
            const checked = keepSet.has(col.name);
            const isJoined = joinedCols.has(col.name);
            return (
              <div
                key={col.name}
                className={cn(
                  "group relative flex items-center gap-1.5 px-2.5 py-1 text-xs transition-colors hover:bg-muted/40",
                  isJoined && "bg-sky-500/8",
                )}
                data-testid={`col-row-${table.alias}-${col.name}`}
              >
                <Handle
                  type="source"
                  position={Position.Left}
                  id={colHandleId("l", col.name)}
                  isConnectable={canEdit && !isMissing}
                  className={cn(
                    "!h-2.5 !w-2.5 !-left-1.5 !rounded-full !border !border-sky-600 !bg-background transition-transform hover:!scale-125",
                    isJoined && "!bg-sky-500",
                    !canEdit && "!opacity-40",
                  )}
                  data-testid={`handle-l-${table.alias}-${col.name}`}
                />
                <Checkbox
                  checked={checked}
                  disabled={!canEdit}
                  onCheckedChange={() =>
                    store.getState().toggleColumn(table.id, col.name)
                  }
                  className="h-3.5 w-3.5"
                  aria-label={`${table.alias}.${col.name}`}
                  data-testid={`col-check-${table.alias}-${col.name}`}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-mono text-[11px]",
                    !checked && "text-muted-foreground",
                  )}
                  title={col.name}
                >
                  {col.name}
                </span>
                {col.access && !col.inClear && (
                  <ColumnAccessChip
                    action={col.access as ColumnAction}
                    mask={col.mask as MaskKind | undefined}
                    compact
                  />
                )}
                {col.type && (
                  <span className="shrink-0 font-mono text-[9px] uppercase text-muted-foreground">
                    {col.type.split("(")[0]}
                  </span>
                )}
                {canComment && onPinComment && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPinComment(
                        { tableId: table.id, column: col.name },
                        { x: e.clientX, y: e.clientY },
                      );
                    }}
                    className="hidden shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:inline-flex"
                    title={`${table.alias}.${col.name}`}
                    aria-label={`Comment on ${table.alias}.${col.name}`}
                    data-testid={`comment-col-${table.alias}-${col.name}`}
                  >
                    <MessageSquarePlus className="h-3 w-3" />
                  </button>
                )}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={colHandleId("r", col.name)}
                  isConnectable={canEdit && !isMissing}
                  className={cn(
                    "!h-2.5 !w-2.5 !-right-1.5 !rounded-full !border !border-sky-600 !bg-background transition-transform hover:!scale-125",
                    isJoined && "!bg-sky-500",
                    !canEdit && "!opacity-40",
                  )}
                  data-testid={`handle-r-${table.alias}-${col.name}`}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});
