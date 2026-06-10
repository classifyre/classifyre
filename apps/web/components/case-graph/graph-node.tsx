"use client";

import * as React from "react";
import type { GraphNodeDto } from "@workspace/api-client";
import {
  ACCENT,
  CROSS_HYP_COLOR,
  SEVERITY_COLORS,
  nodeRadius,
} from "./graph-types";

const LABEL_MAX = 26;

function truncate(s: string, max = LABEL_MAX) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Compact source/asset code shown inside asset squares, e.g. "JIRA", "S3". */
function assetCode(node: GraphNodeDto): string {
  const src = node.sourceType ?? node.assetType ?? node.type;
  const clean = src.replace(/[^a-zA-Z0-9]/g, "");
  return (clean.length <= 4 ? clean : clean.slice(0, 3)).toUpperCase() || "?";
}

export interface GraphNodeProps {
  node: GraphNodeDto;
  x: number;
  y: number;
  isEvidence: boolean;
  isSelected: boolean;
  isDimmed: boolean;
  isPinned: boolean;
  isConnectSource: boolean;
  hypColors: string[];
  /** Findings on this asset that are not yet case evidence. */
  attachableCount: number;
  onPointerDown: (node: GraphNodeDto, e: React.PointerEvent) => void;
  onContextMenu: (node: GraphNodeDto, e: React.MouseEvent) => void;
  onAttachBadgeClick: (node: GraphNodeDto) => void;
}

export const GraphNode = React.memo(function GraphNode({
  node,
  x,
  y,
  isEvidence,
  isSelected,
  isDimmed,
  isPinned,
  isConnectSource,
  hypColors,
  attachableCount,
  onPointerDown,
  onContextMenu,
  onAttachBadgeClick,
}: GraphNodeProps) {
  const r = nodeRadius(node);
  const isFinding = node.type === "finding";
  const severityColor = node.severity
    ? (SEVERITY_COLORS[node.severity.toUpperCase()] ?? SEVERITY_COLORS.INFO)
    : SEVERITY_COLORS.INFO;
  const crossHyp = (node.hypothesisIds?.length ?? 0) > 1;

  let shape: React.ReactNode;
  if (isFinding) {
    shape = (
      <circle r={r} fill={severityColor} stroke="var(--foreground)" strokeWidth={2} />
    );
  } else if (node.type === "sandbox") {
    shape = (
      <rect
        x={-r}
        y={-r}
        width={r * 2}
        height={r * 2}
        rx={2}
        transform="rotate(45)"
        fill="var(--card)"
        stroke="var(--foreground)"
        strokeWidth={2}
      />
    );
  } else {
    shape = (
      <rect
        x={-r}
        y={-r}
        width={r * 2}
        height={r * 2}
        rx={3}
        fill="var(--card)"
        stroke="var(--foreground)"
        strokeWidth={2}
      />
    );
  }

  const ringR = r + 5;
  const dots = hypColors.slice(0, 6);
  const dotSpacing = 11;
  const dotsStartX = -((dots.length - 1) * dotSpacing) / 2;

  return (
    <g
      transform={`translate(${x},${y})`}
      style={{
        opacity: isDimmed ? 0.12 : 1,
        transition: "opacity 200ms ease",
        cursor: "pointer",
      }}
      onPointerDown={(e) => onPointerDown(node, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(node, e);
      }}
    >
      {/* Selection glow under everything */}
      {(isSelected || isConnectSource) && (
        <circle r={ringR + 3} fill="none" stroke={ACCENT} strokeWidth={3} filter="url(#node-glow)" />
      )}

      {/* Evidence ring */}
      {isEvidence && !isSelected && (
        <circle r={ringR} fill="none" stroke={ACCENT} strokeWidth={2.5} />
      )}

      {/* Cross-hypothesis emphasis */}
      {crossHyp && (
        <circle
          r={ringR + (isEvidence ? 5 : 0)}
          fill="none"
          stroke={CROSS_HYP_COLOR}
          strokeWidth={2}
          strokeDasharray="4 3"
        />
      )}

      {shape}

      {/* Asset/sandbox source code glyph */}
      {!isFinding && (
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={9}
          fontWeight={700}
          fill="var(--foreground)"
          style={{ fontFamily: "var(--font-mono)", pointerEvents: "none", userSelect: "none" }}
        >
          {assetCode(node)}
        </text>
      )}

      {/* Severity initial inside findings */}
      {isFinding && node.severity && (
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={9}
          fontWeight={700}
          fill="#ffffff"
          style={{ fontFamily: "var(--font-mono)", pointerEvents: "none", userSelect: "none" }}
        >
          {node.severity[0]?.toUpperCase()}
        </text>
      )}

      {/* Hypothesis membership dots */}
      {dots.map((color, i) => (
        <circle
          key={i}
          cx={dotsStartX + i * dotSpacing}
          cy={-(ringR + 8)}
          r={4}
          fill={color}
          stroke="var(--background)"
          strokeWidth={1.5}
        />
      ))}

      {/* Pin indicator */}
      {isPinned && (
        <circle cx={r - 2} cy={r - 2} r={3.5} fill="var(--foreground)" stroke="var(--background)" strokeWidth={1.5} />
      )}

      {/* Attachable findings badge */}
      {attachableCount > 0 && (
        <g
          transform={`translate(${r + 4},${-r - 4})`}
          style={{ cursor: "pointer" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onAttachBadgeClick(node);
          }}
        >
          <rect x={0} y={-9} width={attachableCount > 9 ? 30 : 24} height={18} fill={ACCENT} stroke="#0a0a0a" strokeWidth={1.5} rx={2} />
          <text
            x={attachableCount > 9 ? 15 : 12}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fontWeight={700}
            fill="#0a0a0a"
            style={{ fontFamily: "var(--font-mono)", userSelect: "none" }}
          >
            +{attachableCount}
          </text>
        </g>
      )}

      {/* Label */}
      <text
        y={ringR + 14}
        textAnchor="middle"
        fontSize={10}
        fill="var(--foreground)"
        stroke="var(--background)"
        strokeWidth={3}
        paintOrder="stroke"
        style={{ fontFamily: "var(--font-mono)", pointerEvents: "none", userSelect: "none" }}
      >
        {truncate(node.label)}
      </text>
    </g>
  );
});
