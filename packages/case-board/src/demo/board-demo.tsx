"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from "@xyflow/react";
import { Maximize, Minus, Plus, RotateCcw } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { EdgeMarkers } from "../components/markers";
import { useLod } from "../hooks/use-lod";
import { SOURCE_PORT, TARGET_PORT, type Lod } from "../lib/geometry";
import { DemoProvider, type DemoState } from "./demo-context";
import { DEMO_EDGE_TYPES } from "./demo-edges";
import { DEMO_NODE_TYPES } from "./demo-nodes";
import { buildFlow, dimmed, type DemoFlowEdge, type DemoFlowNode, type DemoScene } from "./scene";

/**
 * A small, live case board for the documentation: the board's own nodes and
 * edges, laid out from a scene. Drag things around, click to select, click a
 * hypothesis to focus it, pull a link from a port. Nothing is saved; Reset
 * puts the scene back.
 *
 * The page keeps scrolling over it: zoom with the buttons or a pinch.
 * Wrap it in the board's stylesheet (`@workspace/case-board/board.css`) and
 * React Flow's base.css.
 */
export function BoardDemo({
  scene,
  height = 420,
  zoom,
  className,
  label,
}: {
  scene: DemoScene;
  height?: number;
  /** Open at this zoom, centred, instead of fitting the scene in. */
  zoom?: number;
  className?: string;
  /** Read out for the canvas. */
  label?: string;
}) {
  const fit = React.useMemo<Fit>(() => (zoom ? { padding: 0.08, minZoom: zoom, maxZoom: zoom } : FIT), [zoom]);
  return (
    <div
      className={cn("case-board relative overflow-hidden rounded-[4px] border border-border bg-background", className)}
      style={{ height }}
      role="figure"
      aria-label={label}
    >
      <ReactFlowProvider>
        <DemoCanvas scene={scene} fit={fit} />
      </ReactFlowProvider>
    </div>
  );
}

const FIT = { padding: 0.08, maxZoom: 1 };

type Fit = { padding: number; minZoom?: number; maxZoom?: number };

const LOD_WORDS: Record<Lod, string> = {
  full: "Full detail",
  compact: "Shapes and names",
  chip: "Overview",
};

function DemoCanvas({ scene, fit }: { scene: DemoScene; fit: Fit }) {
  const initial = React.useMemo(() => buildFlow(scene), [scene]);
  const [nodes, setNodes, onNodesChange] = useNodesState<DemoFlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<DemoFlowEdge>(initial.edges);
  const [focus, setFocus] = React.useState<string | null>(scene.focus ?? null);
  const [hoveredEdgeId, setHoveredEdgeId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const rf = useReactFlow<DemoFlowNode, DemoFlowEdge>();

  React.useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 4200);
    return () => window.clearTimeout(timer);
  }, [message]);

  const reset = React.useCallback(() => {
    const fresh = buildFlow(scene);
    setNodes(fresh.nodes);
    setEdges(fresh.edges);
    setFocus(scene.focus ?? null);
    setMessage(null);
    requestAnimationFrame(() => void rf.fitView({ ...fit, duration: 200 }));
  }, [fit, rf, scene, setEdges, setNodes]);

  const onConnect = React.useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const kinds = new Map(rf.getNodes().map((n) => [n.id, n.type]));
      const stance = kinds.get(c.source) === "hypothesis" || kinds.get(c.target) === "hypothesis";
      const [source, target] = kinds.get(c.target) === "hypothesis" ? [c.target, c.source] : [c.source, c.target];
      const id = `drawn:${Date.now()}`;
      setEdges((current) => [
        ...current,
        {
          id,
          type: stance ? "stance" : "link",
          source,
          target,
          sourceHandle: SOURCE_PORT,
          targetHandle: TARGET_PORT,
          data: {
            edge: stance
              ? { type: "stance", source, target, stance: "SUPPORTS" }
              : { type: "link", source, target, kind: "related_to", text: "Related to" },
          },
        },
      ]);
      setMessage(
        stance
          ? "On the board you choose the stance here: supports, contradicts or neutral."
          : "On the board a menu asks what the link means (related to, same entity, communicates with, derived from, contradicts, precedes) and whether it is confirmed or suspected.",
      );
    },
    [rf, setEdges],
  );

  const selectedIds = React.useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);
  const dim = React.useMemo(
    () => dimmed(nodes, edges, { dim: scene.dim, focus, selected: selectedIds }),
    [edges, focus, nodes, scene.dim, selectedIds],
  );
  const shownNodes = React.useMemo(
    () => nodes.map((n) => (dim.nodes.has(n.id) === (n.className === "cb-dim") ? n : { ...n, className: dim.nodes.has(n.id) ? "cb-dim" : undefined })),
    [dim, nodes],
  );
  const shownEdges = React.useMemo(
    () => edges.map((e) => (dim.edges.has(e.id) === (e.className === "cb-dim") ? e : { ...e, className: dim.edges.has(e.id) ? "cb-dim" : undefined })),
    [dim, edges],
  );

  const state = React.useMemo<DemoState>(
    () => ({ focus, setFocus, hoveredEdgeId, say: setMessage }),
    [focus, hoveredEdgeId],
  );

  return (
    <DemoProvider value={state}>
      <EdgeMarkers />
      <ReactFlow<DemoFlowNode, DemoFlowEdge>
        nodes={shownNodes}
        edges={shownEdges}
        nodeTypes={DEMO_NODE_TYPES}
        edgeTypes={DEMO_EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeMouseEnter={(_, e) => setHoveredEdgeId(e.id)}
        onEdgeMouseLeave={() => setHoveredEdgeId(null)}
        onPaneClick={() => setFocus(null)}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={fit}
        minZoom={0.1}
        maxZoom={2}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
      </ReactFlow>
      <DemoControls fit={fit} onReset={reset} />
      {message && (
        <div
          role="status"
          className="pointer-events-none absolute inset-x-3 top-3 mx-auto max-w-md rounded-[4px] border border-border bg-card px-3 py-2 text-center text-xs leading-snug text-card-foreground shadow-[0_1px_3px_rgba(28,25,23,0.08)]"
        >
          {message}
        </div>
      )}
    </DemoProvider>
  );
}

function DemoControls({ fit, onReset }: { fit: Fit; onReset: () => void }) {
  const rf = useReactFlow();
  const lod = useLod();
  const button =
    "flex size-7 items-center justify-center text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-foreground";
  return (
    <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
      <div className="flex items-center divide-x divide-border rounded-[4px] border border-border bg-card">
        <button type="button" className={button} onClick={() => void rf.zoomOut({ duration: 150 })} aria-label="Zoom out" title="Zoom out">
          <Minus className="size-3.5" aria-hidden />
        </button>
        <button type="button" className={button} onClick={() => void rf.zoomIn({ duration: 150 })} aria-label="Zoom in" title="Zoom in">
          <Plus className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className={button}
          onClick={() => void rf.fitView({ padding: fit.padding, maxZoom: 1, duration: 200 })}
          aria-label="Fit to view"
          title="Fit to view"
        >
          <Maximize className="size-3.5" aria-hidden />
        </button>
        <button type="button" className={button} onClick={onReset} aria-label="Reset the demo" title="Reset the demo">
          <RotateCcw className="size-3.5" aria-hidden />
        </button>
      </div>
      <span className="rounded-[3px] border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
        {LOD_WORDS[lod]}
      </span>
    </div>
  );
}
