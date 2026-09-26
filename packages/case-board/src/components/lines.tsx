"use client";

import * as React from "react";
import { BaseEdge } from "@xyflow/react";
import { Check, Circle, Globe, X } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { offsetFrom } from "../lib/anchor";
import { DIRECTED_LINK_KINDS, isDirectedKind, STANCE_STROKE, TRACE_KIND_STROKE, type Stance, type TraceKind } from "../lib/kinds";
import type { EdgeGeometry } from "../hooks/use-edge-geometry";
import { EdgeLabel, EdgeText } from "./edge-label";

/**
 * How each kind of edge is drawn, from its geometry (useEdgeGeometry) and
 * what it says. The board's edges look their data up in the store and pass
 * it here; the documentation's demos pass it directly.
 */

const STANCE_ICON = { SUPPORTS: Check, CONTRADICTS: X, NEUTRAL: Circle } as const;

/**
 * Hypothesis ⇄ evidence (PRD §5.3): green ✓ supports, red dashed ✗
 * contradicts, grey ○ neutral. The glyph sits at the hypothesis end, so the
 * direction of the claim reads without a legend.
 */
export function StanceLine({
  id,
  g,
  stance,
  labelsVisible,
  selected = false,
  pending = false,
  card = null,
}: {
  id: string;
  g: EdgeGeometry;
  stance: Stance;
  labelsVisible: boolean;
  selected?: boolean;
  pending?: boolean;
  /** Shown mid-edge while hovered or selected. */
  card?: React.ReactNode;
}) {
  const style = STANCE_STROKE[stance];
  const Icon = STANCE_ICON[stance];
  const glyph = offsetFrom({ x: g.sx, y: g.sy }, g.sourceNormal, 14);
  return (
    <>
      <BaseEdge
        id={id}
        path={g.path}
        interactionWidth={16}
        style={{
          stroke: selected ? "var(--cb-select)" : style.color,
          strokeWidth: 2 + (selected ? 1 : 0),
          strokeDasharray: style.dash,
          opacity: pending ? 0.6 : 1,
        }}
      />
      {labelsVisible && (
        <EdgeLabel x={glyph.x} y={glyph.y} className="flex size-4 items-center justify-center rounded-full border-0 p-0">
          <span className="flex size-4 items-center justify-center rounded-full text-white" style={{ background: style.color }}>
            <Icon className="size-2.5" strokeWidth={3} aria-hidden />
          </span>
        </EdgeLabel>
      )}
      {card && (
        <EdgeLabel x={g.labelX} y={g.labelY} className="max-w-[260px]">
          {card}
        </EdgeLabel>
      )}
    </>
  );
}

/**
 * A link someone drew on the board (PRD §5.3), in the old graph's manual-edge
 * amber: solid when confirmed, dashed when suspected, red for "contradicts",
 * thicker with confidence. Its kind is written along it; a globe marks a link
 * every case sees.
 */
export function LinkLine({
  id,
  g,
  kind,
  text,
  showText,
  confidence = 0.5,
  suspected = false,
  global = false,
  selected = false,
  suspectedLabel,
  globalLabel,
  card = null,
}: {
  id: string;
  g: EdgeGeometry;
  kind: string;
  /** The link's own label, or its kind in words. */
  text: string;
  showText: boolean;
  confidence?: number;
  suspected?: boolean;
  global?: boolean;
  selected?: boolean;
  suspectedLabel: string;
  globalLabel: string;
  /** Shown under the edge's text while hovered. */
  card?: React.ReactNode;
}) {
  const contradicts = kind === "contradicts";
  const color = selected ? "var(--cb-select)" : contradicts ? "var(--cb-contradicts)" : "var(--cb-manual)";
  const marker = selected ? "url(#cb-arrow-select)" : contradicts ? "url(#cb-arrow-red)" : "url(#cb-arrow-manual)";
  return (
    <>
      <BaseEdge
        id={id}
        path={g.path}
        interactionWidth={16}
        markerEnd={DIRECTED_LINK_KINDS.has(kind) ? marker : undefined}
        style={{
          stroke: color,
          strokeWidth: 1.25 + 1.75 * Math.max(0, Math.min(1, confidence)) + (selected ? 0.75 : 0),
          strokeDasharray: suspected || contradicts ? "6 4" : undefined,
        }}
      />
      {showText && g.length > 60 && (
        <EdgeText
          x={g.labelX}
          y={g.labelY}
          angle={g.angle}
          className={cn(selected ? "text-foreground" : contradicts ? "text-[var(--cb-contradicts)]" : "text-[var(--cb-manual)]")}
        >
          <span className="max-w-[200px] truncate">{text}</span>
          {suspected && <span className="opacity-80">· {suspectedLabel}</span>}
          {global && <Globe className="size-2.5 shrink-0" aria-label={globalLabel} />}
        </EdgeText>
      )}
      {card && (
        <EdgeLabel x={g.labelX} y={g.labelY + 20} className="text-[10px] text-muted-foreground">
          {card}
        </EdgeLabel>
      )}
    </>
  );
}

