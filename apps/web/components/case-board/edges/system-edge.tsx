"use client";

import * as React from "react";
import type { EdgeProps } from "@xyflow/react";
import { Lock } from "lucide-react";
import { ContainsLine, SystemLine } from "@workspace/case-board/components/lines";
import { useEdgeGeometry } from "@workspace/case-board/hooks/use-edge-geometry";
import { useLabelsVisible } from "@workspace/case-board/hooks/use-lod";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useUi } from "../store/board-context";
import { edgeDrawClass, type BoardEdge } from "../store/projection";
import { parseFindingNodeId } from "../store/relations";
import type { BoardState } from "../store/board-store";

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
    <SystemLine
      id={id}
      g={g}
      relationType={edge.relationType}
      showText={labelsVisible || hovered || !!selected}
      identity={identity}
      count={count}
      selected={selected}
      card={
        hovered ? (
          <>
            <span className="flex items-center gap-1">
              <Lock className="size-3 shrink-0" aria-label={t("caseBoard.edges.locked")} />
              <span className="truncate">{describe}</span>
              {count > 1 && <span className="font-mono">{t("caseBoard.edges.folded", { count })}</span>}
            </span>
            <span className="block text-[10px] text-muted-foreground">{t("caseBoard.edges.system")}</span>
          </>
        ) : null
      }
    />
  );
});

/** An asset's own finding: "contains", as the old graph labelled it. */
export const ContainsEdge = React.memo(function ContainsEdge({ id, source, target, data }: EdgeProps<BoardEdge>) {
  const { t } = useTranslation();
  const labelsVisible = useLabelsVisible();
  const g = useEdgeGeometry(source, target, data?.bend);
  if (!g) return null;
  return (
    <ContainsLine
      id={id}
      g={g}
      text={t("caseBoard.edges.containsLabel")}
      showText={labelsVisible}
      ghost={data?.ghost}
    />
  );
});
