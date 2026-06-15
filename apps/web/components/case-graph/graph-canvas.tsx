"use client";

import * as React from "react";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import { GraphSvgDefs } from "./graph-svg-defs";
import { GraphNode } from "./graph-node";
import { GraphEdge } from "./graph-edge";
import {
  keyOf,
  nodeKey,
  nodeRadius,
  type GraphMode,
  type GraphSelection,
  type PathResult,
  type SimNode,
} from "./graph-types";
import type { useForceLayout } from "./use-force-layout";
import type { usePanZoom } from "./use-pan-zoom";

const CLICK_THRESHOLD = 4;

export interface GraphCanvasProps {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  layout: ReturnType<typeof useForceLayout>;
  panZoom: ReturnType<typeof usePanZoom>;
  evidenceKeys: Set<string>;
  hypothesisColors: Record<string, string>;
  /** asset entity id → count of findings not yet attached as evidence */
  attachableCounts: Map<string, number>;
  /** asset entity id → count of attached findings hidden by collapse */
  collapsedCounts: Map<string, number>;
  selection: GraphSelection;
  mode: GraphMode;
  /** Node keys rendered at full opacity; null = nothing is dimmed. */
  activeNodeKeys: Set<string> | null;
  path: PathResult | null;
  /** Colour edges by edge.confidence (0..1) as a similarity-strength heat. */
  colorByStrength?: boolean;
  onNodeClick: (node: GraphNodeDto, shiftKey: boolean) => void;
  onNodeContextMenu: (node: GraphNodeDto, clientX: number, clientY: number) => void;
  onEdgeClick: (edge: GraphEdgeDto) => void;
  onEdgeContextMenu: (edge: GraphEdgeDto, clientX: number, clientY: number) => void;
  onBackgroundClick: () => void;
  onAttachBadgeClick: (node: GraphNodeDto) => void;
  onToggleCollapse: (node: GraphNodeDto) => void;
}

export function GraphCanvas({
  nodes,
  edges,
  layout,
  panZoom,
  evidenceKeys,
  hypothesisColors,
  attachableCounts,
  collapsedCounts,
  selection,
  mode,
  activeNodeKeys,
  path,
  colorByStrength,
  onNodeClick,
  onNodeContextMenu,
  onEdgeClick,
  onEdgeContextMenu,
  onBackgroundClick,
  onAttachBadgeClick,
  onToggleCollapse,
}: GraphCanvasProps) {
  const { simNodes, version, dragStart, dragMove, dragEnd, isPinned } = layout;
  const { svgRef, gRef, screenToWorld, beginPan } = panZoom;
  void version; // positions are read each render; version drives re-renders

  const [cursorWorld, setCursorWorld] = React.useState<{ x: number; y: number } | null>(null);

  const connectSourceKey = mode.kind === "connect" ? mode.sourceKey : null;
  const connectSource = connectSourceKey ? simNodes.get(connectSourceKey) : undefined;

  // ── Node drag-vs-click ────────────────────────────────────────────────────
  const handleNodePointerDown = React.useCallback(
    (node: GraphNodeDto, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const key = keyOf(node);
      const start = { x: e.clientX, y: e.clientY };
      const shiftKey = e.shiftKey;
      let dragging = false;
      const onMove = (ev: PointerEvent) => {
        if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > CLICK_THRESHOLD) {
          dragging = true;
          dragStart(key);
        }
        if (dragging) dragMove(key, screenToWorld(ev.clientX, ev.clientY));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (dragging) dragEnd(key);
        else onNodeClick(node, shiftKey);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [dragStart, dragMove, dragEnd, screenToWorld, onNodeClick],
  );

  // ── Background pan-vs-click ───────────────────────────────────────────────
  const handleBackgroundPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const start = { x: e.clientX, y: e.clientY };
      beginPan(e);
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointerup", onUp);
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) <= CLICK_THRESHOLD) {
          onBackgroundClick();
        }
      };
      window.addEventListener("pointerup", onUp);
    },
    [beginPan, onBackgroundClick],
  );

  // Rubber band tracking in connect mode.
  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!connectSource) return;
      setCursorWorld(screenToWorld(e.clientX, e.clientY));
    },
    [connectSource, screenToWorld],
  );

  const isNodeDimmed = (key: string) => activeNodeKeys !== null && !activeNodeKeys.has(key);
  // Edges stay readable while highlighting: dim only when BOTH ends are dimmed.
  const isEdgeDimmed = (e: GraphEdgeDto) => {
    if (path) return !path.edgeIds.has(e.id);
    if (activeNodeKeys === null) return false;
    return (
      !activeNodeKeys.has(nodeKey(e.fromType, e.fromId)) &&
      !activeNodeKeys.has(nodeKey(e.toType, e.toId))
    );
  };

  const cursor =
    mode.kind === "connect" || mode.kind === "path" ? "crosshair" : "grab";

  return (
    <svg
      ref={svgRef}
      className="h-full w-full touch-none select-none"
      style={{ cursor }}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onContextMenu={(e) => e.preventDefault()}
    >
      <GraphSvgDefs />
      <rect width="100%" height="100%" fill="var(--background)" />
      <rect width="100%" height="100%" fill="url(#dot-grid)" />
      <g ref={gRef}>
        {/* edges under nodes */}
        <g>
          {edges.map((e) => {
            const s = simNodes.get(nodeKey(e.fromType, e.fromId));
            const t = simNodes.get(nodeKey(e.toType, e.toId));
            if (!s || !t) return null;
            return (
              <GraphEdge
                key={e.id}
                edge={e}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                sourceRadius={nodeRadius(s.data)}
                targetRadius={nodeRadius(t.data)}
                isSelected={selection?.type === "edge" && selection.id === e.id}
                isDimmed={isEdgeDimmed(e)}
                isOnPath={path?.edgeIds.has(e.id) ?? false}
                colorByStrength={colorByStrength}
                onClick={onEdgeClick}
                onContextMenu={(edge, ev) => onEdgeContextMenu(edge, ev.clientX, ev.clientY)}
              />
            );
          })}
        </g>

        {/* connect-mode rubber band */}
        {connectSource && cursorWorld && (
          <line
            x1={connectSource.x}
            y1={connectSource.y}
            x2={cursorWorld.x}
            y2={cursorWorld.y}
            stroke="var(--foreground)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            pointerEvents="none"
          />
        )}

        <g>
          {nodes.map((n) => {
            const key = keyOf(n);
            const sim: SimNode | undefined = simNodes.get(key);
            if (!sim) return null;
            const hypColors = (n.hypothesisIds ?? [])
              .map((id) => hypothesisColors[id])
              .filter((c): c is string => Boolean(c));
            return (
              <GraphNode
                key={key}
                node={n}
                x={sim.x}
                y={sim.y}
                isEvidence={evidenceKeys.has(key)}
                isSelected={selection?.type === "node" && selection.key === key}
                isDimmed={path ? !path.nodeKeys.has(key) : isNodeDimmed(key)}
                isPinned={isPinned(key)}
                isConnectSource={connectSourceKey === key}
                hypColors={hypColors}
                attachableCount={n.type === "asset" ? (attachableCounts.get(n.id) ?? 0) : 0}
                collapsedCount={n.type === "asset" ? (collapsedCounts.get(n.id) ?? 0) : 0}
                onPointerDown={handleNodePointerDown}
                onContextMenu={(node, ev) => onNodeContextMenu(node, ev.clientX, ev.clientY)}
                onAttachBadgeClick={onAttachBadgeClick}
                onToggleCollapse={onToggleCollapse}
              />
            );
          })}
        </g>
      </g>
    </svg>
  );
}