/**
 * A relation the platform found, drawn as the old case graph drew it: a thin
 * line with an arrow the way it points, its type written along it (CONTAINS,
 * TRANSFORM, REFERENCES…). Duplicates are dashed and point nowhere.
 */
export function SystemLine({
  id,
  g,
  relationType,
  showText,
  identity = false,
  count = 1,
  selected = false,
  card = null,
}: {
  id: string;
  g: EdgeGeometry;
  relationType: string;
  showText: boolean;
  /** A duplicate: dashed, no arrow. */
  identity?: boolean;
  /** Parallel relations folded into this one. */
  count?: number;
  selected?: boolean;
  /** The hover card: what the relation means, and that it is locked. */
  card?: React.ReactNode;
}) {
  return (
    <>
      <BaseEdge
        id={id}
        path={g.path}
        interactionWidth={14}
        markerEnd={identity ? undefined : selected ? "url(#cb-arrow-select)" : "url(#cb-arrow-system)"}
        style={{
          stroke: selected ? "var(--cb-select)" : "var(--cb-edge)",
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: identity ? "5 4" : undefined,
        }}
      />
      {showText && g.length > 70 && (
        <EdgeText x={g.labelX} y={g.labelY} angle={g.angle} className={selected ? "text-foreground" : undefined}>
          {relationType}
          {count > 1 && <span>×{count}</span>}
        </EdgeText>
      )}
      {card && (
        <EdgeLabel x={g.labelX} y={g.labelY + 20} className="max-w-[260px] shadow-none">
          {card}
        </EdgeLabel>
      )}
    </>
  );
}

/** An asset's own finding: "contains", as the old graph labelled it. Dashed for one not in the case. */
export function ContainsLine({
  id,
  g,
  text,
  showText,
  ghost = false,
}: {
  id: string;
  g: EdgeGeometry;
  text: string;
  showText: boolean;
  ghost?: boolean;
}) {
  return (
    <>
      <BaseEdge
        id={id}
        path={g.path}
        interactionWidth={0}
        markerEnd="url(#cb-arrow-system)"
        style={{
          stroke: "var(--cb-edge)",
          strokeWidth: 1.25,
          strokeDasharray: ghost ? "3 3" : undefined,
          opacity: ghost ? 0.7 : 1,
        }}
      />
      {showText && g.length > 60 && (
        <EdgeText x={g.labelX} y={g.labelY} angle={g.angle}>
          {text}
        </EdgeText>
      )}
    </>
  );
}

/**
 * A relation "Show connections" found beyond the board, drawn as a ghost of a
 * system edge: dashed, tinted by its kind, pointing the way lineage and links
 * point, its type written along it.
 */
export function TraceLine({
  id,
  g,
  kind,
  relationType,
  showText,
}: {
  id: string;
  g: EdgeGeometry;
  kind: TraceKind;
  relationType: string;
  showText: boolean;
}) {
  return (
    <>
      <BaseEdge
        id={id}
        path={g.path}
        interactionWidth={10}
        markerEnd={isDirectedKind(kind) ? "url(#cb-arrow-system)" : undefined}
        style={{ stroke: TRACE_KIND_STROKE[kind], strokeWidth: 1.5, strokeDasharray: "6 4", opacity: 0.85 }}
      />
      {showText && g.length > 80 && (
        <EdgeText x={g.labelX} y={g.labelY} angle={g.angle} className="text-muted-foreground">
          {relationType}
        </EdgeText>
      )}
    </>
  );
}
