"use client";

import * as React from "react";
import {
  BaseEdge,
  getSmoothStepPath,
  Position,
  useStore as useFlowStore,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";
import { EdgeLabel } from "@workspace/case-board/components/edge-label";
import { cn } from "@workspace/ui/lib/utils";
import { LOD_ZOOM_THRESHOLD, type SchemaRelationFlowEdge } from "../types";

function parseCardinality(
  cardinality?: string,
): [string, string] | null {
  if (!cardinality) return null;
  const parts = cardinality.split("-");
  if (parts.length !== 2) return null;
  return [parts[0]!, parts[1]!];
}

function markerOffset(position: Position): { dx: number; dy: number } {
  switch (position) {
    case Position.Left:
      return { dx: -14, dy: -6 };
    case Position.Right:
      return { dx: 14, dy: -6 };
    case Position.Top:
      return { dx: 10, dy: -12 };
    case Position.Bottom:
      return { dx: 10, dy: 14 };
  }
}

export const SchemaRelationEdge = React.memo(function SchemaRelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps<SchemaRelationFlowEdge>) {
  const compact = useFlowStore((s) => s.transform[2] < LOD_ZOOM_THRESHOLD);
  const [hovered, setHovered] = React.useState(false);

  const join = data?.join;
  const canEdit = Boolean(data?.canEdit);
  const highlighted = Boolean(selected || data?.incidentToSelected || hovered);
  const isOuter =
    join?.type === "LEFT" || join?.type === "RIGHT" || join?.type === "FULL";
  const isInferred = join?.origin === "inferred";

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 6,
    offset: 24,
  });

  const strokeDasharray = isOuter
    ? "5 4"
    : isInferred
      ? "2 3"
      : undefined;

  const cardPair = parseCardinality(join?.cardinality);
  const srcOff = markerOffset(sourcePosition);
  const tgtOff = markerOffset(targetPosition);
  const showLabel = Boolean(join) && (!compact || highlighted);

  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: highlighted ? "var(--cb-select)" : "var(--cb-edge)",
          strokeWidth: highlighted ? 2.25 : 1.5,
          strokeDasharray,
        }}
      />

      {cardPair && (
        <>
          <text
            x={sourceX + srcOff.dx}
            y={sourceY + srcOff.dy}
            textAnchor="middle"
            className="vs-halo pointer-events-none select-none font-mono text-[10px] font-bold"
            fill={highlighted ? "var(--cb-select)" : "var(--foreground)"}
          >
            {cardPair[0]}
          </text>
          <text
            x={targetX + tgtOff.dx}
            y={targetY + tgtOff.dy}
            textAnchor="middle"
            className="vs-halo pointer-events-none select-none font-mono text-[10px] font-bold"
            fill={highlighted ? "var(--cb-select)" : "var(--foreground)"}
          >
            {cardPair[1]}
          </text>
        </>
      )}

      {showLabel && join && (
        <EdgeLabel x={labelX} y={labelY} interactive>
          <div
            className={cn(
              "group flex items-center gap-1 rounded-xs border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-foreground",
              highlighted && "border-[var(--cb-select)]",
            )}
            title={
              join.constraintName
                ? `${join.constraintName} (${join.left.column} = ${join.right.column})`
                : `${join.left.column} = ${join.right.column}`
            }
            data-testid={`join-edge-${join.id}`}
          >
            <button
              type="button"
              disabled={!canEdit}
              onClick={(e) => {
                e.stopPropagation();
                if (canEdit) data?.onToggleJoinType(join.id);
              }}
              className={cn(
                "font-semibold uppercase tracking-wide",
                canEdit && "cursor-pointer hover:text-[var(--accent-ink)]",
              )}
              title={
                canEdit
                  ? "Click to toggle INNER / LEFT join"
                  : `${join.type} JOIN`
              }
              data-testid={`join-toggle-${join.id}`}
            >
              {join.type}
            </button>
            <span className="text-muted-foreground">
              {join.left.column} = {join.right.column}
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  data?.onRemoveJoin(join.id);
                }}
                className="ml-0.5 rounded-xs p-0.5 text-muted-foreground opacity-70 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                aria-label="Remove join"
                data-testid={`join-remove-${join.id}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        </EdgeLabel>
      )}
    </g>
  );
});
