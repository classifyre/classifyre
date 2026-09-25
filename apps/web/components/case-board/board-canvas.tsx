"use client";

import * as React from "react";
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  useStore as useFlowStore,
  useStoreApi,
  type Connection,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
  type OnConnectEnd,
  type OnNodeDrag,
  type Viewport,
} from "@xyflow/react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import type { BoardEndpoint } from "@workspace/schemas/case-board";
import { ContextMenu, ContextMenuTrigger } from "@workspace/ui/components/context-menu";
import { cn } from "@workspace/ui/lib/utils";
import { api } from "@workspace/api-client";
import { shortestPath } from "@/components/graph-explorer/graph-utils";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "./store/board-context";
import { addEvidence, addNote, attachFinding, combine, moveFindings, moveItems, type FindingMove, type Move } from "./store/commands";
import {
  edgeTarget,
  isFindingData,
  isItemData,
  lodOf,
  projectEdges,
  projectNodes,
  type BoardEdge,
  type BoardNode,
  type ProjectionView,
} from "./store/projection";
import { SUGGESTED_AUTO_LIMIT, type DrawerKind, type UiState } from "./store/ui-store";
import { parseFindingNodeId } from "./store/relations";
import type { BoardDomain, ItemKind } from "./store/types";
import { EvidenceBubble } from "./nodes/evidence-bubble";
import { HypothesisCard } from "./nodes/hypothesis-card";
import { NoteNode } from "./nodes/note-node";
import { FrameNode } from "./nodes/frame-node";
import { CommentPin } from "./nodes/comment-pin";
import { SuggestedNode } from "./nodes/suggested-node";
import { FindingNode } from "./nodes/finding-node";
import { ContainsEdge, SystemEdge } from "./edges/system-edge";
import { LinkEdge } from "./edges/link-edge";
import { StanceEdge } from "./edges/stance-edge";
import { EdgeMarkers } from "./edges/markers";
import { BoardContextMenuContent, targetFromNodeEvent, type MenuTarget } from "./ui/board-context-menu";
import { FrameDrawOverlay } from "./ui/frame-draw-overlay";
import { LinkPopover } from "./ui/link-popover";
import { ComposerPopover } from "./ui/composer-popover";
import { ToolDock } from "./ui/tool-dock";
import { ZoomControls } from "./ui/zoom-controls";
import { ViewPopover } from "./ui/view-popover";
import { useAutoPlace } from "./hooks/use-auto-place";
import { useBoardShortcuts } from "./hooks/use-board-shortcuts";

// Module scope: React Flow re-mounts every node when these objects change.
const nodeTypes = {
  evidence: EvidenceBubble,
  finding: FindingNode,
  hypothesis: HypothesisCard,
  note: NoteNode,
  frame: FrameNode,
  comment: CommentPin,
  suggested: SuggestedNode,
} satisfies NodeTypes;

const edgeTypes = {
  system: SystemEdge,
  link: LinkEdge,
  stance: StanceEdge,
  // Relations to suggested neighbours read like any other system edge.
  suggested: SystemEdge,
  contains: ContainsEdge,
} satisfies EdgeTypes;

export const BOARD_DRAG_MIME = "application/x-classifyre-board-evidence";

const dataKey = (n: BoardNode) =>
  isItemData(n.data)
    ? n.data.itemId
    : isFindingData(n.data)
      ? `${n.data.findingOf}|${n.data.findingId}|${n.data.attached}`
      : (n.data as { suggestedKey: string }).suggestedKey;

/**
 * Fold a fresh projection into React Flow's node state without losing what
 * React Flow owns: measured sizes, selection, and a drag or resize in
 * progress. Unchanged nodes keep their identity, so React Flow skips them.
 */
export function mergeNodes(prev: BoardNode[], next: BoardNode[]): BoardNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  let changed = prev.length !== next.length;
  const out = next.map((p, index) => {
    const old = byId.get(p.id);
    if (!old) {
      changed = true;
      return p;
    }
    const position = old.dragging ? old.position : p.position;
    const width = old.resizing ? old.width : p.width;
    const height = old.resizing ? old.height : p.height;
    const same =
      old.type === p.type &&
      old.position.x === position.x &&
      old.position.y === position.y &&
      old.parentId === p.parentId &&
      old.zIndex === p.zIndex &&
      old.width === width &&
      old.height === height &&
      old.hidden === p.hidden &&
      old.draggable === p.draggable &&
      old.connectable === p.connectable &&
      old.dragHandle === p.dragHandle &&
      old.className === p.className &&
      dataKey(old) === dataKey(p);
    if (same) {
      if (prev[index] !== old) changed = true;
      return old;
    }
    changed = true;
    return {
      ...p,
      position,
      width,
      height,
      data: dataKey(old) === dataKey(p) ? old.data : p.data,
      selected: old.selected,
      dragging: old.dragging,
      resizing: old.resizing,
      measured: old.measured,
    };
  });
  return changed ? out : prev;
}

