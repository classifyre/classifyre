"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "@workspace/case-board/board.css";
import "./visual-schema.css";
import { TableProperties } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import type { QueryCatalogTable } from "@/lib/data-query";
import { CanvasFloatingToolbar } from "./canvas-floating-toolbar";
import { CanvasZoomDock } from "./canvas-zoom-dock";
import { SchemaRelationEdge } from "./edges/schema-relation-edge";
import {
  addTablesWithCapToast,
  indexCatalogByAsset,
  indexFkColumnsByAsset,
} from "./lib/catalog-helpers";
import {
  exportDiagramPng,
  exportDiagramSvg,
  exportSpecJson,
  parseImportedSpecJson,
} from "./lib/export-diagram";
import { SchemaTableNode } from "./nodes/schema-table-node";
import {
  SchemaTableActionsProvider,
  type SchemaTableActions,
} from "./schema-table-actions-context";
import {
  colHandleId,
  LEGACY_REQUEST_TABLE_DRAG_MIME,
  parseColHandleId,
  SCHEMA_DRAG_MIME,
  snapSchemaCoord,
  swatchMinimapHex,
  VISUAL_SCHEMA_GRID_SNAP,
  type CanvasInteractionMode,
  type SchemaRelationFlowEdge,
  type SchemaTableFlowNode,
  type VisualSchemaAdapter,
  type VisualSchemaExtensions,
} from "./types";

const BASE_NODE_TYPES: NodeTypes = {
  "schema-table": SchemaTableNode,
};

const EDGE_TYPES = {
  "schema-relation": SchemaRelationEdge,
};

export interface VisualSchemaCanvasHandle {
  fitNodes: (nodeIds: string[]) => void;
  fitAll: () => void;
}

export interface VisualSchemaCanvasProps {
  ref?: React.Ref<VisualSchemaCanvasHandle>;
  adapter: VisualSchemaAdapter;
  extensions?: VisualSchemaExtensions;
  selectedTableIds: string[];
  selectedJoinId: string | null;
  onSelectionChange: (tableIds: string[], joinId: string | null) => void;
  onFindLinks: (scopeTableIds?: string[]) => void;
  onArrangeConnected: () => void;
  onArrangeGrid: () => void;
  onExportDbml?: () => void;
}

