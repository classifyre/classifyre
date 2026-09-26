"use client";

import * as React from "react";
import type { EdgeProps } from "@xyflow/react";
import { BOARD_LINK_KINDS } from "@workspace/schemas/case-board";
import { LinkLine } from "@workspace/case-board/components/lines";
import { useEdgeGeometry } from "@workspace/case-board/hooks/use-edge-geometry";
import { useLabelsVisible } from "@workspace/case-board/hooks/use-lod";
import type { TranslationKey } from "@/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useUi } from "../store/board-context";
import type { BoardEdge } from "../store/projection";

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
  const isGlobal = !!globalEdge || !!link?.promotedEdgeId;
  return (
    <LinkLine
      id={id}
      g={g}
      kind={kind}
      text={link?.label ?? humanizeKind(kind, t)}
      showText={labelsVisible || hovered || !!selected}
      confidence={link?.confidence ?? globalEdge?.confidence ?? 0.5}
      suspected={link?.certainty === "SUSPECTED"}
      global={isGlobal}
      selected={selected}
      suspectedLabel={t("caseBoard.edges.suspected")}
      globalLabel={t("caseBoard.edges.globalBadge")}
      card={
        hovered && (isGlobal || link?.createdBy)
          ? isGlobal
            ? t("caseBoard.edges.global")
            : t("caseBoard.edges.by", { name: link?.createdBy ?? t("caseBoard.someone") })
          : null
      }
    />
  );
});
