"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Connection,
  type NodeChange,
} from "@xyflow/react";
import { FileText, Map as MapIcon, Maximize2, Minus, Plus, ScanSearch, type LucideIcon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { EdgeMarkers } from "../components/markers";
import { ASSET_NODE, ASSET_ROUND, EVIDENCE_ROUND, SOURCE_PORT, TARGET_PORT, type XY } from "../lib/geometry";
import { ENGLISH_WORDS, ExploreCanvasProvider, type ExploreCanvasState, type ExploreWords } from "./canvas-context";
import { EXPLORE_EDGE_TYPES, type ExploreFlowEdge } from "./edges";
import { layoutExplore, TERM_CHIP } from "./layout";
import { termNodeId, type ExploreGraph, type ExploreKind, type ExploreSelection } from "./model";
import { EXPLORE_NODE_TYPES, type ExploreFlowNode } from "./nodes";

const FIT = { padding: 0.12, maxZoom: 1, duration: 200 };
// Every node's size is known up front, so React Flow never measures one.
const ASSET_SIZE = { width: ASSET_NODE.width, height: ASSET_NODE.height };
const TERM_SIZE = { width: TERM_CHIP.width, height: TERM_CHIP.height };
const LANE_SIZE = { width: 360, height: 16 };
const defaultIcon = () => FileText;
/** The board's own "step back" class. */
const dim = (on: boolean) => (on ? "cb-dim" : undefined);

/** What a counter lit up: one kind of connection, or what a case holds or a watch answers. */
export type ExploreSpotlight = ExploreKind | "cases" | "watches";

/** What a right click landed on: an asset, a term, a line, or the empty canvas. */
export type ExploreMenuTarget = ExploreSelection | { type: "pane" };

export interface ExploreCanvasProps {
  graph: ExploreGraph;
  /** Kinds of connection to draw; the rest are left out, with what only they reach. */
  kinds: ReadonlySet<ExploreKind>;
  selection: ExploreSelection | null;
  onSelect: (selection: ExploreSelection | null) => void;
  /** Light one kind (or the cased or watched assets) and bring it into view; the rest steps back. */
  spotlight?: ExploreSpotlight | null;
  /** A double click on a neighbour: make it a starting point. */
  onWalk?: (assetId: string) => void;
  /** Drawing a link from one asset's port to another's. Leave out to draw none. */
  onLink?: (fromAssetId: string, toAssetId: string) => void;
  iconFor?: (assetType: string | null | undefined) => LucideIcon;
  words?: ExploreWords;
  /** The view is fitted again whenever this changes (new starting points). */
  fitKey: string;
  /**
   * The wheel zooms, as on the case board (the default). Off only where a
   * page must keep scrolling over the canvas: the documentation's demos.
   */
  zoomOnScroll?: boolean;
  /** Assets a search matched: they glow and come into view, the rest steps back. */
  highlight?: ReadonlySet<string> | null;
  /**
   * A right click: what it landed on, before the context menu wrapping the
   * canvas opens (as on the case board, the caller draws the menu).
   */
  onMenuTarget?: (target: ExploreMenuTarget) => void;
  /** The caller's own controls, drawn inside the canvas (they may use React Flow's hooks). */
  overlay?: React.ReactNode;
  /**
   * Where people dragged things, by node id. Given, the caller keeps them
   * (a saved view does); left out, they last until the starting points change.
   */
  positions?: Readonly<Record<string, XY>>;
  /** A drag ended: every position moved so far, the new one included. */
  onPositionsChange?: (positions: Record<string, XY>) => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The Explore canvas: the board's own nodes and lines, laid out by
 * `layoutExplore` and filtered by kind. It only draws; what is on it and
 * what a click does belong to the caller, so the app and the documentation
 * share it.
 */
export function ExploreCanvas(props: ExploreCanvasProps) {
  return (
    <div className={cn("case-board @container/board relative overflow-hidden bg-background", props.className)} style={props.style}>
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}

function Canvas({
  graph,
  kinds,
  selection,
  onSelect,
  spotlight = null,
  onWalk,
  onLink,
  iconFor = defaultIcon,
  words = ENGLISH_WORDS,
  fitKey,
  highlight = null,
  onMenuTarget,
  zoomOnScroll = true,
  overlay,
  positions,
  onPositionsChange,
}: ExploreCanvasProps) {
  const rf = useReactFlow<ExploreFlowNode, ExploreFlowEdge>();
  const [hoveredLinkId, setHoveredLinkId] = React.useState<string | null>(null);
  // Where people dragged things: the caller's, or until the starting points change.
  const controlled = positions !== undefined;
  const [moved, setMoved] = React.useState<Map<string, XY>>(() => new Map(Object.entries(positions ?? {})));
  React.useEffect(() => {
    if (controlled) setMoved(new Map(Object.entries(positions)));
  }, [controlled, positions]);
  React.useEffect(() => {
    if (!controlled) setMoved(new Map());
  }, [controlled, fitKey]);

  const layout = React.useMemo(() => layoutExplore(graph, kinds), [graph, kinds]);

  // Focus: with something selected or a counter lit, the rest steps back.
  const focus = React.useMemo(() => {
    const nodes = new Set<string>();
    const links = new Set<string>();
    if (selection) {
      const at =
        selection.type === "term" ? termNodeId(selection.id) : selection.type === "asset" ? selection.id : null;
      for (const l of layout.links) {
        if (selection.type === "link" ? l.id === selection.id : l.source === at || l.target === at) {
          links.add(l.id);
          nodes.add(l.source);
          nodes.add(l.target);
        }
      }
      if (at) nodes.add(at);
      return { nodes, links };
    }
    if (highlight?.size) {
      for (const id of highlight) nodes.add(id);
      for (const l of layout.links) {
        if (highlight.has(l.source) && highlight.has(l.target)) links.add(l.id);
      }
      return { nodes, links };
    }
    if (!spotlight) return null;
    for (const a of layout.assets) {
      const lit =
        a.side === "seed" ||
        (spotlight === "cases"
          ? !!a.cases?.length
          : spotlight === "watches"
            ? !!a.watches?.length
            : a.kinds.includes(spotlight));
      if (lit) nodes.add(a.id);
    }
    for (const l of layout.links) {
      const lit =
        spotlight === "cases" || spotlight === "watches"
          ? nodes.has(l.source) && nodes.has(l.target)
          : l.kind === spotlight;
      if (lit) {
        links.add(l.id);
        nodes.add(l.source);
        nodes.add(l.target);
      }
    }
    return { nodes, links };
  }, [highlight, layout, selection, spotlight]);

  const nodes = React.useMemo<ExploreFlowNode[]>(() => {
    const termCount = new Map<string, number>();
    for (const l of layout.links) {
      if (l.target.startsWith("term:")) termCount.set(l.target, (termCount.get(l.target) ?? 0) + 1);
    }
    const at = (id: string) => moved.get(id) ?? layout.positions.get(id) ?? { x: 0, y: 0 };
    const out: ExploreFlowNode[] = [];
    for (const lane of layout.lanes) {
      out.push({
        id: `lane:${lane.lane}`,
        type: "explore-lane",
        position: lane.position,
        data: { node: "lane", text: words.lanes[lane.lane] },
        ...LANE_SIZE,
        measured: LANE_SIZE,
        className: dim(!!focus),
        selectable: false,
        draggable: false,
        connectable: false,
        focusable: false,
      });
    }
    for (const a of layout.assets) {
      out.push({
        id: a.id,
        type: "explore-asset",
        position: at(a.id),
        data: { node: "asset", asset: a, round: a.side === "seed" ? EVIDENCE_ROUND : ASSET_ROUND },
        ...ASSET_SIZE,
        measured: ASSET_SIZE,
        className: cn(dim(!!focus && !focus.nodes.has(a.id)), highlight?.has(a.id) && !selection && "cb-glow"),
        selected: selection?.type === "asset" && selection.id === a.id,
      });
    }
    for (const t of layout.terms) {
      const id = termNodeId(t.id);
      out.push({
        id,
        type: "explore-term",
        position: at(id),
        data: { node: "term", term: t, count: termCount.get(id) ?? 0, anchor: t.id === layout.anchor },
        ...TERM_SIZE,
        measured: TERM_SIZE,
        className: dim(!!focus && !focus.nodes.has(id)),
        selected: selection?.type === "term" && selection.id === t.id,
        connectable: false,
      });
    }
    return out;
  }, [focus, highlight, layout, moved, selection, words]);

  const edges = React.useMemo<ExploreFlowEdge[]>(() => {
    // Several kinds between one pair bow apart instead of lying on each other.
    const seen = new Map<string, number>();
    return layout.links.map((l) => {
      const pair = [l.source, l.target].sort().join("|");
      const n = seen.get(pair) ?? 0;
      seen.set(pair, n + 1);
      const bend = n === 0 ? 0 : (n % 2 === 1 ? 1 : -1) * Math.ceil(n / 2);
      return {
        id: l.id,
        type: "explore",
        source: l.source,
        target: l.target,
        sourceHandle: SOURCE_PORT,
        targetHandle: TARGET_PORT,
        data: { link: l, bend },
        selected: selection?.type === "link" && selection.id === l.id,
        className: dim(!!focus && !focus.links.has(l.id)),
        deletable: false,
        reconnectable: false,
      };
    });
  }, [focus, layout, selection]);

  // New starting points refit; toggling a kind keeps the view where it is.
  // The first fit is React Flow's own (`fitView` below); later ones wait a
  // tick for the new nodes to reach its store.
  const fitted = React.useRef(fitKey);
  React.useEffect(() => {
    if (fitted.current === fitKey) return;
    fitted.current = fitKey;
    const timer = window.setTimeout(() => void rf.fitView(FIT), 0);
    return () => window.clearTimeout(timer);
  }, [fitKey, rf]);

  // A lit counter brings what it lights into view, as on the case board.
  const spotlightNodes = React.useRef<string[]>([]);
  spotlightNodes.current = spotlight && focus && !selection ? [...focus.nodes] : [];
  React.useEffect(() => {
    const ids = spotlightNodes.current.map((id) => ({ id }));
    if (!spotlight || !ids.length) return;
    const timer = window.setTimeout(
      () => void rf.fitView({ nodes: ids, padding: 0.25, maxZoom: 1, duration: 300 }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [rf, spotlight]);

  // What a search matched comes into view the same way.
  const highlightKey = highlight ? [...highlight].sort().join(",") : "";
  React.useEffect(() => {
    if (!highlightKey) return;
    const ids = highlightKey.split(",").map((id) => ({ id }));
    const timer = window.setTimeout(
      () => void rf.fitView({ nodes: ids, padding: 0.3, maxZoom: 1, duration: 300 }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [highlightKey, rf]);

  const [minimap, setMinimap] = React.useState(false);

  const onNodesChange = React.useCallback((changes: NodeChange<ExploreFlowNode>[]) => {
    const drags = changes.filter((c) => c.type === "position" && c.position);
    if (!drags.length) return;
    setMoved((current) => {
      const next = new Map(current);
      for (const c of drags) if (c.type === "position" && c.position) next.set(c.id, c.position);
      return next;
    });
  }, []);

  const onConnect = React.useCallback(
    (c: Connection) => {
      if (!onLink || !c.source || !c.target || c.source === c.target) return;
      if (c.source.startsWith("term:") || c.target.startsWith("term:")) return;
      onLink(c.source, c.target);
    },
    [onLink],
  );

  const state = React.useMemo<ExploreCanvasState>(
    () => ({ words, iconFor, hoveredLinkId, canLink: !!onLink }),
    [hoveredLinkId, iconFor, onLink, words],
  );

  return (
    <ExploreCanvasProvider value={state}>
      <EdgeMarkers />
      <ReactFlow<ExploreFlowNode, ExploreFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={EXPLORE_NODE_TYPES}
        edgeTypes={EXPLORE_EDGE_TYPES}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, __, dragged) => {
          if (!onPositionsChange) return;
          const next = new Map(moved);
          for (const n of dragged) next.set(n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) });
          onPositionsChange(Object.fromEntries(next));
        }}
        onConnect={onConnect}
        onNodeClick={(_, n) => {
          if (n.data.node === "asset") onSelect({ type: "asset", id: n.id });
          else if (n.data.node === "term") onSelect({ type: "term", id: n.data.term.id });
        }}
        onNodeDoubleClick={(_, n) => {
          if (n.data.node === "asset" && !n.data.asset.external) onWalk?.(n.id);
        }}
        onEdgeClick={(_, e) => onSelect({ type: "link", id: e.id })}
        onEdgeMouseEnter={(_, e) => setHoveredLinkId(e.id)}
        onEdgeMouseLeave={() => setHoveredLinkId(null)}
        onPaneClick={() => onSelect(null)}
        onNodeContextMenu={(_, n) => {
          if (n.data.node === "asset") onMenuTarget?.({ type: "asset", id: n.id });
          else if (n.data.node === "term") onMenuTarget?.({ type: "term", id: n.data.term.id });
          else onMenuTarget?.({ type: "pane" });
        }}
        onEdgeContextMenu={(_, e) => onMenuTarget?.({ type: "link", id: e.id })}
        onPaneContextMenu={() => onMenuTarget?.({ type: "pane" })}
        fitView
        fitViewOptions={FIT}
        nodesConnectable={!!onLink}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={28}
        onlyRenderVisibleElements
        minZoom={0.1}
        maxZoom={2}
        zoomOnScroll={zoomOnScroll}
        preventScrolling={zoomOnScroll}
        zoomOnPinch
        panOnScroll={false}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        {minimap && (
          <MiniMap
            pannable
            zoomable
            position="top-right"
            className="!border-2 !border-border"
            nodeColor={(n) =>
              (n as ExploreFlowNode).data.node === "term"
                ? "var(--cb-violet)"
                : (n as ExploreFlowNode).data.node === "lane"
                  ? "transparent"
                  : "var(--foreground)"
            }
          />
        )}
        <Panel position="bottom-right">
          <ZoomControls words={words} minimap={minimap} onMinimap={() => setMinimap((on) => !on)} />
        </Panel>
        {overlay}
      </ReactFlow>
    </ExploreCanvasProvider>
  );
}

function ZoomButton({
  label,
  onClick,
  active,
  wide,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  /** Only shown when the canvas is wide enough for the whole row. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "size-8 items-center justify-center rounded-[3px] hover:bg-muted",
        wide ? "hidden @3xl/board:flex" : "flex",
        active && "bg-foreground text-background hover:bg-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The case board's zoom row, in the same place: out, percentage (back to
 * 100 %), in, fit, fit the selection, and the mini-map.
 */
function ZoomControls({ words, minimap, onMinimap }: { words: ExploreWords; minimap: boolean; onMinimap: () => void }) {
  const rf = useReactFlow();
  const zoom = useStore((s) => Math.round(s.transform[2] * 100));
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? 0 : 200;
  return (
    <div className="flex items-center gap-0.5 rounded-[6px] border-2 border-border bg-card p-1" data-testid="explore-zoom">
      <ZoomButton wide label={words.zoomOut} onClick={() => void rf.zoomOut({ duration })}>
        <Minus className="size-4" aria-hidden />
      </ZoomButton>
      <button
        type="button"
        className="w-12 font-mono text-xs tabular-nums hover:underline"
        title={words.zoomReset}
        onClick={() => void rf.zoomTo(1, { duration })}
      >
        {zoom}%
      </button>
      <ZoomButton wide label={words.zoomIn} onClick={() => void rf.zoomIn({ duration })}>
        <Plus className="size-4" aria-hidden />
      </ZoomButton>
      <span className="mx-0.5 hidden h-5 w-px bg-border @3xl/board:block" aria-hidden />
      <ZoomButton label={words.fit} onClick={() => void rf.fitView({ ...FIT, duration })}>
        <Maximize2 className="size-4" aria-hidden />
      </ZoomButton>
      <ZoomButton
        wide
        label={words.zoomSelection}
        onClick={() => {
          const nodes = rf.getNodes().filter((n) => n.selected);
          if (nodes.length) void rf.fitView({ nodes, duration, padding: 0.3, maxZoom: 1.2 });
        }}
      >
        <ScanSearch className="size-4" aria-hidden />
      </ZoomButton>
      <ZoomButton wide label={words.minimap} active={minimap} onClick={onMinimap}>
        <MapIcon className="size-4" aria-hidden />
      </ZoomButton>
    </div>
  );
}
