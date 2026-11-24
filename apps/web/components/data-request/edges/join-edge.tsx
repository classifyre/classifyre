"use client";

import * as React from "react";
import {
  BaseEdge,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";
import type { DataRequestJoin } from "@workspace/schemas/data-request";
import { EdgeLabel } from "@workspace/case-board/components/edge-label";
import { cn } from "@workspace/ui/lib/utils";
import { useRequestStore } from "../store/request-context";

export interface JoinEdgeData extends Record<string, unknown> {
  join: DataRequestJoin;
  canEdit: boolean;
}

export type RequestJoinEdge = Edge<JoinEdgeData, "request-join">;

/**
 * Orthogonal drafting-sheet connector for column-to-column joins.
 * Clicking the label toggles INNER / LEFT when editable.
 */
export const JoinEdge = React.memo(function JoinEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps<RequestJoinEdge>) {
  const store = useRequestStore();
  const join = data?.join;
  const canEdit = Boolean(data?.canEdit);
  const isLeft = join?.type === "LEFT";

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 2,
    offset: 24,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: isLeft ? "#0284c7" : "#0369a1",
          strokeWidth: selected ? 2.5 : 1.75,
          strokeDasharray: isLeft ? "5 4" : undefined,
        }}
      />
      {join && (
        <EdgeLabel x={labelX} y={labelY} interactive>
          <div
            className={cn(
              "group flex items-center gap-1 rounded-xs border bg-background/95 px-1.5 py-0.5 font-mono text-[10px] shadow-xs",
              isLeft
                ? "border-sky-500/60 text-sky-700 dark:text-sky-300"
                : "border-border text-foreground",
              selected && "ring-1 ring-sky-500",
            )}
            data-testid={`join-edge-${join.id}`}
          >
            <button
              type="button"
              disabled={!canEdit}
              onClick={(e) => {
                e.stopPropagation();
                if (canEdit) store.getState().toggleJoinType(join.id);
              }}
              className={cn(
                "font-semibold uppercase tracking-wide",
                canEdit && "cursor-pointer hover:text-sky-600 dark:hover:text-sky-400",
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
                  store.getState().removeJoin(join.id);
                }}
                className="ml-0.5 rounded p-0.5 text-muted-foreground opacity-70 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                aria-label="Remove join"
                data-testid={`join-remove-${join.id}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        </EdgeLabel>
      )}
    </>
  );
});