const LINKABLE: ReadonlySet<ItemKind> = new Set(["EVIDENCE", "NOTE", "HYPOTHESIS"]);

/** Which drops make sense (PRD §5.4); the server enforces the same rules. */
export function validPair(
  a: ItemKind | "SUGGESTED" | undefined,
  b: ItemKind | "SUGGESTED" | undefined,
  same: boolean,
): boolean {
  if (!a || !b || same) return false;
  if (a === "SUGGESTED" || b === "SUGGESTED") return false;
  if (!LINKABLE.has(a) || !LINKABLE.has(b)) return false;
  if (a === "HYPOTHESIS" && b === "HYPOTHESIS") return false;
  return true;
}

/** The board endpoint a node stands for: an item, or one finding of an evidence item. */
function endpointOf(nodeId: string): BoardEndpoint {
  const finding = parseFindingNodeId(nodeId);
  return finding ? { itemId: finding.itemId, findingId: finding.findingId } : { itemId: nodeId };
}

function pointOf(event: MouseEvent | TouchEvent): { x: number; y: number } {
  if ("changedTouches" in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0]!;
    return { x: touch.clientX, y: touch.clientY };
  }
  const mouse = event as MouseEvent;
  return { x: mouse.clientX, y: mouse.clientY };
}

/** The item (and finding row) under a screen point: drops land on bodies, not just handles. */
function hitTest(point: { x: number; y: number }): BoardEndpoint | null {
  for (const el of document.elementsFromPoint(point.x, point.y)) {
    const node = (el as HTMLElement).closest<HTMLElement>(".react-flow__node");
    const id = node?.dataset.id;
    if (!node || !id) continue;
    return endpointOf(id);
  }
  return null;
}

const VIEWPORT_KEY = (caseId: string) => `classifyre.caseBoard.viewport.${caseId}`;

function readViewport(caseId: string): Viewport | null {
  try {
    const raw = window.localStorage.getItem(VIEWPORT_KEY(caseId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Viewport;
    return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) ? v : null;
  } catch {
    return null;
  }
}

function writeViewport(caseId: string, v: Viewport): void {
  try {
    window.localStorage.setItem(VIEWPORT_KEY(caseId), JSON.stringify(v));
  } catch {
    // The viewport is a per-viewer convenience (Q2); losing it is harmless.
  }
}

/** How much of the canvas an open drawer covers, so a fly-to lands beside it. */
function drawerOverlap(): number {
  const drawer = document.querySelector<HTMLElement>("[data-testid=board-drawer]");
  const canvas = document.querySelector<HTMLElement>(".case-board .react-flow");
  if (!drawer || !canvas) return 0;
  return Math.max(0, canvas.getBoundingClientRect().right - drawer.getBoundingClientRect().left);
}

export function useFlyTo() {
  const rf = useReactFlow();
  const ui = useUiStore();
  return React.useCallback(
    (itemId: string) => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const covered = drawerOverlap();
      void rf.fitView({
        nodes: [{ id: itemId }],
        duration: reduced ? 0 : 400,
        maxZoom: 1.1,
        padding: covered > 0 ? { x: "12%", y: "25%", right: `${Math.round(covered) + 48}px` } : 0.45,
      });
      ui.getState().set({ pulse: itemId });
      window.setTimeout(() => {
        if (ui.getState().pulse === itemId) ui.getState().set({ pulse: null });
      }, 1400);
    },
    [rf, ui],
  );
}