export function VisualSchemaCanvas({
  ref,
  adapter,
  extensions,
  selectedTableIds,
  selectedJoinId,
  onSelectionChange,
  onFindLinks,
  onArrangeConnected,
  onArrangeGrid,
  onExportDbml,
}: VisualSchemaCanvasProps) {
  const { t } = useTranslation();
  const rf = useReactFlow();
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  const [interactionMode, setInteractionMode] =
    React.useState<CanvasInteractionMode>("pan");
  const [showGrid, setShowGrid] = React.useState(true);
  const [showMinimap, setShowMinimap] = React.useState(false);
  const [showHidden, setShowHidden] = React.useState(false);
  const [dragPositions, setDragPositions] = React.useState<
    Record<string, { x: number; y: number }>
  >({});

  const { spec, catalog, capabilities, diagnostics } = adapter;
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? 0 : 200;

  React.useImperativeHandle(
    ref,
    () => ({
      fitNodes: (nodeIds: string[]) => {
        const targets = rf
          .getNodes()
          .filter((n) => nodeIds.includes(n.id));
        if (targets.length > 0) {
          void rf.fitView({ nodes: targets, padding: 0.35, duration });
        }
      },
      fitAll: () => {
        void rf.fitView({ padding: 0.2, duration });
      },
    }),
    [rf, duration],
  );

  const nodeTypes = React.useMemo<NodeTypes>(
    () => ({
      ...BASE_NODE_TYPES,
      ...(extensions?.extraNodeTypes ?? {}),
    }),
    [extensions?.extraNodeTypes],
  );

  const catalogByAsset = React.useMemo(
    () => indexCatalogByAsset(catalog),
    [catalog],
  );

  const fkColumnsByAsset = React.useMemo(
    () => indexFkColumnsByAsset(catalog),
    [catalog],
  );

  const errorTableIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const d of diagnostics) {
      if (d.level === "error" && d.tableId) set.add(d.tableId);
    }
    return set;
  }, [diagnostics]);

  const hiddenCount = React.useMemo(
    () => spec.tables.filter((tbl) => tbl.hidden).length,
    [spec.tables],
  );

  const visibleTables = React.useMemo(
    () => (showHidden ? spec.tables : spec.tables.filter((tbl) => !tbl.hidden)),
    [spec.tables, showHidden],
  );

  const visibleTableById = React.useMemo(
    () => new Map(visibleTables.map((tbl) => [tbl.id, tbl])),
    [visibleTables],
  );

  const joinedColsByTable = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const j of spec.joins) {
      const l = map.get(j.left.tableId) ?? new Set<string>();
      l.add(j.left.column);
      map.set(j.left.tableId, l);
      const r = map.get(j.right.tableId) ?? new Set<string>();
      r.add(j.right.column);
      map.set(j.right.tableId, r);
    }
    return map;
  }, [spec.joins]);

  // Compute focus neighborhood for subtle dimming when inspecting a single table or join
  const focusState = React.useMemo(() => {
    if (selectedJoinId) {
      const join = spec.joins.find((j) => j.id === selectedJoinId);
      if (join) {
        return {
          active: true,
          nodeIds: new Set([join.left.tableId, join.right.tableId]),
          edgeIds: new Set([join.id]),
        };
      }
    }
    if (selectedTableIds.length > 0 && spec.tables.length > 2) {
      const nodeIds = new Set(selectedTableIds);
      const edgeIds = new Set<string>();
      for (const j of spec.joins) {
        if (nodeIds.has(j.left.tableId) || nodeIds.has(j.right.tableId)) {
          nodeIds.add(j.left.tableId);
          nodeIds.add(j.right.tableId);
          edgeIds.add(j.id);
        }
      }
      return { active: true, nodeIds, edgeIds };
    }
    return { active: false, nodeIds: new Set<string>(), edgeIds: new Set<string>() };
  }, [selectedTableIds, selectedJoinId, spec.joins, spec.tables.length]);

  const handleToggleJoinType = React.useCallback(
    (joinId: string) => {
      const target = spec.joins.find((j) => j.id === joinId);
      if (!target) return;
      adapter.updateJoin(joinId, {
        type: target.type === "INNER" ? "LEFT" : "INNER",
      });
    },
    [spec.joins, adapter],
  );

  const handleSetTablesAllColumns = React.useCallback(
    (tableIds: string[], selectAll: boolean) => {
      const updates: Record<string, string[]> = {};
      for (const id of tableIds) {
        const tbl = spec.tables.find((item) => item.id === id);
        if (!tbl) continue;
        if (!selectAll) {
          updates[id] = [];
          continue;
        }
        const cat = catalogByAsset.get(tbl.assetId);
        if (cat) {
          updates[id] = cat.columns.map((c) => c.name);
        } else {
          const joined = [...(joinedColsByTable.get(id) ?? [])];
          updates[id] = [...new Set([...tbl.keep, ...joined])];
        }
      }
      adapter.setTablesColumns(updates);
    },
    [spec.tables, catalogByAsset, joinedColsByTable, adapter],
  );

  const tableActions = React.useMemo<SchemaTableActions>(
    () => ({
      onToggleCollapsed: adapter.toggleTableCollapsed,
      onSetTablesCollapsed: adapter.setTablesCollapsed,
      onToggleColumn: adapter.toggleColumn,
      onSetTableColumns: adapter.setTableColumns,
      onSetTablesAllColumns: handleSetTablesAllColumns,
      onAddFilter: adapter.addFilter,
      onRemoveFilter: adapter.removeFilter,
      onResizeTable: adapter.resizeTable,
      onSetColor: adapter.setTableColor,
      onFindLinks: (ids) => onFindLinks(ids),
      onRemoveLinks: adapter.removeTableJoins,
      onSetHidden: adapter.setTablesHidden,
      onRemoveTables: adapter.removeTables,
      onInspectTableData: extensions?.onInspectTableData,
      onPinComment: extensions?.onPinComment,
    }),
    [
      adapter,
      handleSetTablesAllColumns,
      onFindLinks,
      extensions?.onInspectTableData,
      extensions?.onPinComment,
    ],
  );

  const nodes: Node[] = React.useMemo(() => {
    const selectedSet = new Set(selectedTableIds);
    const tableNodes: SchemaTableFlowNode[] = visibleTables.map((table) => {
      const livePos = dragPositions[table.id];
      const catalogTable = catalog
        ? (catalogByAsset.get(table.assetId) ?? null)
        : null;
      const isDimmed = focusState.active && !focusState.nodeIds.has(table.id);
      return {
        id: table.id,
        type: "schema-table",
        position: livePos ?? { x: table.x, y: table.y },
        draggable: capabilities.canEdit,
        selected: selectedSet.has(table.id),
        className: isDimmed ? "vs-dim" : undefined,
        data: {
          table,
          catalogTable,
          joinedColumns: [...(joinedColsByTable.get(table.id) ?? [])],
          fkColumns: [...(fkColumnsByAsset.get(table.assetId) ?? [])],
          canEdit: capabilities.canEdit,
          showColumnSelection: capabilities.showColumnSelection,
          showFilters: capabilities.showFilters,
          showComments: capabilities.showComments,
          hasError: errorTableIds.has(table.id),
          isHiddenRevealed: Boolean(table.hidden),
          selectedTableIds,
        },
      };
    });
    return [...tableNodes, ...(extensions?.extraNodes ?? [])];
  }, [
    visibleTables,
    dragPositions,
    catalog,
    catalogByAsset,
    focusState,
    selectedTableIds,
    capabilities,
    joinedColsByTable,
    fkColumnsByAsset,
    errorTableIds,
    extensions?.extraNodes,
  ]);

  const edges: SchemaRelationFlowEdge[] = React.useMemo(() => {
    const selectedSet = new Set(selectedTableIds);
    return spec.joins
      .filter(
        (j) =>
          visibleTableById.has(j.left.tableId) &&
          visibleTableById.has(j.right.tableId),
      )
      .map((join) => {
        const leftTbl = visibleTableById.get(join.left.tableId);
        const rightTbl = visibleTableById.get(join.right.tableId);
        const leftX = dragPositions[join.left.tableId]?.x ?? leftTbl?.x ?? 0;
        const rightX = dragPositions[join.right.tableId]?.x ?? rightTbl?.x ?? 0;
        const leftIsLeft = leftX <= rightX;
        const incident =
          selectedSet.has(join.left.tableId) ||
          selectedSet.has(join.right.tableId);
        const isDimmed = focusState.active && !focusState.edgeIds.has(join.id);
        return {
          id: join.id,
          type: "schema-relation",
          source: join.left.tableId,
          target: join.right.tableId,
          sourceHandle: colHandleId(leftIsLeft ? "r" : "l", join.left.column),
          targetHandle: colHandleId(leftIsLeft ? "l" : "r", join.right.column),
          selected: selectedJoinId === join.id,
          className: isDimmed ? "vs-dim" : undefined,
          data: {
            join,
            canEdit: capabilities.canEdit,
            incidentToSelected: incident,
            onToggleJoinType: handleToggleJoinType,
            onRemoveJoin: adapter.removeJoin,
          },
        };
      });
  }, [
    spec.joins,
    visibleTableById,
    dragPositions,
    selectedTableIds,
    selectedJoinId,
    focusState,
    capabilities.canEdit,
    handleToggleJoinType,
    adapter.removeJoin,
  ]);

  const onNodesChange = React.useCallback(
    (changes: NodeChange<Node>[]) => {
      const committedMoves: Record<string, { x: number; y: number }> = {};
      const liveUpdates: Record<string, { x: number; y: number }> = {};
      const clearedDragIds: string[] = [];
      let selectionChanged = false;
      const nextSelected = new Set(selectedTableIds);

      for (const change of changes) {
        if (change.type === "select") {
          if (visibleTableById.has(change.id)) {
            if (change.selected) nextSelected.add(change.id);
            else nextSelected.delete(change.id);
            selectionChanged = true;
          }
        } else if (
          change.type === "position" &&
          change.position &&
          capabilities.canEdit &&
          visibleTableById.has(change.id)
        ) {
          if (change.dragging) {
            liveUpdates[change.id] = change.position;
          } else {
            clearedDragIds.push(change.id);
            committedMoves[change.id] = {
              x: snapSchemaCoord(change.position.x),
              y: snapSchemaCoord(change.position.y),
            };
          }
        }
      }

      if (Object.keys(liveUpdates).length > 0) {
        setDragPositions((prev) => ({ ...prev, ...liveUpdates }));
      }
      if (clearedDragIds.length > 0) {
        setDragPositions((prev) => {
          const next = { ...prev };
          for (const id of clearedDragIds) delete next[id];
          return next;
        });
      }
      if (Object.keys(committedMoves).length > 0) {
        adapter.moveTables(committedMoves);
      }
      if (selectionChanged) {
        const list = [...nextSelected];
        onSelectionChange(list, list.length > 0 ? null : selectedJoinId);
      }
    },
    [
      capabilities.canEdit,
      visibleTableById,
      adapter,
      selectedTableIds,
      selectedJoinId,
      onSelectionChange,
    ],
  );

  const onConnect = React.useCallback(
    (connection: Connection) => {
      if (!capabilities.canEdit) return;
      if (!connection.source || !connection.target) return;
      const leftCol = parseColHandleId(connection.sourceHandle);
      const rightCol = parseColHandleId(connection.targetHandle);
      if (!leftCol || !rightCol) return;
      adapter.addJoin(
        { tableId: connection.source, column: leftCol },
        { tableId: connection.target, column: rightCol },
        { type: "INNER", origin: "manual" },
      );
    },
    [capabilities.canEdit, adapter],
  );

  const onDragOver = React.useCallback(
    (event: React.DragEvent) => {
      if (!capabilities.canEdit) return;
      if (
        event.dataTransfer.types.includes(SCHEMA_DRAG_MIME) ||
        event.dataTransfer.types.includes(LEGACY_REQUEST_TABLE_DRAG_MIME)
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    },
    [capabilities.canEdit],
  );

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      if (!capabilities.canEdit) return;
      const rawMulti = event.dataTransfer.getData(SCHEMA_DRAG_MIME);
      const rawLegacy = event.dataTransfer.getData(LEGACY_REQUEST_TABLE_DRAG_MIME);
      const raw = rawMulti || rawLegacy;
      if (!raw) return;
      event.preventDefault();
      try {
        const parsed = JSON.parse(raw) as {
          assetIds?: string[];
          assetId?: string;
        };
        const ids = parsed.assetIds ?? (parsed.assetId ? [parsed.assetId] : []);
        const picked: QueryCatalogTable[] = [];
        for (const id of ids) {
          const tbl = catalogByAsset.get(id);
          if (tbl && (tbl.queryable || capabilities.allowLockedTables)) {
            picked.push(tbl);
          }
        }
        if (picked.length === 0) return;
        const basePos = rf.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        const positions = picked.map((_, idx) => ({
          x: snapSchemaCoord(basePos.x - 130 + (idx % 3) * 300),
          y: snapSchemaCoord(basePos.y - 30 + Math.floor(idx / 3) * 260),
        }));
        addTablesWithCapToast(adapter, picked, positions, t);
      } catch {
        // Ignore malformed drop payload
      }
    },
    [
      capabilities.canEdit,
      capabilities.allowLockedTables,
      catalogByAsset,
      rf,
      adapter,
      t,
    ],
  );

  // Keyboard shortcuts
  const onEscape = extensions?.onEscape;
  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") {
        if (!capabilities.canEdit) return;
        e.preventDefault();
        if (e.shiftKey) adapter.redo();
        else adapter.undo();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        onSelectionChange(
          visibleTables.map((tbl) => tbl.id),
          null,
        );
        return;
      }
      if (!mod && !e.altKey) {
        if (key === "p") {
          setInteractionMode("pan");
          return;
        }
        if (key === "s") {
          setInteractionMode("select");
          return;
        }
        if (e.shiftKey && (e.key === "!" || e.code === "Digit1")) {
          e.preventDefault();
          void rf.fitView({ padding: 0.2, duration });
          return;
        }
        if (e.shiftKey && (e.key === "@" || e.code === "Digit2")) {
          e.preventDefault();
          const selectedNodes = rf
            .getNodes()
            .filter((n) => selectedTableIds.includes(n.id));
          if (selectedNodes.length > 0) {
            void rf.fitView({ nodes: selectedNodes, padding: 0.35, duration });
          }
          return;
        }
        if (key === "escape") {
          onSelectionChange([], null);
          onEscape?.();
          return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && capabilities.canEdit) {
          if (selectedTableIds.length > 0) {
            e.preventDefault();
            adapter.removeTables(selectedTableIds);
            onSelectionChange([], null);
          } else if (selectedJoinId) {
            e.preventDefault();
            adapter.removeJoin(selectedJoinId);
            onSelectionChange([], null);
          }
        }
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [
    capabilities.canEdit,
    adapter,
    visibleTables,
    selectedTableIds,
    selectedJoinId,
    onSelectionChange,
    onEscape,
    rf,
    duration,
  ]);

  const getViewportEl = (): HTMLElement | null =>
    wrapperRef.current?.querySelector<HTMLElement>(".react-flow__viewport") ??
    null;

  const handleExportPng = async (pixelRatio: 1 | 2, monochrome: boolean) => {
    const vp = getViewportEl();
    if (!vp) return;
    try {
      await exportDiagramPng({
        viewportEl: vp,
        nodes: rf.getNodes(),
        pixelRatio,
        monochrome,
        filename: monochrome
          ? "visual-schema-bw.png"
          : `visual-schema-${pixelRatio}x.png`,
      });
    } catch {
      toast.error(t("visualSchema.export.failed"));
    }
  };

  const handleExportSvg = async () => {
    const vp = getViewportEl();
    if (!vp) return;
    try {
      await exportDiagramSvg({
        viewportEl: vp,
        nodes: rf.getNodes(),
        filename: "visual-schema.svg",
      });
    } catch {
      toast.error(t("visualSchema.export.failed"));
    }
  };

  const handleImportJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseImportedSpecJson(text);
      if (!parsed.ok) {
        toast.error(parsed.error);
        return;
      }
      const imported = adapter.importSpec(parsed.spec);
      const importedCount =
        imported !== undefined && imported !== null
          ? imported.tables.length
          : parsed.spec.tables.length;
      toast.success(
        t("visualSchema.export.imported", {
          tables: importedCount,
        }),
      );
      if (importedCount < parsed.spec.tables.length) {
        toast.warning(
          t("visualSchema.toast.truncatedTables", {
            added: importedCount,
            total: parsed.spec.tables.length,
          }),
        );
      }
    } catch {
      toast.error(t("visualSchema.export.failed"));
    }
  };

  return (
    <div
      ref={wrapperRef}
      tabIndex={0}
      className={cn(
        "visual-schema relative h-full w-full bg-background outline-none",
        extensions?.paneClassName,
      )}
      style={{ position: "relative", width: "100%", height: "100%" }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid={extensions?.canvasTestId ?? "request-canvas"}
      data-interaction-mode={interactionMode}
    >
      <SchemaTableActionsProvider value={tableActions}>
        <ReactFlow
        className={
          interactionMode === "pan" ? "vs-tool-pan" : "vs-tool-select"
        }
        nodes={nodes}
        edges={edges as Edge[]}
        nodeTypes={nodeTypes}
        edgeTypes={EDGE_TYPES}
        connectionMode={ConnectionMode.Loose}
        snapToGrid
        snapGrid={[VISUAL_SCHEMA_GRID_SNAP, VISUAL_SCHEMA_GRID_SNAP]}
        panOnDrag={interactionMode === "pan"}
        selectionOnDrag={interactionMode === "select"}
        selectionMode={SelectionMode.Partial}
        minZoom={0.15}
        maxZoom={2}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onEdgeClick={(_event, edge) => {
          onSelectionChange([], edge.id);
        }}
        onPaneClick={(event) => {
          onSelectionChange([], null);
          if (extensions?.onPaneClick) {
            const flowPos = rf.screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            });
            extensions.onPaneClick(event, flowPos);
          }
        }}
        fitView={visibleTables.length > 0}
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        {extensions?.topLeftSlot && (
          <Panel position="top-left" className="z-20 m-3">
            {extensions.topLeftSlot}
          </Panel>
        )}

        <Panel position="top-right" className="z-20 m-3">
          <CanvasFloatingToolbar
            tableCount={spec.tables.length}
            hiddenCount={hiddenCount}
            showHidden={showHidden}
            onToggleShowHidden={() => setShowHidden((v) => !v)}
            onUnhideAll={() => {
              const hiddenIds = spec.tables
                .filter((tbl) => tbl.hidden)
                .map((tbl) => tbl.id);
              if (hiddenIds.length > 0) adapter.setTablesHidden(hiddenIds, false);
              setShowHidden(false);
            }}
            showGrid={showGrid}
            onToggleGrid={() => setShowGrid((v) => !v)}
            canEdit={capabilities.canEdit}
            onArrangeConnected={onArrangeConnected}
            onArrangeGrid={onArrangeGrid}
            onFindLinks={() => onFindLinks()}
            onClearCanvas={adapter.clearCanvas}
            onExportPng={(ratio, mono) => void handleExportPng(ratio, mono)}
            onExportSvg={() => void handleExportSvg()}
            onExportJson={() => exportSpecJson(spec)}
            onExportDbml={onExportDbml}
            onImportJson={(f) => void handleImportJson(f)}
          />
        </Panel>

        <Panel position="bottom-left" className="z-20 m-3">
          <CanvasZoomDock
            interactionMode={interactionMode}
            onChangeMode={setInteractionMode}
            showMinimap={showMinimap}
            onToggleMinimap={() => setShowMinimap((v) => !v)}
          />
        </Panel>

        {showMinimap && (
          <MiniMap
            pannable
            zoomable
            className="!rounded-[6px] !border-2 !border-border !bg-card"
            nodeColor={(node) => {
              const data = node.data as { table?: { color?: Parameters<typeof swatchMinimapHex>[0] } } | undefined;
              return swatchMinimapHex(data?.table?.color);
            }}
          />
        )}

        {showGrid && (
          <Background
            variant={BackgroundVariant.Lines}
            gap={VISUAL_SCHEMA_GRID_SNAP}
            size={1}
          />
        )}
        </ReactFlow>
      </SchemaTableActionsProvider>

      {/* Empty state */}
      {spec.tables.length === 0 && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"
          data-testid="request-canvas-empty"
        >
          <div className="max-w-sm rounded-xs border border-dashed border-border bg-card px-5 py-4 text-center">
            <TableProperties className="mx-auto mb-2 h-6 w-6 text-foreground" />
            <p className="text-sm font-medium">
              {t("dataRequest.canvas.emptyTitle")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("dataRequest.canvas.emptyHint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
