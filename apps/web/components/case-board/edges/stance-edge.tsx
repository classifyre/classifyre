"use client";

import * as React from "react";
import type { EdgeProps } from "@xyflow/react";
import { StanceLine } from "@workspace/case-board/components/lines";
import { useEdgeGeometry } from "@workspace/case-board/hooks/use-edge-geometry";
import { useLabelsVisible } from "@workspace/case-board/hooks/use-lod";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useUi } from "../store/board-context";
import type { BoardEdge } from "../store/projection";

/**
 * Hypothesis ⇄ evidence (PRD §5.3): green ✓ supports, red dashed ✗
 * contradicts, grey ○ neutral, the glyph at the hypothesis end. Hovered or
 * selected, it says what it claims, how sure, and why.
 */
export const StanceEdge = React.memo(function StanceEdge({ id, source, target, selected, data }: EdgeProps<BoardEdge>) {
  const { t } = useTranslation();
  const support = useBoard((s) => (data?.supportId ? s.supports.get(data.supportId) : undefined));
  const threadTitle = useBoard((s) => (support ? (s.threads.get(support.threadId)?.title ?? "") : ""));
  const hovered = useUi((s) => s.hoveredEdgeId === id);
  const labelsVisible = useLabelsVisible();
  const g = useEdgeGeometry(source, target, data?.bend);
  if (!g || !support) return null;

  const words =
    support.stance === "SUPPORTS"
      ? t("caseBoard.edges.stanceSupports", { hypothesis: threadTitle })
      : support.stance === "CONTRADICTS"
        ? t("caseBoard.edges.stanceContradicts", { hypothesis: threadTitle })
        : t("caseBoard.edges.stanceNeutral", { hypothesis: threadTitle });

  return (
    <StanceLine
      id={id}
      g={g}
      stance={support.stance}
      labelsVisible={labelsVisible}
      selected={selected}
      pending={support.pending}
      card={
        hovered || selected ? (
          <>
            <span className="block truncate">{words}</span>
            {support.weight !== null && (
              <span className="block font-mono text-[10px] text-muted-foreground">
                {t("caseBoard.link.confidence")} {support.weight.toFixed(2)}
              </span>
            )}
            {support.note && <span className="block text-[10px] text-muted-foreground">{support.note}</span>}
          </>
        ) : null
      }
    />
  );
});
