"use client";

import * as React from "react";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import {
  ACCENT,
  CROSS_HYP_COLOR,
  MANUAL_EDGE_COLOR,
  SEVERITY_COLORS,
  strengthColor,
  contrastText,
  findingCategoryCode,
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
const EDGE_HIT_THRESHOLD = 8;
const LABEL_MAX = 26;

function truncate(s: string, max = LABEL_MAX) {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

interface GraphColors {
  background: string;
  foreground: string;
  mutedForeground: string;
  card: string;
  fontMono: string;
}

function readGraphColors(): GraphColors {
  const s = getComputedStyle(document.documentElement);
  return {
    background: s.getPropertyValue("--background").trim(),
    foreground: s.getPropertyValue("--foreground").trim(),
    mutedForeground: s.getPropertyValue("--muted-foreground").trim(),
    card: s.getPropertyValue("--card").trim(),
    fontMono: s.getPropertyValue("--font-mono").trim(),
  };
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export interface GraphCanvasProps {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  layout: ReturnType<typeof useForceLayout>;
  panZoom: ReturnType<typeof usePanZoom>;
  evidenceKeys: Set<string>;
  hypothesisColors: Record<string, string>;
  attachableCounts: Map<string, number>;
  collapsedCounts: Map<string, number>;
  selection: GraphSelection;
  mode: GraphMode;
  activeNodeKeys: Set<string> | null;
  path: PathResult | null;
  colorByStrength?: boolean;
  onNodeClick: (node: GraphNodeDto, shiftKey: boolean) => void;
  onNodeContextMenu: (node: GraphNodeDto, clientX: number, clientY: number) => void;
  onEdgeClick: (edge: GraphEdgeDto) => void;
  onEdgeContextMenu: (edge: GraphEdgeDto, clientX: number, clientY: number) => void;
  onBackgroundClick: () => void;
  onAttachBadgeClick: (node: GraphNodeDto) => void;
  onToggleCollapse: (node: GraphNodeDto) => void;
}

interface HitTestResult {
  type: "node" | "edge" | "badge-attach" | "badge-collapse";
  node?: GraphNodeDto;
  edge?: GraphEdgeDto;
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
  const { simNodes, version: layoutVersion, dragStart, dragMove, dragEnd, isPinned } = layout;
  const { elementRef, transformRef, version: pzVersion, screenToWorld, beginPan } = panZoom;

  const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const rafRef = React.useRef(0);
  const colorsRef = React.useRef<GraphColors | null>(null);

  const connectSourceKey = mode.kind === "connect" ? mode.sourceKey : null;
  const cursorWorldRef = React.useRef<{ x: number; y: number } | null>(null);

  // ── Drawing ────────────────────────────────────────────────────────────────

  const draw = React.useCallback(() => {
    const canvas = elementRef.current as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = ctxRef.current;
    if (!ctx) return;

    const colors = readGraphColors();
    colorsRef.current = colors;

    const dpr = window.devicePixelRatio || 1;
    const displayW = canvas.clientWidth;
    const displayH = canvas.clientHeight;
    if (canvas.width !== Math.round(displayW * dpr) || canvas.height !== Math.round(displayH * dpr)) {
      canvas.width = Math.round(displayW * dpr);
      canvas.height = Math.round(displayH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const t = transformRef.current;

    // ── Background ──
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, displayW, displayH);

    // ── Dot grid (screen space, not zoomed) ──
    ctx.fillStyle = colors.mutedForeground;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    const gridSize = 26;
    const offX = t.x % gridSize;
    const offY = t.y % gridSize;
    for (let x = offX - gridSize; x < displayW + gridSize; x += gridSize) {
      for (let y = offY - gridSize; y < displayH + gridSize; y += gridSize) {
        ctx.moveTo(x + 1, y + 1);
        ctx.arc(x + 1, y + 1, 1, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.globalAlpha = 1;

    // ── World-space content ──
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    // Edges
    for (const e of edges) {
      const s = simNodes.get(nodeKey(e.fromType, e.fromId));
      const tt = simNodes.get(nodeKey(e.toType, e.toId));
      if (!s || !tt) continue;

      const isDimmed = path ? !path.edgeIds.has(e.id) : activeNodeKeys !== null
        && !activeNodeKeys.has(nodeKey(e.fromType, e.fromId))
        && !activeNodeKeys.has(nodeKey(e.toType, e.toId));
      const isSelected = selection?.type === "edge" && selection.id === e.id;
      const isOnPath = path?.edgeIds.has(e.id) ?? false;
      const isManual = e.origin === "MANUAL";
      const isCross = e.crossHypothesis === true;

      const sr = nodeRadius(s.data);
      const tr = nodeRadius(tt.data);
      const dx = tt.x - s.x;
      const dy = tt.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const sx = s.x + ux * (sr + 6);
      const sy = s.y + uy * (sr + 6);
      const tx = tt.x - ux * (tr + 10);
      const ty = tt.y - uy * (tr + 10);

      let stroke: string;
      let dash: number[] | undefined;
      let width: number;
      let drawArrow = false;

      if (isOnPath) {
        stroke = ACCENT;
        dash = undefined;
        width = 3;
        drawArrow = true;
      } else if (isSelected) {
        stroke = ACCENT;
        dash = undefined;
        width = 2.5;
        drawArrow = true;
      } else if (colorByStrength) {
        stroke = strengthColor(Number(e.confidence ?? 0));
        dash = undefined;
        width = 1.5;
        drawArrow = false;
      } else if (isCross) {
        stroke = CROSS_HYP_COLOR;
        dash = [6, 4];
        width = 2;
        drawArrow = true;
      } else if (isManual) {
        stroke = MANUAL_EDGE_COLOR;
        dash = [6, 4];
        width = 1.5;
        drawArrow = true;
      } else {
        stroke = colors.mutedForeground;
        dash = undefined;
        width = 1.5;
        drawArrow = true;
      }

      ctx.globalAlpha = isDimmed ? 0.08 : 1;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.setLineDash(dash ?? []);

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      // Arrowhead
      if (drawArrow && len > 20) {
        const aLen = 7;
        const aWidth = 4;
        const ax = tx - ux * 2;
        const ay = ty - uy * 2;
        ctx.fillStyle = stroke;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(ax + ux * aLen, ay + uy * aLen);
        ctx.lineTo(ax - uy * aWidth, ay + ux * aWidth);
        ctx.lineTo(ax + uy * aWidth, ay - ux * aWidth);
        ctx.closePath();
        ctx.fill();
      }

      // Edge label
      if (len > 70) {
        const midX = (sx + tx) / 2;
        const midY = (sy + ty) / 2;
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angle > 90 || angle < -90) angle += 180;

        ctx.save();
        ctx.translate(midX, midY);
        ctx.rotate((angle * Math.PI) / 180);
        ctx.font = `8.5px ${colors.fontMono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = colors.background;
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.strokeText(e.relationType, 0, -5);
        ctx.fillStyle = isOnPath ? colors.foreground : colors.mutedForeground;
        ctx.fillText(e.relationType, 0, -5);
        ctx.restore();
      }

      // Selection glow (overlay)
      if (isSelected) {
        ctx.save();
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 2;
        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 12;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.restore();
      }

      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Connect-mode rubber band
    if (connectSourceKey) {
      const src = simNodes.get(connectSourceKey);
      const cw = cursorWorldRef.current;
      if (src && cw) {
        ctx.strokeStyle = colors.foreground;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(cw.x, cw.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Nodes
    for (const n of nodes) {
      const key = keyOf(n);
      const sim: SimNode | undefined = simNodes.get(key);
      if (!sim) continue;

      const x = sim.x;
      const y = sim.y;
      const r = nodeRadius(n);
      const isFinding = n.type === "finding";
      const isDimmed = path ? !path.nodeKeys.has(key) : activeNodeKeys !== null && !activeNodeKeys.has(key);
      const selectedNode = selection?.type === "node" && selection.key === key;
      const isEvidence = evidenceKeys.has(key);
      const pinned = isPinned(key);
      const isConnectSource = connectSourceKey === key;
      const hypColors = (n.hypothesisIds ?? [])
        .map((id) => hypothesisColors[id])
        .filter((c): c is string => Boolean(c));
      const hasCrossHyp = hypColors.length > 1;
      const ringR = r + 5;

      ctx.save();
      ctx.globalAlpha = isDimmed ? 0.12 : 1;

      // Selection glow
      if (selectedNode || isConnectSource) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, ringR + 3, 0, Math.PI * 2);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 3;
        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.restore();
      }

      // Evidence ring
      if (isEvidence && !selectedNode) {
        ctx.beginPath();
        ctx.arc(x, y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // Cross-hypothesis ring
      if (hasCrossHyp) {
        ctx.beginPath();
        ctx.arc(x, y, ringR + (isEvidence ? 5 : 0), 0, Math.PI * 2);
        ctx.strokeStyle = CROSS_HYP_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Node shape
      if (isFinding) {
        const severityColor = n.severity
          ? (SEVERITY_COLORS[n.severity.toUpperCase()] ?? SEVERITY_COLORS.INFO!)
          : SEVERITY_COLORS.INFO!;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = severityColor;
        ctx.fill();
        ctx.strokeStyle = colors.foreground;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = contrastText(severityColor);
        ctx.font = `bold 8.5px ${colors.fontMono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(findingCategoryCode(n), x, y);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = colors.background;
        ctx.globalAlpha = isDimmed ? 0.12 : 0.01;
        ctx.fill();
        ctx.globalAlpha = isDimmed ? 0.12 : 1;

        ctx.beginPath();
        ctx.arc(x, y, r - 3, 0, Math.PI * 2);
        ctx.fillStyle = colors.background;
        ctx.strokeStyle = colors.foreground;
        ctx.lineWidth = 1.75;
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = colors.foreground;
        ctx.font = `bold ${r - 4}px ${colors.fontMono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const initial = n.type === "sandbox" ? "S" : (n.assetType ? n.assetType.charAt(0).toUpperCase() : "A");
        ctx.fillText(initial, x, y + 0.5);
      }

      // Hypothesis membership dots
      if (hypColors.length > 0) {
        const dots = hypColors.slice(0, 6);
        const dotSpacing = 11;
        const dotsStartX = x - ((dots.length - 1) * dotSpacing) / 2;
        const dotsY = y - (ringR + 8);
        for (let i = 0; i < dots.length; i++) {
          ctx.beginPath();
          ctx.arc(dotsStartX + i * dotSpacing, dotsY, 4, 0, Math.PI * 2);
          ctx.fillStyle = dots[i]!;
          ctx.fill();
          ctx.strokeStyle = colors.background;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Pin indicator
      if (pinned) {
        ctx.beginPath();
        ctx.arc(x + r - 2, y + r - 2, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = colors.foreground;
        ctx.fill();
        ctx.strokeStyle = colors.background;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.restore();

      // Attachable badge (drawn after restore to be on top)
      const attachableCount = n.type === "asset" ? (attachableCounts.get(n.id) ?? 0) : 0;
      if (attachableCount > 0) {
        const bw = attachableCount > 9 ? 30 : 24;
        const bh = 18;
        const bx = x + r + 4;
        const by = y - r - 4 - bh;
        ctx.save();
        ctx.fillStyle = ACCENT;
        ctx.strokeStyle = "#0a0a0a";
        ctx.lineWidth = 1.5;
        roundRect(ctx, bx, by, bw, bh, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#0a0a0a";
        ctx.font = `bold 10px ${colors.fontMono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`+${attachableCount}`, bx + bw / 2, by + bh / 2);
        ctx.restore();
      }

      // Collapsed badge
      const collapsedCount = n.type === "asset" ? (collapsedCounts.get(n.id) ?? 0) : 0;
      if (collapsedCount > 0) {
        const bw = collapsedCount > 9 ? 34 : 28;
        const bh = 18;
        const bx = x + r + 4;
        const by = y + r + 4;
        ctx.save();
        ctx.fillStyle = colors.card;
        ctx.strokeStyle = colors.foreground;
        ctx.lineWidth = 1.5;
        roundRect(ctx, bx, by, bw, bh, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = colors.foreground;
        ctx.font = `bold 9.5px ${colors.fontMono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`\u25B8${collapsedCount}`, bx + bw / 2, by + bh / 2);
        ctx.restore();
      }

      // Label
      ctx.save();
      ctx.font = `10px ${colors.fontMono}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const labelY = y + ringR + 14;
      ctx.strokeStyle = colors.background;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(truncate(n.label), x, labelY);
      ctx.fillStyle = colors.foreground;
      ctx.fillText(truncate(n.label), x, labelY);
      ctx.restore();
    }

    ctx.restore(); // world-space transform
  }, [
    nodes, edges, layout, simNodes, elementRef, transformRef,
    evidenceKeys, hypothesisColors, attachableCounts, collapsedCounts,
    selection, mode, activeNodeKeys, path, colorByStrength,
    connectSourceKey, isPinned, dragStart, dragMove, dragEnd,
    onNodeClick, onNodeContextMenu, onEdgeClick, onEdgeContextMenu,
    onBackgroundClick, onAttachBadgeClick, onToggleCollapse,
  ]);

  // ── Render loop (triggered by layout or panZoom changes) ────────────────
  const drawRef = React.useRef(draw);
  drawRef.current = draw;

  React.useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => drawRef.current());
  }, [layoutVersion, pzVersion]);

  // ── Canvas ref setup ─────────────────────────────────────────────────────

  const initCanvas = React.useCallback((canvas: HTMLCanvasElement | null) => {
    if (canvas) {
      (elementRef as React.MutableRefObject<HTMLElement | null>).current = canvas;
      ctxRef.current = canvas.getContext("2d");
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => drawRef.current());
    } else {
      (elementRef as React.MutableRefObject<HTMLElement | null>).current = null;
      ctxRef.current = null;
    }
  }, [elementRef]);

  // ── Pointer events (hit-test + drag/click) ──────────────────────────────

  // Node drag-vs-click
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;

      const w = screenToWorld(e.clientX, e.clientY);
      const nodeHit = hitTestNode(nodes, simNodes, w.x, w.y, selection, path, activeNodeKeys);
      const edgeHit = nodeHit ? null : hitTestEdge(edges, simNodes, w.x, w.y, selection, path, activeNodeKeys);

      // Badge hits
      if (!nodeHit && !edgeHit) {
        const badgeHit = hitTestBadge(nodes, simNodes, w.x, w.y, attachableCounts, collapsedCounts);
        if (badgeHit) {
          e.stopPropagation();
          if (badgeHit.type === "badge-attach" && badgeHit.node) onAttachBadgeClick(badgeHit.node);
          else if (badgeHit.type === "badge-collapse" && badgeHit.node) onToggleCollapse(badgeHit.node);
          return;
        }
      }

      if (nodeHit && nodeHit.node) {
        // Node pointer down
        e.stopPropagation();
        const key = keyOf(nodeHit.node);
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
          else onNodeClick(nodeHit.node!, shiftKey);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      } else if (edgeHit && edgeHit.edge) {
        // Edge pointer down — treat as click
        onEdgeClick(edgeHit.edge);
      } else {
        // Background pan-vs-click
        beginPan(e);
        const start = { x: e.clientX, y: e.clientY };
        const onUp = (ev: PointerEvent) => {
          window.removeEventListener("pointerup", onUp);
          if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) <= CLICK_THRESHOLD) {
            onBackgroundClick();
          }
        };
        window.addEventListener("pointerup", onUp);
      }
    },
    [
      nodes, simNodes, screenToWorld, selection, path, activeNodeKeys,
      attachableCounts, collapsedCounts, dragStart, dragMove, dragEnd,
      onNodeClick, onEdgeClick, onBackgroundClick, onAttachBadgeClick, onToggleCollapse,
      beginPan,
    ],
  );

  // Context menu
  const handleContextMenu = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const w = screenToWorld(e.clientX, e.clientY);
      const nodeHit = hitTestNode(nodes, simNodes, w.x, w.y, selection, path, activeNodeKeys);
      if (nodeHit && nodeHit.node) {
        onNodeContextMenu(nodeHit.node, e.clientX, e.clientY);
        return;
      }
      const edgeHit = hitTestEdge(edges, simNodes, w.x, w.y, selection, path, activeNodeKeys);
      if (edgeHit && edgeHit.edge) {
        onEdgeContextMenu(edgeHit.edge, e.clientX, e.clientY);
      }
    },
    [nodes, simNodes, screenToWorld, selection, path, activeNodeKeys, onNodeContextMenu, onEdgeContextMenu, edges],
  );

  // Rubber-band tracking in connect mode
  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!connectSourceKey) return;
      const w = screenToWorld(e.clientX, e.clientY);
      cursorWorldRef.current = w;
      drawRef.current();
    },
    [connectSourceKey, screenToWorld],
  );

  const cursor =
    mode.kind === "connect" || mode.kind === "path" ? "crosshair" : "grab";

  return (
    <canvas
      ref={initCanvas}
      className="h-full w-full touch-none select-none"
      style={{ cursor }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onContextMenu={handleContextMenu}
    />
  );
}

