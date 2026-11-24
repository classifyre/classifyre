"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  MessageSquarePlus,
  Redo2,
  Send,
  TableProperties,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import type { QueryCatalog, QueryCatalogTable } from "@/lib/data-query";
import { apiErrorMessage } from "@/lib/data-query";
import { addDataRequestComment } from "@/lib/data-requests";
import { useRequest, useRequestStore } from "./store/request-context";
import { GRID_SNAP, snapToGrid } from "./store/request-store";
import { TABLE_DRAG_MIME } from "./request-catalog-rail";
import {
  TableNode,
  colHandleId,
  parseColHandleId,
  type RequestTableNode,
} from "./nodes/table-node";
import { JoinEdge, type RequestJoinEdge } from "./edges/join-edge";
import {
  RequestCommentPin,
  type RequestCommentPinNode,
} from "./nodes/request-comment-pin";

const NODE_TYPES = {
  "request-table": TableNode,
  "request-comment": RequestCommentPin,
};

const EDGE_TYPES = {
  "request-join": JoinEdge,
};

type CanvasNode = RequestTableNode | RequestCommentPinNode;

export interface RequestCanvasProps {
  catalog: QueryCatalog | null;
  canEdit: boolean;
  canComment: boolean;
}

export function RequestCanvas(props: RequestCanvasProps) {
  return (
    <ReactFlowProvider>
      <RequestCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function RequestCanvasInner({
  catalog,
  canEdit,
  canComment,
}: RequestCanvasProps) {
  const { t } = useTranslation();
  const store = useRequestStore();
  const { screenToFlowPosition } = useReactFlow();

  const caseId = useRequest((s) => s.caseId);
  const spec = useRequest((s) => s.spec);
  const request = useRequest((s) => s.request);
  const diagnostics = useRequest((s) => s.diagnostics);
  const undoCount = useRequest((s) => s.undoStack.length);
  const redoCount = useRequest((s) => s.redoStack.length);
  const saving = useRequest((s) => s.saving);
  const dirty = useRequest((s) => s.dirty);
  const commentToolActive = useRequest((s) => s.commentToolActive);

  const [composer, setComposer] = React.useState<{
    x: number;
    y: number;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [commentBody, setCommentBody] = React.useState("");
  const [postingComment, setPostingComment] = React.useState(false);

  const catalogByAsset = React.useMemo(() => {
    const map = new Map<string, QueryCatalogTable>();
    for (const src of catalog?.sources ?? []) {
      for (const tbl of src.tables) {
        map.set(tbl.assetId, tbl);
      }
    }
    return map;
  }, [catalog]);

  const errorTableIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const d of diagnostics) {
      if (d.level === "error" && d.tableId) set.add(d.tableId);
    }
    return set;
  }, [diagnostics]);

  const threadsById = React.useMemo(() => {
    const map = new Map<
      string,
      NonNullable<typeof request>["threads"][number]
    >();
    for (const th of request?.threads ?? []) {
      map.set(th.id, th);
    }
    return map;
  }, [request?.threads]);

  // Keep live drag positions smooth while only snapping & committing on drag end.
  const [dragPositions, setDragPositions] = React.useState<
    Record<string, { x: number; y: number }>
  >({});

  const nodes: CanvasNode[] = React.useMemo(() => {
    const tableNodes: RequestTableNode[] = spec.tables.map((table) => {
      const livePos = dragPositions[table.id];
      const catalogTable = catalog ? (catalogByAsset.get(table.assetId) ?? null) : null;
      return {
        id: table.id,
        type: "request-table",
        position: livePos ?? { x: table.x, y: table.y },
        draggable: canEdit,
        data: {
          table,
          catalogTable,
          canEdit,
          hasError: errorTableIds.has(table.id),
        },
      };
    });
    const pinNodes: RequestCommentPinNode[] = spec.pins.map((pin) => ({
      id: `pin:${pin.threadId}`,
      type: "request-comment",
      position: { x: pin.x, y: pin.y },
      draggable: false,
      data: {
        pin,
        thread: threadsById.get(pin.threadId) ?? null,
        canComment,
      },
    }));
    return [...tableNodes, ...pinNodes];
  }, [
    spec.tables,
    spec.pins,
    dragPositions,
    catalog,
    catalogByAsset,
    canEdit,
    errorTableIds,
    threadsById,
    canComment,
  ]);

  const edges: RequestJoinEdge[] = React.useMemo(() => {
    const tableMap = new Map(spec.tables.map((t) => [t.id, t]));
    return spec.joins.map((join) => {
      const leftTbl = tableMap.get(join.left.tableId);
      const rightTbl = tableMap.get(join.right.tableId);
      const leftIsLeft = (leftTbl?.x ?? 0) <= (rightTbl?.x ?? 0);
      return {
        id: join.id,
        type: "request-join",
        source: join.left.tableId,
        target: join.right.tableId,
        sourceHandle: colHandleId(leftIsLeft ? "r" : "l", join.left.column),
        targetHandle: colHandleId(leftIsLeft ? "l" : "r", join.right.column),
        data: { join, canEdit },
      };
    });
  }, [spec.joins, spec.tables, canEdit]);

  const onNodesChange = React.useCallback(
    (changes: NodeChange<Node>[]) => {
      if (!canEdit) return;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          if (change.dragging) {
            setDragPositions((prev) => ({
              ...prev,
              [change.id]: change.position!,
            }));
          } else {
            setDragPositions((prev) => {
              const next = { ...prev };
              delete next[change.id];
              return next;
            });
            store
              .getState()
              .moveTable(change.id, change.position.x, change.position.y);
          }
        }
      }
    },
    [canEdit, store],
  );

  const onConnect = React.useCallback(
    (connection: Connection) => {
      if (!canEdit) return;
      if (!connection.source || !connection.target) return;
      const leftCol = parseColHandleId(connection.sourceHandle);
      const rightCol = parseColHandleId(connection.targetHandle);
      if (!leftCol || !rightCol) return;
      store
        .getState()
        .addJoin(
          { tableId: connection.source, column: leftCol },
          { tableId: connection.target, column: rightCol },
          "INNER",
        );
    },
    [canEdit, store],
  );

  const onDragOver = React.useCallback(
    (event: React.DragEvent) => {
      if (!canEdit) return;
      if (event.dataTransfer.types.includes(TABLE_DRAG_MIME)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    },
    [canEdit],
  );

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      if (!canEdit) return;
      const raw = event.dataTransfer.getData(TABLE_DRAG_MIME);
      if (!raw) return;
      event.preventDefault();
      try {
        const parsed = JSON.parse(raw) as { assetId?: string };
        if (!parsed.assetId) return;
        const tbl = catalogByAsset.get(parsed.assetId);
        if (!tbl || !tbl.queryable) return;
        const pos = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        store.getState().addTable(tbl, {
          x: snapToGrid(pos.x - 120),
          y: snapToGrid(pos.y - 30),
        });
      } catch {
        // Ignore malformed drop payload
      }
    },
    [canEdit, catalogByAsset, screenToFlowPosition, store],
  );

  const onPaneClick = React.useCallback(
    (event: React.MouseEvent) => {
      if (!commentToolActive || !canComment) return;
      const flowPos = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setComposer({
        x: snapToGrid(flowPos.x),
        y: snapToGrid(flowPos.y),
        screenX: event.clientX,
        screenY: event.clientY,
      });
      setCommentBody("");
    },
    [commentToolActive, canComment, screenToFlowPosition],
  );

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composer || !commentBody.trim() || postingComment) return;
    setPostingComment(true);
    try {
      await store.getState().flushSave();
      const created = (await addDataRequestComment(caseId, {
        body: commentBody.trim(),
        anchor: null,
        x: composer.x,
        y: composer.y,
      })) as unknown as {
        pin?: { threadId: string; anchor: null; x: number; y: number };
        specVersion?: number;
      };
      if (created?.pin && typeof created.specVersion === "number") {
        store.getState().appendPin(created.pin, created.specVersion);
      }
      await store.getState().reloadFromServer();
      setComposer(null);
      setCommentBody("");
      store.getState().setCommentToolActive(false);
    } catch (err) {
      toast.error(await apiErrorMessage(err));
    } finally {
      setPostingComment(false);
    }
  };

  return (
    <div
      className={cn(
        "relative h-full w-full bg-background",
        commentToolActive && "cursor-crosshair",
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid="request-canvas"
    >
      {/* Floating drafting-sheet toolbar */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-xs border bg-background/95 p-1 shadow-xs">
        {canEdit && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              disabled={undoCount === 0}
              onClick={() => store.getState().undo()}
              title={t("dataRequest.canvas.undo")}
              data-testid="request-undo"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              disabled={redoCount === 0}
              onClick={() => store.getState().redo()}
              title={t("dataRequest.canvas.redo")}
              data-testid="request-redo"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
        {canComment && (
          <Button
            type="button"
            variant={commentToolActive ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() =>
              store.getState().setCommentToolActive(!commentToolActive)
            }
            data-testid="request-comment-tool"
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {t("dataRequest.canvas.pinComment")}
            </span>
          </Button>
        )}
        <span
          className="px-2 font-mono text-[10px] text-muted-foreground"
          data-testid="request-save-status"
        >
          {saving
            ? t("dataRequest.canvas.saving")
            : dirty
              ? t("dataRequest.canvas.unsaved")
              : t("dataRequest.canvas.saved")}
        </span>
      </div>

      <ReactFlow
        nodes={nodes as Node[]}
        edges={edges as Edge[]}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        connectionMode={ConnectionMode.Loose}
        snapToGrid
        snapGrid={[GRID_SNAP, GRID_SNAP]}
        onNodesChange={onNodesChange}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        fitView={spec.tables.length > 0}
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={GRID_SNAP}
          size={1}
          color="color-mix(in oklab, var(--border) 60%, transparent)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* Empty drafting sheet hint */}
      {spec.tables.length === 0 && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"
          data-testid="request-canvas-empty"
        >
          <div className="max-w-sm rounded-xs border border-dashed border-sky-500/40 bg-background/90 px-5 py-4 text-center shadow-xs">
            <TableProperties className="mx-auto mb-2 h-6 w-6 text-sky-600 dark:text-sky-400" />
            <p className="text-sm font-medium">
              {t("dataRequest.canvas.emptyTitle")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("dataRequest.canvas.emptyHint")}
            </p>
          </div>
        </div>
      )}

      {/* Comment composer popover anchored at click */}
      {composer && (
        <div
          className="fixed z-50 w-72 rounded-md border bg-popover p-3 shadow-md"
          style={{
            left: Math.min(composer.screenX, window.innerWidth - 300),
            top: Math.min(composer.screenY, window.innerHeight - 180),
          }}
          data-testid="request-comment-composer"
        >
          <form onSubmit={submitComment} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("dataRequest.canvas.pinComment")}
              </span>
              <button
                type="button"
                onClick={() => setComposer(null)}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <Textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder={t("dataRequest.canvas.commentPlaceholder")}
              rows={3}
              autoFocus
              className="text-xs"
            />
            <div className="flex justify-end gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setComposer(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-7 text-xs"
                disabled={!commentBody.trim() || postingComment}
              >
                <Send className="mr-1 h-3 w-3" />
                {t("dataRequest.canvas.postComment")}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
