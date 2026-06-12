"use client";

import * as React from "react";
import type { GraphNodeDto } from "@workspace/api-client";
import { FlaskConical } from "lucide-react";
import { getAssetKindIcon } from "@/lib/asset-kind";
import {
  ACCENT,
  CROSS_HYP_COLOR,
  SEVERITY_COLORS,
  contrastText,
  findingCategoryCode,
  nodeRadius,
} from "./graph-types";

const LABEL_MAX = 26;

function truncate(s: string, max = LABEL_MAX) {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
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
  /** Attached findings currently hidden because the asset is collapsed. */
  collapsedCount: number;
  onPointerDown: (node: GraphNodeDto, e: React.PointerEvent) => void;
  onContextMenu: (node: GraphNodeDto, e: React.MouseEvent) => void;
  onAttachBadgeClick: (node: GraphNodeDto) => void;
  onToggleCollapse: (node: GraphNodeDto) => void;
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
  collapsedCount,
  onPointerDown,
  onContextMenu,
  onAttachBadgeClick,
  onToggleCollapse,
}: GraphNodeProps) {
  const r = nodeRadius(node);
  const isFinding = node.type === "finding";
  const severityColor = node.severity
    ? (SEVERITY_COLORS[node.severity.toUpperCase()] ?? SEVERITY_COLORS.INFO!)
    : SEVERITY_COLORS.INFO!;

  const crossHyp = hypColors.length > 1;
  const ringR = r + 5;
  const dots = hypColors.slice(0, 6);
  const dotSpacing = 11;
  const dotsStartX = -((dots.length - 1) * dotSpacing) / 2;

  const AssetIcon = node.type === "sandbox" ? FlaskConical : getAssetKindIcon(node.assetType);

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

      {/* Shape + hit area */}
      {isFinding ? (
        <>
          <circle r={r} fill={severityColor} stroke="var(--foreground)" strokeWidth={2} />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={8.5}
            fontWeight={700}
            fill={contrastText(severityColor)}
            style={{ fontFamily: "var(--font-mono)", pointerEvents: "none", userSelect: "none" }}
          >
            {findingCategoryCode(node)}
          </text>
        </>
      ) : (
        <>
          {/* invisible hit circle — the icon itself is mostly strokes */}
          <circle r={r + 3} fill="var(--background)" fillOpacity={0.01} />
          <AssetIcon
            x={-r + 3}
            y={-r + 3}
            width={(r - 3) * 2}
            height={(r - 3) * 2}
            strokeWidth={1.75}
            color="var(--foreground)"
            style={{ pointerEvents: "none" }}
          />
        </>
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

      {/* Attachable (unattached) findings badge — acid green */}
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

      {/* Collapsed attached findings chip — click to expand */}
      {collapsedCount > 0 && (
        <g
          transform={`translate(${r + 4},${r + 4})`}
          style={{ cursor: "pointer" }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(node);
          }}
        >
          <rect
            x={0}
            y={-9}
            width={collapsedCount > 9 ? 34 : 28}
            height={18}
            fill="var(--card)"
            stroke="var(--foreground)"
            strokeWidth={1.5}
            rx={2}
          />
          <text
            x={collapsedCount > 9 ? 17 : 14}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={9.5}
            fontWeight={700}
            fill="var(--foreground)"
            style={{ fontFamily: "var(--font-mono)", userSelect: "none" }}
          >
            ▸{collapsedCount}
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