// ── Hit-testing ────────────────────────────────────────────────────────────

function hitTestNode(
  nodeList: GraphNodeDto[],
  simNodes: Map<string, SimNode>,
  wx: number,
  wy: number,
  selection: GraphSelection,
  path: PathResult | null,
  activeNodeKeys: Set<string> | null,
): HitTestResult | null {
  for (let i = nodeList.length - 1; i >= 0; i--) {
    const n = nodeList[i]!;
    const key = keyOf(n);
    const sim = simNodes.get(key);
    if (!sim) continue;
    const r = nodeRadius(n);
    const isDimmed = path ? !path.nodeKeys.has(key) : activeNodeKeys !== null && !activeNodeKeys.has(key);
    if (isDimmed) continue;
    if (Math.hypot(wx - sim.x, wy - sim.y) <= r + 3) {
      return { type: "node", node: n };
    }
  }
  return null;
}

function hitTestEdge(
  edgeList: GraphEdgeDto[],
  simNodes: Map<string, SimNode>,
  wx: number,
  wy: number,
  selection: GraphSelection,
  path: PathResult | null,
  activeNodeKeys: Set<string> | null,
): HitTestResult | null {
  for (let i = edgeList.length - 1; i >= 0; i--) {
    const e = edgeList[i]!;
    const s = simNodes.get(nodeKey(e.fromType, e.fromId));
    const t = simNodes.get(nodeKey(e.toType, e.toId));
    if (!s || !t) continue;
    const sr = nodeRadius(s.data);
    const tr = nodeRadius(t.data);
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const sx = s.x + ux * (sr + 6);
    const sy = s.y + uy * (sr + 6);
    const tx = t.x - ux * (tr + 10);
    const ty = t.y - uy * (tr + 10);

    const edgeDimmed = path ? !path.edgeIds.has(e.id) : activeNodeKeys !== null
      && !activeNodeKeys.has(nodeKey(e.fromType, e.fromId))
      && !activeNodeKeys.has(nodeKey(e.toType, e.toId));
    if (edgeDimmed) continue;

    if (distToSegment(wx, wy, sx, sy, tx, ty) < EDGE_HIT_THRESHOLD) {
      return { type: "edge", edge: e };
    }
  }
  return null;
}

