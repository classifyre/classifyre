"use client";

import * as React from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { Globe } from "lucide-react";
import { BOARD_LINK_KINDS } from "@workspace/schemas/case-board";
import { cn } from "@workspace/ui/lib/utils";
import type { TranslationKey } from "@/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useUi } from "../store/board-context";
import type { BoardEdge } from "../store/projection";
import { useLabelsVisible } from "../hooks/use-lod";
import { EdgeLabel, EdgeText } from "./edge-label";
import { useEdgeGeometry } from "./use-edge-geometry";

const DIRECTED = new Set(["precedes", "derived_from", "communicates_with"]);

/** The popover's vocabulary in words; custom kinds read as typed. */
export function humanizeKind(
  kind: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if ((BOARD_LINK_KINDS as readonly string[]).includes(kind)) {
    return t(`caseBoard.link.kinds.${kind as (typeof BOARD_LINK_KINDS)[number]}`);
  }
  const words = kind.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A link someone drew on this board (PRD §5.3), in the old graph's manual-edge
 * amber: solid when confirmed, dashed when suspected, red for "contradicts",
 * thicker with confidence. Its kind is written along it. A legacy global
 * MANUAL edge renders the same way with a globe: it is visible in every case.
 */
export const LinkEdge = React.memo(function LinkEdge({ id, source, target, selected, data }: EdgeProps<BoardEdge>) {
  const { t } = useTranslation();
  const link = useBoard((s) => (data?.linkId ? s.links.get(data.linkId) : undefined));
  const globalEdge = useBoard((s) =>
    data?.systemEdgeId ? s.systemEdges.get(data.systemEdgeId) : undefined,
  );
  const hovered = useUi((s) => s.hoveredEdgeId === id);
  const labelsVisible = useLabelsVisible();
  const g = useEdgeGeometry(source, target, data?.bend);
  if (!g || (!link && !globalEdge)) return null;

  const kind = link?.kind ?? globalEdge?.relationType ?? "related_to";
  const contradicts = kind === "contradicts";
  const suspected = link?.certainty === "SUSPECTED";
  const confidence = link?.confidence ?? globalEdge?.confidence ?? 0.5;
  const isGlobal = !!globalEdge || !!link?.promotedEdgeId;
  const color = selected ? "var(--cb-select)" : contradicts ? "var(--cb-contradicts)" : "var(--cb-manual)";
  const marker = selected
    ? "url(#cb-arrow-select)"
    : contradicts
      ? "url(#cb-arrow-red)"
      : "url(#cb-arrow-manual)";
  const text = link?.label ?? humanizeKind(kind, t);

  return (
    <>
      <BaseEdge
        id={id}
        path={g.path}
        interactionWidth={16}
        markerEnd={DIRECTED.has(kind) ? marker : undefined}
        style={{
          stroke: color,
          strokeWidth: 1.25 + 1.75 * Math.max(0, Math.min(1, confidence)) + (selected ? 0.75 : 0),
          strokeDasharray: suspected || contradicts ? "6 4" : undefined,
        }}
      />
      {(labelsVisible || hovered || selected) && g.length > 60 && (
        <EdgeText
          x={g.labelX}
          y={g.labelY}
          angle={g.angle}
          className={cn(selected ? "text-foreground" : contradicts ? "text-[var(--cb-contradicts)]" : "text-[var(--cb-manual)]")}
        >
          <span className="max-w-[200px] truncate">{text}</span>
          {suspected && <span className="opacity-80">· {t("caseBoard.edges.suspected")}</span>}
          {isGlobal && <Globe className="size-2.5 shrink-0" aria-label={t("caseBoard.edges.globalBadge")} />}
        </EdgeText>
      )}
      {hovered && (isGlobal || link?.createdBy) && (
        <EdgeLabel x={g.labelX} y={g.labelY + 20} className="text-[10px] text-muted-foreground">
          {isGlobal
            ? t("caseBoard.edges.global")
            : t("caseBoard.edges.by", { name: link?.createdBy ?? t("caseBoard.someone") })}
        </EdgeLabel>
      )}
    </>
  );
});