export function BoardCanvas({ onTidyUp }: { onTidyUp: () => void }) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const rf = useReactFlow<BoardNode, BoardEdge>();
  const store = useBoardStore();
  const ui = useUiStore();
  const caseId = useBoard((s) => s.caseId);
  const flyTo = useFlyTo();
  const lod = useFlowStore((s) => lodOf(s.transform[2]));

  const items = useBoard((s) => s.items);
  const links = useBoard((s) => s.links);
  const bubbles = useBoard((s) => s.bubbles);
  const threads = useBoard((s) => s.threads);
  const supports = useBoard((s) => s.supports);
  const systemEdges = useBoard((s) => s.systemEdges);
  const suggested = useBoard((s) => s.suggested);
  const itemByAsset = useBoard((s) => s.itemByAsset);
  const itemByFinding = useBoard((s) => s.itemByFinding);
  const graveyard = useBoard((s) => s.graveyard);
  const truncated = useBoard((s) => s.truncated);
  const readOnly = useBoard((s) => s.readOnly);
  const loaded = useBoard((s) => s.loaded);

  const tool = useUi((s) => s.tool);
  const view = useUi((s) => s.view);
  const showAllRows = useUi((s) => s.showAllRows);
  const expandedUnattached = useUi((s) => s.expandedUnattached);
  const hiddenSuggestions = useUi((s) => s.hiddenSuggestions);
  const focusHypothesisItemId = useUi((s) => s.focusHypothesisItemId);
  const spotlight = useUi((s) => s.spotlight);
  const path = useUi((s) => s.path);
  const connecting = useUi((s) => s.connecting);

  const domain: BoardDomain = React.useMemo(
    () => ({
      items,
      links,
      bubbles,
      threads,
      supports,
      systemEdges,
      suggested,
      itemByAsset,
      itemByFinding,
      graveyard,
      truncated,
    }),
    [items, links, bubbles, threads, supports, systemEdges, suggested, itemByAsset, itemByFinding, graveyard, truncated],
  );

  const showSuggested =
    view.suggested === "show" || (view.suggested === "auto" && suggested.size <= SUGGESTED_AUTO_LIMIT);
  const projView: ProjectionView = React.useMemo(
    () => ({
      lod,
      readOnly,
      showSuggested,
      hiddenSuggestions,
      showResolvedComments: view.showResolvedComments,
      showAllRows,
      expandedUnattached,
      edgeClasses: new Set(
        [view.lineage && "FLOW", view.duplicates && "IDENTITY", view.references && "REFERENCE"].filter(
          (c): c is string => !!c,
        ),
      ),
    }),
    [lod, readOnly, showSuggested, hiddenSuggestions, view, showAllRows, expandedUnattached],
  );

  const projectedNodes = React.useMemo(() => projectNodes(domain, projView), [domain, projView]);
  const projectedEdges = React.useMemo(
    () => projectEdges(domain, projView, projectedNodes),
    [domain, projView, projectedNodes],
  );

  const [rfNodes, setRfNodes] = React.useState<BoardNode[]>([]);
  React.useEffect(() => setRfNodes((prev) => mergeNodes(prev, projectedNodes)), [projectedNodes]);
  const [selectedEdgeIds, setSelectedEdgeIds] = React.useState<ReadonlySet<string>>(new Set());
  const [menuTarget, setMenuTarget] = React.useState<MenuTarget | null>(null);
  const dragStart = React.useRef(new Map<string, { x: number; y: number; parentId: string | null }>());

  useAutoPlace();

  // ── First view: the saved viewport, or fit once the board has content ──────
  const fitted = React.useRef(false);
  // A pane with no size yet (a hidden tab, a panel still opening) would fit to
  // the minimum zoom; wait until it has one.
  const paneSized = useFlowStore((s) => s.width > 0 && s.height > 0);
  React.useEffect(() => {
    if (fitted.current || !loaded || !paneSized) return;
    const saved = readViewport(caseId);
    if (saved) {
      fitted.current = true;
      void rf.setViewport(saved);
      return;
    }
    if (rfNodes.length === 0) return;
    const measured = rfNodes.every((n) => n.measured?.width || n.hidden);
    if (!measured) return;
    fitted.current = true;
    requestAnimationFrame(() => void rf.fitView({ padding: 0.15, maxZoom: 1 }));
  }, [loaded, paneSized, rfNodes, rf, caseId]);

  // Remember the viewport after every change, fits and tidy-ups included, not
  // only after a user pan. A store subscription, so panning re-renders nothing.
  const flowStore = useStoreApi<BoardNode, BoardEdge>();
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = flowStore.subscribe((state, prev) => {
      if (state.transform === prev.transform || !fitted.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const [x, y, zoom] = flowStore.getState().transform;
        writeViewport(caseId, { x, y, zoom });
      }, 250);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [flowStore, caseId]);

  // ── Dimming: hypothesis focus, path, selection focus, highlight filters ────
  const selectedKey = rfNodes.filter((n) => n.selected).map((n) => n.id).join(",");
  // A focused card that left the board (removed, undone) takes its focus with it.
  React.useEffect(() => {
    if (focusHypothesisItemId && !items.has(focusHypothesisItemId)) {
      ui.getState().set({ focusHypothesisItemId: null, focusLock: false });
    }
  }, [focusHypothesisItemId, items, ui]);
  const dim = React.useMemo(() => {
    const nodes = new Set<string>();
    const edges = new Set<string>();
    const allIds = projectedNodes.map((n) => n.id);
    const keepOnly = (keep: Set<string>, keepEdges?: Set<string>) => {
      for (const id of allIds) if (!keep.has(id)) nodes.add(id);
      for (const e of projectedEdges) {
        const kept = keepEdges ? keepEdges.has(e.id) : keep.has(e.source) && keep.has(e.target);
        if (!kept) edges.add(e.id);
      }
    };
    if (spotlight) {
      // Everything of one kind, lit; frames stay as context.
      const keep = new Set<string>();
      for (const n of projectedNodes) {
        const lit =
          n.type === "frame" ||
          (spotlight === "evidence" && n.type === "evidence") ||
          (spotlight === "hypotheses" && n.type === "hypothesis") ||
          (spotlight === "findings" && isFindingData(n.data) && n.data.attached);
        if (lit) keep.add(n.id);
      }
      keepOnly(keep);
    } else if (path) {
      keepOnly(path.nodeIds, path.edgeIds);
    } else if (focusHypothesisItemId && allIds.includes(focusHypothesisItemId)) {
      const keep = new Set([focusHypothesisItemId]);
      for (const e of projectedEdges) {
        if (e.type !== "stance") continue;
        if (e.source === focusHypothesisItemId) keep.add(e.target);
        if (e.target === focusHypothesisItemId) keep.add(e.source);
      }
      keepOnly(keep);
    } else if (selectedKey) {
      const keep = new Set(selectedKey.split(","));
      for (const e of projectedEdges) {
        if (keep.has(e.source) || keep.has(e.target)) {
          keep.add(e.source);
          keep.add(e.target);
        }
      }
      // Frames and comment pins never dim on selection: they are context.
      for (const n of projectedNodes) if (n.type === "frame" || n.type === "comment") keep.add(n.id);
      keepOnly(keep);
    }
    const filterActive =
      view.onlyHighlighted || view.highlightSource || view.highlightDetector || view.highlightHypothesis;
    if (filterActive) {
      for (const n of projectedNodes) {
        if (!isItemData(n.data)) continue;
        const item = items.get(n.id);
        if (!item || item.kind === "FRAME" || item.kind === "COMMENT") continue;
        let keep = true;
        if (view.onlyHighlighted) {
          keep = !!item.style.highlight || Object.keys(item.style.rowHighlights ?? {}).length > 0;
        }
        const bubble = bubbles.get(item.id);
        if (keep && view.highlightSource) keep = bubble?.sourceType === view.highlightSource;
        if (keep && view.highlightDetector) {
          keep = !!bubble?.rows.some((r) => r.detector === view.highlightDetector);
        }
        if (keep && view.highlightHypothesis) {
          const threadItem = threads.get(view.highlightHypothesis)?.itemId;
          keep =
            item.id === threadItem ||
            [...supports.values()].some(
              (sp) => sp.threadId === view.highlightHypothesis && sp.endpoint?.itemId === item.id,
            );
        }
        if (!keep) nodes.add(n.id);
      }
      for (const e of projectedEdges) if (nodes.has(e.source) || nodes.has(e.target)) edges.add(e.id);
    }
    return { nodes, edges };
  }, [spotlight, path, focusHypothesisItemId, selectedKey, projectedNodes, projectedEdges, view, items, bubbles, threads, supports]);

  const displayNodes = React.useMemo(
    () =>
      rfNodes.map((n) => {
        const cls = cn(n.type === "frame" && "cb-frame-node", dim.nodes.has(n.id) && "cb-dim") || undefined;
        return n.className === cls ? n : { ...n, className: cls };
      }),
    [rfNodes, dim],
  );
  const displayEdges = React.useMemo(
    () =>
      projectedEdges.map((e) => ({
        ...e,
        selected: selectedEdgeIds.has(e.id),
        ...(dim.edges.has(e.id) ? { className: "cb-dim" } : {}),
      })),
    [projectedEdges, selectedEdgeIds, dim],
  );

  // ── React Flow changes ─────────────────────────────────────────────────────
  const onNodesChange = React.useCallback((changes: NodeChange<BoardNode>[]) => {
    // Additions and removals come from the store, never from React Flow.
    const allowed = changes.filter((c) => c.type !== "remove" && c.type !== "add" && c.type !== "replace");
    if (allowed.length > 0) setRfNodes((ns) => applyNodeChanges(allowed, ns));
  }, []);

  const onEdgesChange = React.useCallback((changes: EdgeChange<BoardEdge>[]) => {
    const selects = changes.filter((c): c is Extract<EdgeChange<BoardEdge>, { type: "select" }> => c.type === "select");
    if (selects.length === 0) return;
    setSelectedEdgeIds((prev) => {
      const next = new Set(prev);
      for (const c of selects) {
        if (c.selected) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  }, []);

  const onNodeDragStart: OnNodeDrag<BoardNode> = React.useCallback((_event, _node, dragged) => {
    dragStart.current = new Map(
      dragged.map((n) => [n.id, { x: n.position.x, y: n.position.y, parentId: n.parentId ?? null }]),
    );
  }, []);

  const onNodeDragStop: OnNodeDrag<BoardNode> = React.useCallback(
    (_event, _node, dragged) => {
      const s = store.getState();
      const frames = rf.getNodes().filter((n) => n.type === "frame" && !n.hidden);
      const moves: Move[] = [];
      for (const n of dragged) {
        if (!isItemData(n.data)) continue;
        const start = dragStart.current.get(n.id);
        if (!start) continue;
        let parentId = n.parentId ?? null;
        let pos = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
        // Frame membership: an item whose centre lands in a frame joins it;
        // dragged out, it leaves. Comment pins stay with what they annotate.
        if (n.type !== "comment") {
          const internal = rf.getInternalNode(n.id);
          if (internal) {
            const abs = internal.internals.positionAbsolute;
            const w = internal.measured.width ?? 0;
            const h = internal.measured.height ?? 0;
            const centre = { x: abs.x + w / 2, y: abs.y + h / 2 };
            let best: { id: string; area: number; x: number; y: number } | null = null;
            for (const f of frames) {
              if (f.id === n.id || dragged.some((d) => d.id === f.id)) continue;
              // A frame cannot join one of its own descendants.
              let cursor = s.items.get(f.id)?.parentId ?? null;
              let descendant = false;
              while (cursor) {
                if (cursor === n.id) {
                  descendant = true;
                  break;
                }
                cursor = s.items.get(cursor)?.parentId ?? null;
              }
              if (descendant) continue;
              const fi = rf.getInternalNode(f.id);
              if (!fi) continue;
              const fx = fi.internals.positionAbsolute.x;
              const fy = fi.internals.positionAbsolute.y;
              const fw = fi.measured.width ?? f.width ?? 0;
              const fh = fi.measured.height ?? f.height ?? 0;
              if (centre.x >= fx && centre.x <= fx + fw && centre.y >= fy && centre.y <= fy + fh) {
                const area = fw * fh;
                if (!best || area < best.area) best = { id: f.id, area, x: fx, y: fy };
              }
            }
            const nextParent = best?.id ?? null;
            if (nextParent !== parentId) {
              parentId = nextParent;
              pos = best
                ? { x: Math.round(abs.x - best.x), y: Math.round(abs.y - best.y) }
                : { x: Math.round(abs.x), y: Math.round(abs.y) };
            }
          }
        }
        if (pos.x !== Math.round(start.x) || pos.y !== Math.round(start.y) || parentId !== start.parentId) {
          moves.push({
            id: n.id,
            from: { x: start.x, y: start.y, parentId: start.parentId },
            to: { x: pos.x, y: pos.y, parentId },
          });
        }
      }
      // Finding nodes keep the spot they were dropped on, relative to their asset.
      const findingMoves = new Map<string, FindingMove[]>();
      for (const n of dragged) {
        if (!isFindingData(n.data)) continue;
        const start = dragStart.current.get(n.id);
        if (!start || (Math.round(start.x) === Math.round(n.position.x) && Math.round(start.y) === Math.round(n.position.y))) continue;
        const item = s.items.get(n.data.findingOf);
        if (!item) continue;
        const list = findingMoves.get(item.id) ?? [];
        list.push({
          findingId: n.data.findingId,
          from: item.style.findingPositions?.[n.data.findingId] ?? null,
          to: { x: n.position.x, y: n.position.y },
        });
        findingMoves.set(item.id, list);
      }
      dragStart.current.clear();
      const cmds = [
        ...(moves.length > 0 ? [moveItems(moves)] : []),
        ...[...findingMoves].map(([itemId, list]) => moveFindings(s.items.get(itemId)!, list)),
      ];
      if (cmds.length === 1) s.run(cmds[0]!);
      else if (cmds.length > 1) s.run(combine(`Move ${moves.length + findingMoves.size} items`, ...cmds));
    },
    [rf, store],
  );

  const kindOf = React.useCallback(
    (nodeId: string): ItemKind | "SUGGESTED" | undefined =>
      nodeId.startsWith("sg:")
        ? "SUGGESTED"
        : store.getState().items.get(parseFindingNodeId(nodeId)?.itemId ?? nodeId)?.kind,
    [store],
  );

  const isValidConnection = React.useCallback(
    (c: Connection | BoardEdge) =>
      // Every port is both a start and a drop target, so any two ports of
      // one node would otherwise make a link from a node to itself.
      validPair(kindOf(c.source), kindOf(c.target), c.source === c.target),
    [kindOf],
  );

  const onConnectEnd: OnConnectEnd = React.useCallback(
    (event, state) => {
      ui.getState().set({ connecting: false });
      if (!state.fromNode || readOnly) return;
      const point = pointOf(event);
      const source = endpointOf(state.fromNode.id);
      const target: BoardEndpoint | null = state.toNode ? endpointOf(state.toNode.id) : hitTest(point);
      if (!target || target.itemId === "") return;
      const same = source.itemId === target.itemId && (source.findingId ?? null) === (target.findingId ?? null);
      const a = kindOf(state.fromNode.id);
      const b = kindOf(target.itemId);
      if (target.itemId === source.itemId && !target.findingId && !source.findingId) return;
      if (!validPair(a, b, same)) {
        toast.message(t("caseBoard.link.invalid"));
        return;
      }
      ui.getState().set({
        pendingLink: { source, target, screen: point, stance: a === "HYPOTHESIS" || b === "HYPOTHESIS" },
      });
    },
    [ui, readOnly, kindOf, t],
  );

  const computePath = React.useCallback(
    (from: string, to: string) => {
      const edges = projectedEdges.map((e) => ({
        id: e.id,
        fromType: "n",
        fromId: e.source,
        toType: "n",
        toId: e.target,
        relationType: "",
        confidence: 1,
        origin: "INFERRED" as const,
      }));
      const res = shortestPath(`n:${from}`, `n:${to}`, edges);
      if (!res) {
        toast.message(t("caseBoard.path.none"));
        ui.getState().set({ path: null, pathFrom: null });
        return;
      }
      const nodeIds = new Set([...res.nodeKeys].map((k) => k.slice(2)));
      ui.getState().set({
        path: { from, to, nodeIds, edgeIds: res.edgeIds, hops: res.edgeIds.size },
        pathFrom: null,
      });
    },
    [projectedEdges, ui, t],
  );

  /** The side panel that shows a node: details for assets and findings, the thread of a card or pin. */
  const inspectorFor = React.useCallback(
    (node: BoardNode): { drawer: DrawerKind; opts: Parameters<UiState["openDrawer"]>[1] } | null => {
      if (isFindingData(node.data)) {
        return { drawer: "details", opts: { details: { itemId: node.data.findingOf, findingId: node.data.findingId } } };
      }
      if (node.type === "suggested") return { drawer: "details", opts: { details: { suggestedKey: node.id } } };
      if (node.type === "evidence") return { drawer: "details", opts: { details: { itemId: node.id } } };
      if (node.type === "hypothesis" || node.type === "comment") {
        const threadId = store.getState().items.get(node.id)?.refId;
        return threadId ? { drawer: "thread", opts: { threadId } } : null;
      }
      return null;
    },
    [store],
  );

  const onNodeClick = React.useCallback(
    (event: React.MouseEvent, node: BoardNode) => {
      const u = ui.getState();
      if (u.pathFrom && u.pathFrom !== node.id) {
        computePath(u.pathFrom, node.id);
        return;
      }
      if (event.shiftKey) {
        const other = rfNodes.find((n) => n.selected && n.id !== node.id);
        if (other) {
          computePath(other.id, node.id);
          return;
        }
      }
      if (isFindingData(node.data)) {
        const { findingOf, findingId } = node.data;
        if (u.tool === "comment" && !readOnly) {
          // The pin belongs to the asset and points at this finding.
          const abs = rf.getInternalNode(findingOf)?.internals.positionAbsolute ?? { x: 0, y: 0 };
          const flow = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
          u.set({
            composer: {
              kind: "comment",
              at: { x: flow.x - abs.x, y: flow.y - abs.y },
              screen: { x: event.clientX, y: event.clientY },
              anchor: { itemId: findingOf, findingId },
            },
          });
          return;
        }
      }
      if (u.tool === "comment" && !readOnly && isItemData(node.data)) {
        const item = store.getState().items.get(node.id);
        if (!item || item.kind === "COMMENT" || item.kind === "FRAME") return;
        const internal = rf.getInternalNode(node.id);
        const abs = internal?.internals.positionAbsolute ?? { x: 0, y: 0 };
        const flow = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        u.set({
          composer: {
            kind: "comment",
            at: { x: flow.x - abs.x, y: flow.y - abs.y },
            screen: { x: event.clientX, y: event.clientY },
            anchor: { itemId: node.id },
          },
        });
        return;
      }
      // A single click selects. An inspector already open in the side panel
      // follows it; opening one is a double click.
      if (u.tool !== "select" || (event.target as HTMLElement | null)?.closest("button, a, input, textarea")) return;
      if (u.drawer === "details" || u.drawer === "thread") {
        const inspect = inspectorFor(node);
        if (inspect) u.openDrawer(inspect.drawer, inspect.opts);
      }
    },
    [ui, computePath, rfNodes, readOnly, store, rf, inspectorFor],
  );

  /** A double click opens what the node is about in the side panel. */
  const onNodeDoubleClick = React.useCallback(
    (event: React.MouseEvent, node: BoardNode) => {
      if ((event.target as HTMLElement | null)?.closest("button, a, input, textarea")) return;
      const inspect = inspectorFor(node);
      if (inspect) ui.getState().openDrawer(inspect.drawer, inspect.opts);
    },
    [ui, inspectorFor],
  );

  const onPaneClick = React.useCallback(
    (event: React.MouseEvent) => {
      const u = ui.getState();
      if (readOnly || u.tool === "select" || u.tool === "hand" || u.tool === "link") {
        if (!u.focusLock) u.set({ focusHypothesisItemId: null });
        if (u.spotlight) u.set({ spotlight: null });
        if (u.path || u.pathFrom) u.set({ path: null, pathFrom: null });
        return;
      }
      const at = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const screen = { x: event.clientX, y: event.clientY };
      if (u.tool === "note") {
        const cmd = addNote(at);
        store.getState().run(cmd);
        u.set({ tool: "select", editingItemId: cmd.id });
      } else if (u.tool === "hypothesis") {
        u.set({ composer: { kind: "hypothesis", at, screen, anchor: null } });
      } else if (u.tool === "comment") {
        u.set({ composer: { kind: "comment", at, screen, anchor: null } });
      }
    },
    [ui, rf, store, readOnly],
  );

  const onShowNeighbours = React.useCallback(
    async (itemId: string) => {
      try {
        const graph = await api.caseBoard.caseBoardControllerNeighbours({
          id: caseId,
          boardNeighboursDto: { itemId },
        });
        store.getState().mergeNeighbours(itemId, graph);
        if (ui.getState().view.suggested === "hide") ui.getState().setView({ suggested: "show" });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [caseId, store, ui],
  );

  const selectAll = React.useCallback(() => {
    setRfNodes((ns) => ns.map((n) => (n.selected || n.hidden ? n : { ...n, selected: true })));
  }, []);
  const clearSelection = React.useCallback(() => {
    setRfNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setSelectedEdgeIds(new Set());
  }, []);
  const selectedEdgesRef = React.useRef<BoardEdge[]>([]);
  selectedEdgesRef.current = displayEdges.filter((e) => e.selected);
  const getSelectedEdges = React.useCallback(() => selectedEdgesRef.current, []);
  useBoardShortcuts({ selectAll, clearSelection, selectedEdges: getSelectedEdges });

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      const raw = event.dataTransfer.getData(BOARD_DRAG_MIME);
      if (!raw || readOnly) return;
      event.preventDefault();
      try {
        const payload = JSON.parse(raw) as {
          entityType: "asset" | "finding";
          entityId: string;
          label?: string;
          assetType?: string | null;
          sourceType?: string | null;
          /** A lead from the Leads drawer: accepted through the normal review. */
          leadId?: string;
          assetId?: string | null;
        };
        const at = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const s = store.getState();
        if (payload.leadId) {
          // Accepting keeps the lead's own record (status, timeline entry);
          // the hint makes the new bubble appear where it was dropped.
          const hints = new Map(ui.getState().placementHints);
          hints.set(`finding:${payload.entityId}`, at);
          if (payload.assetId) hints.set(`asset:${payload.assetId}`, at);
          ui.getState().set({ placementHints: hints });
          void api.cases
            .caseLeadsControllerReview({
              caseId,
              leadId: payload.leadId,
              reviewCaseLeadDto: { action: "ACCEPT" as never },
            })
            .then(() => {
              toast.success(t("caseBoard.toasts.evidenceAdded"));
              s.refetch();
            })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)));
          return;
        }
        const existing =
          payload.entityType === "asset" ? s.itemByAsset.get(payload.entityId) : s.itemByFinding.get(payload.entityId);
        if (existing && payload.entityType === "asset") {
          toast.message(t("caseBoard.toasts.alreadyOnBoard"));
          return;
        }
        // A finding of an asset that is on the board already joins that asset.
        const ownerItem = payload.assetId ? s.itemByAsset.get(payload.assetId) : existing;
        if (payload.entityType === "finding" && ownerItem) {
          if (!s.bubbles.get(ownerItem)?.rows.some((r) => r.findingId === payload.entityId)) {
            s.run(attachFinding(ownerItem, payload.entityId));
          } else {
            toast.message(t("caseBoard.toasts.alreadyOnBoard"));
          }
          return;
        }
        s.run(
          addEvidence({ entityType: payload.entityType, entityId: payload.entityId }, at, {
            label: payload.label,
            assetType: payload.assetType ?? null,
            sourceType: payload.sourceType ?? null,
          }),
        );
      } catch {
        // Not ours.
      }
    },
    [rf, store, ui, readOnly, t, caseId],
  );

  // Select: a drag on the canvas draws a selection box, the middle button (or
  // Space) pans. Hand: every drag pans and nothing is picked up.
  const panOnDrag = tool === "hand" ? true : [1];
  const boardClass = cn(
    "@container/board case-board-canvas relative h-full w-full",
    tool === "link" && "tool-link",
    tool === "hand" && "tool-hand",
    connecting && "is-connecting",
    readOnly && "is-readonly",
    (tool === "note" || tool === "hypothesis" || tool === "comment") && "[&_.react-flow__pane]:cursor-crosshair",
  );

  return (
    <ContextMenu onOpenChange={(open) => !open && setMenuTarget(null)}>
      <ContextMenuTrigger asChild>
        <div className={boardClass} onDragOver={(e) => e.dataTransfer.types.includes(BOARD_DRAG_MIME) && e.preventDefault()} onDrop={onDrop}>
          <EdgeMarkers />
          <ReactFlow<BoardNode, BoardEdge>
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onConnectStart={() => ui.getState().set({ connecting: true })}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={28}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onEdgeMouseEnter={(_, e) => ui.getState().set({ hoveredEdgeId: e.id })}
            onEdgeMouseLeave={(_, e) => {
              if (ui.getState().hoveredEdgeId === e.id) ui.getState().set({ hoveredEdgeId: null });
            }}
            onNodeContextMenu={(event, node) => setMenuTarget(targetFromNodeEvent(event, node.id))}
            onEdgeContextMenu={(_, edge) => {
              const target = edgeTarget(edge);
              if (!target) return setMenuTarget(null);
              if (target.kind === "system") {
                const origin = store.getState().systemEdges.get(target.systemEdgeId)?.origin;
                setMenuTarget(origin === "MANUAL" ? { kind: "global", systemEdgeId: target.systemEdgeId } : target);
                return;
              }
              setMenuTarget(target);
            }}
            onPaneContextMenu={(event) =>
              setMenuTarget({
                kind: "pane",
                at: rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
                screen: { x: event.clientX, y: event.clientY },
              })
            }
            onSelectionContextMenu={(_, nodes) =>
              setMenuTarget({ kind: "selection", itemIds: nodes.filter((n) => isItemData(n.data)).map((n) => n.id) })
            }
            deleteKeyCode={null}
            selectionKeyCode="Shift"
            multiSelectionKeyCode={["Meta", "Control"]}
            nodesDraggable={!readOnly && tool !== "hand"}
            nodesConnectable={!readOnly && tool !== "hand"}
            elementsSelectable={tool !== "hand"}
            selectionOnDrag={tool === "select"}
            selectionMode={SelectionMode.Partial}
            panOnDrag={panOnDrag}
            panOnScroll={false}
            zoomOnScroll
            zoomOnPinch
            zoomOnDoubleClick={false}
            onNodeDoubleClick={onNodeDoubleClick}
            onlyRenderVisibleElements
            minZoom={0.05}
            maxZoom={2}
            colorMode={resolvedTheme === "dark" ? "dark" : "light"}
            aria-label={t("caseBoard.boardLabel")}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
            {view.minimap && (
              <MiniMap
                pannable
                zoomable
                position="top-right"
                className="!border-2 !border-border"
                nodeColor={(n) =>
                  n.type === "evidence" || n.type === "finding"
                    ? "var(--foreground)"
                    : n.type === "hypothesis"
                      ? "var(--cb-violet)"
                      : n.type === "note"
                        ? "var(--cb-yellow)"
                        : n.type === "frame"
                          ? "transparent"
                          : "var(--cb-gray)"
                }
                nodeStrokeColor={(n) => (n.type === "frame" ? "var(--cb-gray)" : "transparent")}
              />
            )}
            <Panel position="bottom-left">
              <ViewPopover />
            </Panel>
            <Panel position="bottom-center">
              <ToolDock />
            </Panel>
            <Panel position="bottom-right" className="!mr-20">
              <ZoomControls />
            </Panel>
          </ReactFlow>
          {tool === "frame" && !readOnly && <FrameDrawOverlay />}
          <LinkPopover />
          <ComposerPopover />
        </div>
      </ContextMenuTrigger>
      <BoardContextMenuContent
        target={menuTarget}
        onTidyUp={onTidyUp}
        onShowNeighbours={(id) => void onShowNeighbours(id)}
        onFlyTo={flyTo}
      />
    </ContextMenu>
  );
}
