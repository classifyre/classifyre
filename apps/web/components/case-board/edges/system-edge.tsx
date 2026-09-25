"use client";

import * as React from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { Lock } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useUi } from "../store/board-context";
import { edgeDrawClass, type BoardEdge } from "../store/projection";
import { parseFindingNodeId } from "../store/relations";
import type { BoardState } from "../store/board-store";
import { useLabelsVisible } from "../hooks/use-lod";
import { EdgeLabel, EdgeText } from "./edge-label";
import { useEdgeGeometry } from "./use-edge-geometry";

/** Label of whatever a node shows: an asset, a finding, a neighbour, a note. */
export function nodeLabel(s: BoardState, nodeId: string): string {
  if (nodeId.startsWith("sg:")) return s.suggested.get(nodeId)?.label ?? "";
  const finding = parseFindingNodeId(nodeId);
  if (finding) {
    const bubble = s.bubbles.get(finding.itemId);
    const row = [...(bubble?.rows ?? []), ...(bubble?.unattached ?? [])].find((r) => r.findingId === finding.findingId);
    return row ? `${row.typeLabel}${row.value ? `: ${row.value}` : ""}` : "";
  }
  const bubble = s.bubbles.get(nodeId);
  if (bubble) return bubble.label;
  const item = s.items.get(nodeId);
  if (item?.refId) return s.threads.get(item.refId)?.title ?? "";
  return item?.content.text?.slice(0, 40) ?? item?.content.title ?? "";
}

/**
 * A platform-produced relation, drawn as the old case graph drew it: a thin
 * line with an arrow the way it points, its type written along it (CONTAINS,
 * TRANSFORM, REFERENCES…). Duplicates are dashed and point nowhere. Never
 * deletable; the hover card says so, with a lock. Also draws the relations to
 * suggested neighbours, which read like any other.
 */
export const SystemEdge = React.memo(function SystemEdge({ id, source, target, selected, data }: EdgeProps<BoardEdge>) {
  const { t } = useTranslation();
  const edge = useBoard((s) => (data?.systemEdgeId ? s.systemEdges.get(data.systemEdgeId) : undefined));
  const fromLabel = useBoard((s) => nodeLabel(s, source));
  const toLabel = useBoard((s) => nodeLabel(s, target));
  const hovered = useUi((s) => s.hoveredEdgeId === id);
  const labelsVisible = useLabelsVisible();
  const g = useEdgeGeometry(source, target, data?.bend);
  if (!g || !edge) return null;

  const cls = edgeDrawClass(edge);
  const identity = cls === "IDENTITY";
  const count = data?.count ?? 1;
  const describe =
    cls === "FLOW"
      ? t("caseBoard.edges.lineage", { from: fromLabel, to: toLabel })
      : identity
        ? t("caseBoard.edges.duplicate", { confidence: Math.round(edge.confidence * 100) })
        : edge.relationClass === "USAGE"
          ? t("caseBoard.edges.usage")
          : t("caseBoard.edges.reference");

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
      {(labelsVisible || hovered || selected) && g.length > 70 && (
        <EdgeText x={g.labelX} y={g.labelY} angle={g.angle} className={selected ? "text-foreground" : undefined}>
          {edge.relationType}
          {count > 1 && <span>×{count}</span>}
        </EdgeText>
      )}
      {hovered && (
        <EdgeLabel x={g.labelX} y={g.labelY + 20} className="max-w-[260px] shadow-none">
          <span className="flex items-center gap-1">
            <Lock className="size-3 shrink-0" aria-label={t("caseBoard.edges.locked")} />
            <span className="truncate">{describe}</span>
            {count > 1 && <span className="font-mono">{t("caseBoard.edges.folded", { count })}</span>}
          </span>
          <span className="block text-[10px] text-muted-foreground">{t("caseBoard.edges.system")}</span>
        </EdgeLabel>
      )}
    </>
  );
});

/** An asset's own finding: "contains", as the old graph labelled it. */
export const ContainsEdge = React.memo(function ContainsEdge({ id, source, target, data }: EdgeProps<BoardEdge>) {
  const { t } = useTranslation();
  const labelsVisible = useLabelsVisible();
  const g = useEdgeGeometry(source, target, data?.bend);
  if (!g) return null;
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
          strokeDasharray: data?.ghost ? "3 3" : undefined,
          opacity: data?.ghost ? 0.7 : 1,
        }}
      />
      {labelsVisible && g.length > 60 && (
        <EdgeText x={g.labelX} y={g.labelY} angle={g.angle}>
          {t("caseBoard.edges.containsLabel")}
        </EdgeText>
      )}
    </>
  );
});
