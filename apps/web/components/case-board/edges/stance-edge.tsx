"use client";

import * as React from "react";
import { BaseEdge, type EdgeProps } from "@xyflow/react";
import { Check, Circle, X } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useUi } from "../store/board-context";
import type { BoardEdge } from "../store/projection";
import { useLabelsVisible } from "../hooks/use-lod";
import { offsetFrom } from "./anchor";
import { EdgeLabel } from "./edge-label";
import { useEdgeGeometry } from "./use-edge-geometry";

const STANCE_STYLE = {
  SUPPORTS: { color: "var(--cb-supports)", dash: undefined, Icon: Check },
  CONTRADICTS: { color: "var(--cb-contradicts)", dash: "6 4", Icon: X },
  NEUTRAL: { color: "var(--cb-neutral)", dash: undefined, Icon: Circle },
} as const;

/**
 * Hypothesis ⇄ evidence (PRD §5.3): green ✓ supports, red dashed ✗
 * contradicts, grey ○ neutral. The glyph sits at the hypothesis end, so the
 * direction of the claim reads without a legend.
 */
export const StanceEdge = React.memo(function StanceEdge({
  id,
  source,
  target,
  selected,
  data,
}: EdgeProps<BoardEdge>) {
  const { t } = useTranslation();
  const support = useBoard((s) => (data?.supportId ? s.supports.get(data.supportId) : undefined));
  const threadTitle = useBoard((s) =>
    support ? (s.threads.get(support.threadId)?.title ?? "") : "",
  );
  const hovered = useUi((s) => s.hoveredEdgeId === id);
  const labelsVisible = useLabelsVisible();
  const g = useEdgeGeometry(source, target, data?.bend);
  if (!g || !support) return null;

  const style = STANCE_STYLE[support.stance];
  const glyph = offsetFrom({ x: g.sx, y: g.sy }, g.sourceNormal, 14);
  const words =
    support.stance === "SUPPORTS"
      ? t("caseBoard.edges.stanceSupports", { hypothesis: threadTitle })
      : support.stance === "CONTRADICTS"
        ? t("caseBoard.edges.stanceContradicts", { hypothesis: threadTitle })
        : t("caseBoard.edges.stanceNeutral", { hypothesis: threadTitle });

  return (
    <>
      <BaseEdge
        id={id}
        path={g.path}
        interactionWidth={16}
        style={{
          stroke: selected ? "var(--cb-select)" : style.color,
          strokeWidth: 2 + (selected ? 1 : 0),
          strokeDasharray: style.dash,
          opacity: support.pending ? 0.6 : 1,
        }}
      />
      {labelsVisible && (
        <EdgeLabel
          x={glyph.x}
          y={glyph.y}
          className="flex size-4 items-center justify-center rounded-full border-0 p-0"
        >
          <span
            className="flex size-4 items-center justify-center rounded-full text-white"
            style={{ background: style.color }}
          >
            <style.Icon className="size-2.5" strokeWidth={3} aria-hidden />
          </span>
        </EdgeLabel>
      )}
      {(hovered || selected) && (
        <EdgeLabel x={g.labelX} y={g.labelY} className={cn("max-w-[260px]")}>
          <span className="block truncate">{words}</span>
          {support.weight !== null && (
            <span className="block font-mono text-[10px] text-muted-foreground">
              {t("caseBoard.link.confidence")} {support.weight.toFixed(2)}
            </span>
          )}
          {support.note && <span className="block text-[10px] text-muted-foreground">{support.note}</span>}
        </EdgeLabel>
      )}
    </>
  );
});
