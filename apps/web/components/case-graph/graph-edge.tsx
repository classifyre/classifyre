"use client";

import * as React from "react";
import type { GraphEdgeDto } from "@workspace/api-client";
import {
  ACCENT,
  CROSS_HYP_COLOR,
  MANUAL_EDGE_COLOR,
  strengthColor,
} from "./graph-types";

export interface GraphEdgeProps {
  edge: GraphEdgeDto;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** trim ends so arrows do not pierce the node shapes */
  sourceRadius: number;
  targetRadius: number;
  isSelected: boolean;
  isDimmed: boolean;
  isOnPath: boolean;
  /** Colour the line by edge.confidence (0..1) as a similarity-strength heat. */
  colorByStrength?: boolean;
  onClick: (edge: GraphEdgeDto, e: React.MouseEvent) => void;
  onContextMenu: (edge: GraphEdgeDto, e: React.MouseEvent) => void;
}

export const GraphEdge = React.memo(function GraphEdge({
  edge,
  x1,
  y1,
  x2,
  y2,
  sourceRadius,
  targetRadius,
  isSelected,
  isDimmed,
  isOnPath,
  colorByStrength,
  onClick,
  onContextMenu,
}: GraphEdgeProps) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = x1 + ux * (sourceRadius + 6);
  const sy = y1 + uy * (sourceRadius + 6);
  const tx = x2 - ux * (targetRadius + 10);
  const ty = y2 - uy * (targetRadius + 10);

  const isManual = edge.origin === "MANUAL";
  const isCross = edge.crossHypothesis === true;

  let stroke = "var(--muted-foreground)";
  let marker: string | undefined = "url(#arrow-default)";
  let dash: string | undefined;
  if (isCross) {
    stroke = CROSS_HYP_COLOR;
    marker = "url(#arrow-cross)";
    dash = "6 4";
  } else if (isManual) {
    stroke = MANUAL_EDGE_COLOR;
    marker = "url(#arrow-manual)";
    dash = "6 4";
  }
  // Similarity-strength heat colour (keeps any manual/cross dash for distinction).
  if (colorByStrength) {
    stroke = strengthColor(Number(edge.confidence ?? 0));
    marker = undefined; // direction is not meaningful here
  }
  if (isOnPath) {
    stroke = ACCENT;
    marker = "url(#arrow-path)";
    dash = undefined;
  }

  const midX = (sx + tx) / 2;
  const midY = (sy + ty) / 2;
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 90 || angle < -90) angle += 180; // keep labels upright

  const width = isOnPath ? 3 : isSelected ? 2.5 : isCross ? 2 : 1.5;

  return (
    <g
      style={{ opacity: isDimmed ? 0.08 : 1, transition: "opacity 200ms ease", cursor: "pointer" }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(edge, e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(edge, e);
      }}
    >
      {/* invisible fat hit line */}
      <line x1={sx} y1={sy} x2={tx} y2={ty} stroke="transparent" strokeWidth={14} />
      <line
        x1={sx}
        y1={sy}
        x2={tx}
        y2={ty}
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={dash}
        markerEnd={marker}
        style={isSelected ? { filter: "url(#node-glow)" } : undefined}
      />
      {len > 70 && (
        <text
          transform={`translate(${midX},${midY}) rotate(${angle})`}
          y={-5}
          textAnchor="middle"
          fontSize={8.5}
          fill={isOnPath ? "var(--foreground)" : "var(--muted-foreground)"}
          stroke="var(--background)"
          strokeWidth={3}
          paintOrder="stroke"
          style={{
            fontFamily: "var(--font-mono)",
            textTransform: "lowercase",
            letterSpacing: "0.04em",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {edge.relationType}
        </text>
      )}
    </g>
  );
});
