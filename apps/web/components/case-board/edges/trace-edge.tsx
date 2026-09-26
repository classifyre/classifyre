"use client";

import * as React from "react";
import type { EdgeProps } from "@xyflow/react";
import { TraceLine } from "@workspace/case-board/components/lines";
import { useEdgeGeometry } from "@workspace/case-board/hooks/use-edge-geometry";
import { useLabelsVisible } from "@workspace/case-board/hooks/use-lod";
import type { BoardEdge } from "../store/projection";

/**
 * A relation "Show connections" found beyond the board, drawn as a ghost of a
 * system edge: dashed, tinted by its kind, pointing the way lineage and links
 * point, its type written along it.
 */
export const TraceEdge = React.memo(function TraceEdge({ id, source, target, data }: EdgeProps<BoardEdge>) {
  const labelsVisible = useLabelsVisible();
  const g = useEdgeGeometry(source, target, data?.bend);
  const trace = data?.trace;
  if (!g || !trace) return null;
  return <TraceLine id={id} g={g} kind={trace.kind} relationType={trace.relationType} showText={labelsVisible} />;
});
