"use client";

import * as React from "react";
import {
  Handle,
  NodeResizeControl,
  Position,
  ResizeControlVariant,
  useStore as useFlowStore,
  type NodeProps,
} from "@xyflow/react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  EyeOff,
  KeyRound,
  Link2,
  Lock,
  MessageSquarePlus,
  Shield,
  Sparkles,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { ColumnAccessChip } from "@/components/governance/column-access-chip";
import type { ColumnAction, MaskKind } from "@/lib/column-access";
import {
  colHandleId,
  formatRowCount,
  LOD_ZOOM_THRESHOLD,
  SCHEMA_TABLE_WIDTH,
  swatchCssColor,
  type SchemaTableFlowNode,
} from "../types";
import { SchemaFilterPopover } from "./schema-filter-popover";
import { TableColorSwatches } from "./table-color-swatches";
import { useSchemaTableActions } from "../schema-table-actions-context";

export const SchemaTableNode = React.memo(function SchemaTableNode({
  data,
  selected,
}: NodeProps<SchemaTableFlowNode>) {
  const { t } = useTranslation();
  // Boolean selector avoids re-rendering on every zoom tick
  const compact = useFlowStore((s) => s.transform[2] < LOD_ZOOM_THRESHOLD);

  const {
    table,
    catalogTable,
    joinedColumns,
    fkColumns,
    canEdit,
    showColumnSelection,
    showFilters,
    showComments,
    hasError,
    isHiddenRevealed,
    selectedTableIds,
  } = data;

  const {
    onToggleCollapsed,
    onSetTablesCollapsed,
    onToggleColumn,
    onSetTableColumns,
    onSetTablesAllColumns,
    onAddFilter,
    onRemoveFilter,
    onResizeTable,
    onSetColor,
    onFindLinks,
    onRemoveLinks,
    onSetHidden,
    onRemoveTables,
    onInspectTableData,
    onPinComment,
  } = useSchemaTableActions();

  const isMissing = catalogTable === null;
  const isLocked = Boolean(catalogTable && !catalogTable.canQuery);
  const hasRowFilter = Boolean(catalogTable?.rowFilter);
  const hiddenColumns = catalogTable?.hiddenColumns ?? 0;
  const rowCountLabel = formatRowCount(catalogTable?.rowCount);

  const joinedSet = React.useMemo(() => new Set(joinedColumns), [joinedColumns]);
  const fkSet = React.useMemo(
    () => new Set(fkColumns.map((c) => c.toLowerCase())),
    [fkColumns],
  );
  const keepSet = React.useMemo(() => new Set(table.keep), [table.keep]);

  const columns = React.useMemo(() => {
    if (catalogTable) return catalogTable.columns;
    const names = [...new Set([...table.keep, ...joinedColumns])];
    return names.map((name) => ({
      name,
      type: "",
      isPrimaryKey: undefined,
      nullable: undefined,
      access: undefined,
      mask: undefined,
      inClear: undefined,
    }));
  }, [catalogTable, table.keep, joinedColumns]);

  const parts = table.sqlName.split(".");
  const leafName = parts[parts.length - 1] ?? table.sqlName;
  const prefix = parts.slice(0, -1).join(".");
  const accentColor = hasError
    ? "var(--destructive)"
    : swatchCssColor(table.color);

  const targetIds = React.useMemo(
    () =>
      selected && selectedTableIds.includes(table.id) && selectedTableIds.length > 1
        ? selectedTableIds
        : [table.id],
    [selected, selectedTableIds, table.id],
  );

  const allSelected =
    columns.length > 0 && columns.every((c) => keepSet.has(c.name));
  const bodyHeight = table.height ?? 260;

  const cardBody = compact ? (
    <div
      className={cn(
        "flex min-h-[64px] flex-col justify-center rounded-xs border border-border bg-card px-3 py-2 text-card-foreground",
        selected && "outline-2 outline-[var(--cb-select)] outline-offset-1",
        hasError && "border-destructive",
        isMissing && "opacity-65 grayscale",
        isHiddenRevealed && "border-dashed opacity-50",
      )}
      style={{
        width: SCHEMA_TABLE_WIDTH,
        borderLeftWidth: 4,
        borderLeftColor: accentColor,
      }}
      data-testid={`request-table-node-${table.alias}`}
      data-table-id={table.id}
      data-lod="compact"
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate font-mono text-sm font-bold">{leafName}</span>
        <span className="shrink-0 rounded-xs border border-border/40 bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-foreground">
          {table.alias}
        </span>
        {isLocked && (
          <Lock
            className="h-3.5 w-3.5 shrink-0 text-[var(--cb-amber)]"
            aria-label={t("dataRequest.rail.lockedHint")}
          />
        )}
        {isMissing && (
          <AlertTriangle
            className="h-3.5 w-3.5 shrink-0 text-destructive"
            aria-label={t("dataRequest.canvas.tableMissing")}
          />
        )}
      </div>
      {prefix && (
        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {prefix}
        </div>
      )}
      {/* Keep invisible handles mounted so edges stay anchored during compact LOD */}
      {columns.map((col) => (
        <React.Fragment key={col.name}>
          <Handle
            type="source"
            position={Position.Left}
            id={colHandleId("l", col.name)}
            isConnectable={false}
            className="!pointer-events-none !h-1 !w-1 !border-0 !bg-transparent !opacity-0"
          />
          <Handle
            type="source"
            position={Position.Right}
            id={colHandleId("r", col.name)}
            isConnectable={false}
            className="!pointer-events-none !h-1 !w-1 !border-0 !bg-transparent !opacity-0"
          />
        </React.Fragment>
      ))}
    </div>
  ) : (
    <div
      className={cn(
        "relative rounded-xs border border-border bg-card text-card-foreground",
        selected && "outline-2 outline-[var(--cb-select)] outline-offset-1",
        hasError && "border-destructive",
        isMissing && "opacity-65 grayscale",
        isHiddenRevealed && "border-dashed opacity-50",
      )}
      style={{
        width: SCHEMA_TABLE_WIDTH,
        borderTopWidth: 3,
        borderTopColor: accentColor,
      }}
      data-testid={`request-table-node-${table.alias}`}
      data-table-id={table.id}
      data-lod="full"
    >
      {/* Header */}
      <div className="flex items-start gap-1 border-b border-border/50 bg-muted/30 px-2 py-1.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapsed(table.id);
          }}
          className="mt-0.5 shrink-0 rounded-xs p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={
            table.collapsed
              ? t("visualSchema.node.expand")
              : t("visualSchema.node.collapse")
          }
          data-testid={`vs-collapse-${table.alias}`}
        >
          {table.collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-xs font-semibold" title={table.sqlName}>
              {leafName}
            </span>
            <span className="shrink-0 rounded-xs border border-border/40 bg-muted px-1 py-0.2 font-mono text-[10px] font-semibold text-foreground">
              {table.alias}
            </span>
            {isLocked && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Lock
                    className="h-3 w-3 shrink-0 text-[var(--cb-amber)]"
                    aria-label={t("dataRequest.rail.lockedHint")}
                  />
                </TooltipTrigger>
                <TooltipContent>{t("dataRequest.rail.lockedHint")}</TooltipContent>
              </Tooltip>
            )}
            {hasRowFilter && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Shield
                    className="h-3 w-3 shrink-0 text-[var(--cb-amber)]"
                    aria-label={t("visualSchema.node.rowFilterActive")}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {t("visualSchema.node.rowFilterActive")}
                </TooltipContent>
              </Tooltip>
            )}
            {isMissing && (
              <AlertTriangle
                className="h-3 w-3 shrink-0 text-destructive"
                aria-label={t("dataRequest.canvas.tableMissing")}
              />
            )}
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            {prefix && <span className="truncate">{prefix}</span>}
            {rowCountLabel && (
              <span className="ml-auto shrink-0 tabular-nums" title={t("visualSchema.node.estimatedRows")}>
                {rowCountLabel}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {onInspectTableData && catalogTable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onInspectTableData(catalogTable);
              }}
              className="rounded-xs p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t("visualSchema.node.openData")}
              aria-label={t("visualSchema.node.openData")}
              data-testid={`vs-open-data-${table.alias}`}
            >
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
          {showComments && onPinComment && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPinComment(
                  { tableId: table.id },
                  { x: e.clientX, y: e.clientY },
                );
              }}
              className="rounded-xs p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t("dataRequest.canvas.pinComment")}
              aria-label={`Comment on ${table.sqlName}`}
              data-testid={`comment-table-${table.alias}`}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </button>
          )}
          {showFilters && (
            <SchemaFilterPopover
              tableId={table.id}
              columns={columns}
              filters={table.filters}
              canEdit={canEdit}
              onAdd={(filter) => onAddFilter(table.id, filter)}
              onRemove={(idx) => onRemoveFilter(table.id, idx)}
            />
          )}
          {canEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveTables([table.id]);
              }}
              className="rounded-xs p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              title={t("common.remove")}
              aria-label={`Remove ${table.sqlName}`}
              data-testid={`remove-table-${table.alias}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Column Selection Toolbar */}
      {!table.collapsed && showColumnSelection && canEdit && columns.length > 0 && (
        <div className="flex items-center justify-between border-b border-border/40 bg-muted/15 px-2.5 py-1 text-[10px] text-muted-foreground">
          <span className="font-mono tabular-nums">
            {keepSet.size}/{columns.length} {t("dataRequest.canvas.columnsKept")}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSetTableColumns(
                table.id,
                allSelected ? [] : columns.map((c) => c.name),
              );
            }}
            className="font-mono font-semibold text-[var(--accent-ink)] hover:underline"
          >
            {allSelected
              ? t("dataRequest.canvas.selectNone")
              : t("dataRequest.canvas.selectAll")}
          </button>
        </div>
      )}

      {/* Columns */}
      {table.collapsed ? (
        // Anchor handles on collapsed header so edges remain valid
        <>
          {columns.map((col) => (
            <React.Fragment key={col.name}>
              <Handle
                type="source"
                position={Position.Left}
                id={colHandleId("l", col.name)}
                isConnectable={false}
                className="!pointer-events-none !h-1 !w-1 !border-0 !bg-transparent !opacity-0"
              />
              <Handle
                type="source"
                position={Position.Right}
                id={colHandleId("r", col.name)}
                isConnectable={false}
                className="!pointer-events-none !h-1 !w-1 !border-0 !bg-transparent !opacity-0"
              />
            </React.Fragment>
          ))}
        </>
      ) : (
        <div
          className="nodrag nowheel divide-y divide-border/30 overflow-y-auto"
          style={{ maxHeight: bodyHeight }}
        >
          {columns.length === 0 ? (
            <div className="px-2.5 py-3 text-center text-[11px] text-muted-foreground">
              {isMissing
                ? t("dataRequest.canvas.tableMissing")
                : t("dataRequest.rail.noColumns")}
            </div>
          ) : (
            columns.map((col) => {
              const checked = keepSet.has(col.name);
              const isJoined = joinedSet.has(col.name);
              const isFk = fkSet.has(col.name.toLowerCase());
              const isPk = Boolean(col.isPrimaryKey);
              const shortType = col.type ? col.type.split("(")[0] : "";
              const typeDisplay =
                shortType && col.nullable === true
                  ? `${shortType}?`
                  : shortType;

              return (
                <div
                  key={col.name}
                  className={cn(
                    "group relative flex items-center gap-1.5 px-2.5 py-1 text-xs hover:bg-muted/40",
                    isJoined &&
                      "bg-[color-mix(in_oklab,var(--cb-select)_12%,transparent)]",
                  )}
                  data-testid={`col-row-${table.alias}-${col.name}`}
                >
                  <Handle
                    type="source"
                    position={Position.Left}
                    id={colHandleId("l", col.name)}
                    isConnectable={canEdit && !isMissing}
                    className={cn(
                      "vs-col-handle !-left-1.5",
                      isJoined && "vs-col-handle-joined",
                      !canEdit && "!opacity-35",
                    )}
                    data-testid={`handle-l-${table.alias}-${col.name}`}
                  />

                  {showColumnSelection && (
                    <Checkbox
                      checked={checked}
                      disabled={!canEdit}
                      onCheckedChange={() => onToggleColumn(table.id, col.name)}
                      className="h-3.5 w-3.5"
                      aria-label={`${table.alias}.${col.name}`}
                      data-testid={`col-check-${table.alias}-${col.name}`}
                    />
                  )}

                  {isPk ? (
                    <KeyRound
                      className="h-3 w-3 shrink-0 text-[var(--cb-amber)]"
                      aria-label="PK"
                    />
                  ) : isFk ? (
                    <Link2
                      className="h-3 w-3 shrink-0 text-[var(--cb-violet)]"
                      aria-label="FK"
                    />
                  ) : null}

                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate font-mono text-[11px]",
                      showColumnSelection && !checked && "text-muted-foreground",
                    )}
                    title={col.name}
                  >
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

                  {typeDisplay && (
                    <span className="shrink-0 font-mono text-[9px] uppercase text-muted-foreground">
                      {typeDisplay}
                    </span>
                  )}

                  {showComments && onPinComment && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPinComment(
                          { tableId: table.id, column: col.name },
                          { x: e.clientX, y: e.clientY },
                        );
                      }}
                      className="hidden shrink-0 rounded-xs p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:inline-flex"
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
                      "vs-col-handle !-right-1.5",
                      isJoined && "vs-col-handle-joined",
                      !canEdit && "!opacity-35",
                    )}
                    data-testid={`handle-r-${table.alias}-${col.name}`}
                  />
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Governance hidden-column footer count (never names hidden columns) */}
      {!table.collapsed && hiddenColumns > 0 && (
        <div
          className="flex items-center gap-1 border-t border-border/40 bg-muted/20 px-2.5 py-1 font-mono text-[10px] text-muted-foreground"
          data-testid={`vs-hidden-cols-${table.alias}`}
        >
          <EyeOff className="h-3 w-3 text-[var(--cb-amber)]" />
          <span>
            {t("visualSchema.node.hiddenColumns", { count: hiddenColumns })}
          </span>
        </div>
      )}

      {/* Bottom height-only resizer */}
      {canEdit && !table.collapsed && (
        <NodeResizeControl
          position="bottom"
          variant={ResizeControlVariant.Line}
          minWidth={SCHEMA_TABLE_WIDTH}
          maxWidth={SCHEMA_TABLE_WIDTH}
          minHeight={140}
          maxHeight={800}
          onResizeEnd={(_event, params) => {
            const nextHeight = Math.max(120, Math.min(800, Math.round(params.height - 64)));
            onResizeTable(table.id, nextHeight);
          }}
        />
      )}
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{cardBody}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {canEdit && (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                {t("visualSchema.context.color")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="p-2">
                <TableColorSwatches
                  value={table.color}
                  compact
                  onChange={(color) => onSetColor(targetIds, color)}
                />
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem onClick={() => onFindLinks(targetIds)}>
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              {t("visualSchema.context.findLinks")}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onRemoveLinks(targetIds)}>
              <Unlink className="mr-2 h-3.5 w-3.5" />
              {t("visualSchema.context.removeLinks")}
            </ContextMenuItem>
            {showColumnSelection && columns.length > 0 && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() => onSetTablesAllColumns(targetIds, true)}
                >
                  {t("dataRequest.canvas.selectAll")}
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => onSetTablesAllColumns(targetIds, false)}
                >
                  {t("dataRequest.canvas.selectNone")}
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
          </>
        )}

        <ContextMenuItem
          onClick={() => onSetTablesCollapsed(targetIds, !table.collapsed)}
        >
          {table.collapsed
            ? t("visualSchema.node.expand")
            : t("visualSchema.node.collapse")}
        </ContextMenuItem>

        {canEdit && (
          <ContextMenuItem
            onClick={() => onSetHidden(targetIds, !table.hidden)}
          >
            <EyeOff className="mr-2 h-3.5 w-3.5" />
            {table.hidden
              ? t("visualSchema.context.unhide")
              : t("visualSchema.context.hide")}
          </ContextMenuItem>
        )}

        {onInspectTableData && catalogTable && (
          <ContextMenuItem onClick={() => onInspectTableData(catalogTable)}>
            <ExternalLink className="mr-2 h-3.5 w-3.5" />
            {t("visualSchema.node.openData")}
          </ContextMenuItem>
        )}

        {showComments && onPinComment && (
          <ContextMenuItem
            onClick={() =>
              onPinComment({ tableId: table.id }, { x: 240, y: 200 })
            }
          >
            <MessageSquarePlus className="mr-2 h-3.5 w-3.5" />
            {t("dataRequest.canvas.pinComment")}
          </ContextMenuItem>
        )}

        {canEdit && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => onRemoveTables(targetIds)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              {t("visualSchema.context.remove")}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});
