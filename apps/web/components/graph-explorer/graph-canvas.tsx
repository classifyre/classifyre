"use client";

import * as React from "react";
import type { GraphEdgeDto, GraphNodeDto } from "@workspace/api-client";
import {
  ACCENT,
  CROSS_HYP_COLOR,
  MANUAL_EDGE_COLOR,
  SEVERITY_COLORS,
  findingCategoryCode,
  keyOf,
  nodeKey,
  nodeRadius,
  type GraphMode,
  type GraphSelection,
  type PathResult,
  type SimNode,
} from "./graph-types";
import type { EdgeStyleOverride, NodeBadge, NodeDecorator } from "./explorer-types";
import { drawAssetIcon, drawFindingIndicator } from "./node-icons";
import { drawSeverityDonut, severityArcsOf } from "./node-render";
import { isClusterNode, isMetaEdge } from "./use-clustered-graph";
import type { useForceLayout } from "./use-force-layout";
import type { usePanZoom } from "./use-pan-zoom";

const CLICK_THRESHOLD = 4;
const EDGE_HIT_THRESHOLD = 8;
const LABEL_MAX = 26;

function truncate(s: string, max = LABEL_MAX) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
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

/** Badge box geometry, shared by drawing and hit-testing. */
function badgeRect(
  badge: NodeBadge,
  x: number,
  y: number,
  r: number,
): { bx: number; by: number; bw: number; bh: number } {
  const bw = Math.max(24, 12 + badge.text.length * 6);
  const bh = 18;
  const bx = x + r + 4;
  const by = badge.placement === "tr" ? y - r - 4 - bh : y + r + 4;
  return { bx, by, bw, bh };
}

export interface GraphCanvasProps {
  nodes: GraphNodeDto[];
  edges: GraphEdgeDto[];
  layout: ReturnType<typeof useForceLayout>;
  panZoom: ReturnType<typeof usePanZoom>;
  selection: GraphSelection;
  mode: GraphMode;
  activeNodeKeys: Set<string> | null;
  path: PathResult | null;
  /** Highlighted node (two-way hover sync with the sidebar). */
  hoverKey?: string | null;
  /** Fired when the pointer enters/leaves a node. */
  onNodeHover?: (node: GraphNodeDto | null) => void;
  /** Per-node visual extras (rings, dots, badges, fill) supplied by the view. */
  nodeDecorator?: NodeDecorator;
  /** Per-edge stroke override (e.g. similarity heat). */
  edgeStyle?: (edge: GraphEdgeDto) => EdgeStyleOverride | null;
  onNodeClick: (node: GraphNodeDto, shiftKey: boolean) => void;
  onNodeDoubleClick?: (node: GraphNodeDto) => void;
  onNodeContextMenu: (node: GraphNodeDto, clientX: number, clientY: number) => void;
  onEdgeClick: (edge: GraphEdgeDto) => void;
  onEdgeContextMenu: (edge: GraphEdgeDto, clientX: number, clientY: number) => void;
  onBackgroundClick: () => void;
  onBadgeClick?: (node: GraphNodeDto, badgeId: string) => void;
}

interface HitTestResult {
  type: "node" | "edge" | "badge";
  node?: GraphNodeDto;
  edge?: GraphEdgeDto;
  badgeId?: string;
}