function hitTestBadge(
  nodeList: GraphNodeDto[],
  simNodes: Map<string, SimNode>,
  wx: number,
  wy: number,
  attachableCounts: Map<string, number>,
  collapsedCounts: Map<string, number>,
): HitTestResult | null {
  for (let i = nodeList.length - 1; i >= 0; i--) {
    const n = nodeList[i]!;
    if (n.type !== "asset") continue;
    const sim = simNodes.get(keyOf(n));
    if (!sim) continue;
    const r = nodeRadius(n);
    const x = sim.x;
    const y = sim.y;

    const ac = attachableCounts.get(n.id) ?? 0;
    if (ac > 0) {
      const bw = ac > 9 ? 30 : 24;
      const bh = 18;
      const bx = x + r + 4;
      const by = y - r - 4 - bh;
      if (wx >= bx && wx <= bx + bw && wy >= by && wy <= by + bh) {
        return { type: "badge-attach", node: n };
      }
    }

    const cc = collapsedCounts.get(n.id) ?? 0;
    if (cc > 0) {
      const bw = cc > 9 ? 34 : 28;
      const bh = 18;
      const bx = x + r + 4;
      const by = y + r + 4;
      if (wx >= bx && wx <= bx + bw && wy >= by && wy <= by + bh) {
        return { type: "badge-collapse", node: n };
      }
    }
  }
  return null;
}

// ── Canvas helpers ─────────────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
