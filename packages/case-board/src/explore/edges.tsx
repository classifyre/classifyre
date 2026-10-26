"use client";

import * as React from "react";
import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import { EdgeLabel, EdgeText } from "../components/edge-label";
import { useEdgeGeometry } from "../hooks/use-edge-geometry";
import { useLabelsVisible } from "../hooks/use-lod";
import { useExploreCanvas } from "./canvas-context";
import { EXPLORE_KIND_DASH, EXPLORE_KIND_STROKE, type ExploreLink } from "./model";

export type ExploreFlowEdge = Edge<{ link: ExploreLink; bend?: number }>;

/**
 * A link and its reason, drawn the way its kind's legend mark is (see
 * EXPLORE_KIND_DASH): lineage solid with an arrow, scored matches dashed
 * and fainter the weaker they are, a link a person drew amber and solid.
 * The words lie along the line when zoomed in, and show on hover at any
 * zoom.
 */
export const ExploreEdge = React.memo(function ExploreEdge({ id, source, target, data, selected }: EdgeProps<ExploreFlowEdge>) {
  const labelsVisible = useLabelsVisible();
  const { hoveredLinkId, words } = useExploreCanvas();
  const g = useEdgeGeometry(source, target, data?.bend);
  const link = data?.link;
  if (!g || !link) return null;
  const hovered = hoveredLinkId === id;
  const color = selected ? "var(--cb-select)" : link.manual ? "var(--cb-manual)" : EXPLORE_KIND_STROKE[link.kind];
  const strength = link.strength == null ? 1 : Math.max(0.55, Math.min(1, link.strength));
  const marker = link.directed ? (link.manual ? "url(#cb-arrow-manual)" : "url(#cb-arrow-ink)") : undefined;
  return (
    <>
      <BaseEdge
        id={id}
        path={g.path}
        interactionWidth={14}
        markerEnd={marker}
        style={{
          stroke: color,
          strokeWidth: selected || hovered ? 2.5 : link.manual ? 2 : 1.5,
          strokeDasharray: link.manual ? undefined : EXPLORE_KIND_DASH[link.kind],
          opacity: selected || hovered ? 1 : strength,
        }}
      />
      {labelsVisible && !hovered && !selected && g.length > 90 && link.label && (
        <EdgeText x={g.labelX} y={g.labelY} angle={g.angle} className="text-muted-foreground">
          {link.label}
        </EdgeText>
      )}
      {(hovered || selected) && link.label && (
        <EdgeLabel x={g.labelX} y={g.labelY} className="max-w-[260px] font-mono">
          {link.label}
          {link.manual && <span className="ml-1 text-[var(--cb-manual)]">· {words.yours}</span>}
        </EdgeLabel>
      )}
    </>
  );
});

export const EXPLORE_EDGE_TYPES = { explore: ExploreEdge };