export function GraphCanvas({
  nodes,
  edges,
  layout,
  panZoom,
  selection,
  mode,
  activeNodeKeys,
  path,
  hoverKey,
  onNodeHover,
  nodeDecorator,
  edgeStyle,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
  onEdgeClick,
  onEdgeContextMenu,
  onBackgroundClick,
  onBadgeClick,
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

    // Viewport culling: world-space view rect, inflated by the largest
    // node + label footprint so partially visible elements still draw.
    const cullPad = 140;
    const viewX0 = -t.x / t.k - cullPad;
    const viewY0 = -t.y / t.k - cullPad;
    const viewX1 = (displayW - t.x) / t.k + cullPad;
    const viewY1 = (displayH - t.y) / t.k + cullPad;
    const inView = (x: number, y: number) =>
      x >= viewX0 && x <= viewX1 && y >= viewY0 && y <= viewY1;

    // Zoom-based level of detail: fine print only when it is readable.
    const showLabels = t.k > 0.5;
    const showDetail = t.k > 0.3;

    // Edges
    for (const e of edges) {
      const s = simNodes.get(nodeKey(e.fromType, e.fromId));
      const tt = simNodes.get(nodeKey(e.toType, e.toId));
      if (!s || !tt) continue;

      // Skip edges whose bounding box misses the viewport entirely.
      if (
        Math.max(s.x, tt.x) < viewX0 ||
        Math.min(s.x, tt.x) > viewX1 ||
        Math.max(s.y, tt.y) < viewY0 ||
        Math.min(s.y, tt.y) > viewY1
      ) {
        continue;
      }

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

      // Aggregated cluster↔cluster edges get weight-scaled thickness.
      if (isMetaEdge(e)) {
        width = 1.5 + Math.log2(e.meta.linkCount + 1);
        drawArrow = false;
      }

      // View-supplied override only applies to the resting style, never to
      // path/selection emphasis.
      if (!isOnPath && !isSelected && edgeStyle) {
        const o = edgeStyle(e);
        if (o) {
          stroke = o.stroke ?? stroke;
          dash = o.dash ?? dash;
          width = o.width ?? width;
          drawArrow = o.arrow ?? drawArrow;
        }
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

      // Edge label — only when the edge is long enough on screen to read.
      if (showLabels && len * t.k > 70) {
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
      if (!inView(x, y)) continue;
      const r = nodeRadius(n);
      const isFinding = n.type === "finding";
      const isDimmed = path ? !path.nodeKeys.has(key) : activeNodeKeys !== null && !activeNodeKeys.has(key);
      const selectedNode = selection?.type === "node" && selection.key === key;
      const pinned = isPinned(key);
      const isConnectSource = connectSourceKey === key;
      const deco = nodeDecorator?.(n) ?? null;
      const dots = deco?.dots ?? [];
      const ringR = r + 5;

      ctx.save();
      ctx.globalAlpha = isDimmed ? 0.12 : 1;

      // Hover ring (sidebar or pointer hover)
      if (hoverKey === key && !selectedNode) {
        ctx.beginPath();
        ctx.arc(x, y, ringR + 3, 0, Math.PI * 2);
        ctx.strokeStyle = colors.foreground;
        ctx.globalAlpha = isDimmed ? 0.3 : 0.55;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = isDimmed ? 0.12 : 1;
      }

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

      // Solid decoration ring (evidence, external, …)
      if (deco?.ringColor && !selectedNode) {
        ctx.beginPath();
        ctx.arc(x, y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = deco.ringColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // Dashed decoration ring (cross-hypothesis)
      if (deco?.dashedRingColor) {
        ctx.beginPath();
        ctx.arc(x, y, ringR + (deco.ringColor ? 5 : 0), 0, Math.PI * 2);
        ctx.strokeStyle = deco.dashedRingColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Node shape
      if (isClusterNode(n)) {
        const meta = n.cluster;
        const sevColor = meta.topSeverity ? SEVERITY_COLORS[meta.topSeverity] : undefined;

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = colors.card;
        ctx.strokeStyle = colors.foreground;
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        // Severity mix ring — the "how bad is this neighborhood" signal.
        drawSeverityDonut(ctx, x, y, r + 3, severityArcsOf({
          severityCounts: meta.severityCounts,
          total: Object.values(meta.severityCounts).reduce((a, b) => a + b, 0),
        }));

        ctx.fillStyle = colors.foreground;
        ctx.font = `bold ${Math.max(12, Math.round(r * 0.55))}px ${colors.fontMono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(meta.assetCount || meta.size), x, y - (meta.findingCount > 0 ? 4 : 0));
        if (meta.findingCount > 0) {
          ctx.fillStyle = sevColor ?? colors.mutedForeground;
          ctx.font = `bold 9.5px ${colors.fontMono}`;
          ctx.fillText(`⚑ ${meta.findingCount}`, x, y + Math.max(10, r * 0.4));
        }
      } else if (isFinding) {
        const fillColor =
          deco?.fillOverride ??
          (n.severity
            ? (SEVERITY_COLORS[n.severity.toUpperCase()] ?? SEVERITY_COLORS.INFO!)
            : SEVERITY_COLORS.INFO!);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = colors.foreground;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        if (deco?.findingGlyph === "icon") {
          drawFindingIndicator(ctx, n, x, y, r * 1.5);
        } else {
          ctx.font = `bold ${Math.round(r * 0.82)}px ${colors.fontMono}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(findingCategoryCode(n), x, y + 0.5);
        }
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
        drawAssetIcon(ctx, n, x, y, (r - 3) * 1.5);

        // Severity donut: the collapsed-findings mix at a glance.
        if (deco?.severityArcs && deco.severityArcs.length > 0) {
          drawSeverityDonut(ctx, x, y, r + 1, deco.severityArcs);
        }
      }

      // Membership dots (hypotheses)
      if (showDetail && dots.length > 0) {
        const shown = dots.slice(0, 6);
        const dotSpacing = 11;
        const dotsStartX = x - ((shown.length - 1) * dotSpacing) / 2;
        const dotsY = y - (ringR + 8);
        for (let i = 0; i < shown.length; i++) {
          ctx.beginPath();
          ctx.arc(dotsStartX + i * dotSpacing, dotsY, 4, 0, Math.PI * 2);
          ctx.fillStyle = shown[i]!;
          ctx.fill();
          ctx.strokeStyle = colors.background;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Pin indicator
      if (showDetail && pinned) {
        ctx.beginPath();
        ctx.arc(x + r - 2, y + r - 2, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = colors.foreground;
        ctx.fill();
        ctx.strokeStyle = colors.background;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.restore();

      // Corner badges (drawn after restore to sit on top, undimmed)
      for (const badge of showDetail ? (deco?.badges ?? []) : []) {
        const { bx, by, bw, bh } = badgeRect(badge, x, y, r);
        ctx.save();
        ctx.fillStyle = badge.accent ? ACCENT : colors.card;
        ctx.strokeStyle = badge.accent ? "#0a0a0a" : colors.foreground;
        ctx.lineWidth = 1.5;
        roundRect(ctx, bx, by, bw, bh, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = badge.accent ? "#0a0a0a" : colors.foreground;
        ctx.font = `bold 10px ${colors.fontMono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(badge.text, bx + bw / 2, by + bh / 2);
        ctx.restore();
      }

      // Label — clusters keep theirs at any zoom (they ARE the overview);
      // plain nodes only when readable.
      if (showLabels || isClusterNode(n)) {
        ctx.save();
        ctx.font = `10px ${colors.fontMono}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const labelY = y + ringR + 14;
        ctx.strokeStyle = colors.background;
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.globalAlpha = isDimmed ? 0.12 : 1;
        ctx.strokeText(truncate(n.label), x, labelY);
        ctx.fillStyle = colors.foreground;
        ctx.fillText(truncate(n.label), x, labelY);
        ctx.restore();
      }
    }

    ctx.restore(); // world-space transform
  }, [
    nodes, edges, layout, simNodes, elementRef, transformRef,
    selection, mode, activeNodeKeys, path, hoverKey, nodeDecorator, edgeStyle,
    connectSourceKey, isPinned,
  ]);

  // ── Render loop (triggered by layout or panZoom changes) ────────────────
  const drawRef = React.useRef(draw);
  drawRef.current = draw;

  React.useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => drawRef.current());
  }, [layoutVersion, pzVersion, draw]);

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

  const lastClickRef = React.useRef<{ key: string; time: number }>({ key: "", time: 0 });

  // Node drag-vs-click
  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;

      const w = screenToWorld(e.clientX, e.clientY);
      const nodeHit = hitTestNode(nodes, simNodes, w.x, w.y, path, activeNodeKeys);
      const edgeHit = nodeHit ? null : hitTestEdge(edges, simNodes, w.x, w.y, path, activeNodeKeys);

      // Badge hits
      if (!nodeHit && !edgeHit && nodeDecorator && onBadgeClick) {
        const badgeHit = hitTestBadge(nodes, simNodes, w.x, w.y, nodeDecorator);
        if (badgeHit?.node && badgeHit.badgeId) {
          e.stopPropagation();
          onBadgeClick(badgeHit.node, badgeHit.badgeId);
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
          if (dragging) {
            dragEnd(key);
            return;
          }
          const now = performance.now();
          const last = lastClickRef.current;
          if (onNodeDoubleClick && last.key === key && now - last.time < 350) {
            lastClickRef.current = { key: "", time: 0 };
            onNodeDoubleClick(nodeHit.node!);
          } else {
            lastClickRef.current = { key, time: now };
            onNodeClick(nodeHit.node!, shiftKey);
          }
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
      nodes, edges, simNodes, screenToWorld, path, activeNodeKeys,
      nodeDecorator, dragStart, dragMove, dragEnd,
      onNodeClick, onNodeDoubleClick, onEdgeClick, onBackgroundClick, onBadgeClick,
      beginPan,
    ],
  );

  // Context menu
  const handleContextMenu = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const w = screenToWorld(e.clientX, e.clientY);
      const nodeHit = hitTestNode(nodes, simNodes, w.x, w.y, path, activeNodeKeys);
      if (nodeHit && nodeHit.node) {
        onNodeContextMenu(nodeHit.node, e.clientX, e.clientY);
        return;
      }
      const edgeHit = hitTestEdge(edges, simNodes, w.x, w.y, path, activeNodeKeys);
      if (edgeHit && edgeHit.edge) {
        onEdgeContextMenu(edgeHit.edge, e.clientX, e.clientY);
      }
    },
    [nodes, simNodes, screenToWorld, path, activeNodeKeys, onNodeContextMenu, onEdgeContextMenu, edges],
  );

  // Rubber-band tracking in connect mode + hover reporting
  const lastHoverRef = React.useRef<string | null>(null);
  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      const w = screenToWorld(e.clientX, e.clientY);
      if (connectSourceKey) {
        cursorWorldRef.current = w;
        drawRef.current();
      }
      if (onNodeHover) {
        const hit = hitTestNode(nodes, simNodes, w.x, w.y, path, activeNodeKeys);
        const key = hit?.node ? keyOf(hit.node) : null;
        if (key !== lastHoverRef.current) {
          lastHoverRef.current = key;
          onNodeHover(hit?.node ?? null);
        }
      }
    },
    [connectSourceKey, screenToWorld, onNodeHover, nodes, simNodes, path, activeNodeKeys],
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
      onPointerLeave={() => {
        if (onNodeHover && lastHoverRef.current !== null) {
          lastHoverRef.current = null;
          onNodeHover(null);
        }
      }}
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
  nodeDecorator: NodeDecorator,
): HitTestResult | null {
  for (let i = nodeList.length - 1; i >= 0; i--) {
    const n = nodeList[i]!;
    const sim = simNodes.get(keyOf(n));
    if (!sim) continue;
    const badges = nodeDecorator(n)?.badges;
    if (!badges || badges.length === 0) continue;
    const r = nodeRadius(n);
    for (const badge of badges) {
      const { bx, by, bw, bh } = badgeRect(badge, sim.x, sim.y, r);
      if (wx >= bx && wx <= bx + bw && wy >= by && wy <= by + bh) {
        return { type: "badge", node: n, badgeId: badge.id };
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
  ctx.arcTo(x, y + h, x, y + r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
