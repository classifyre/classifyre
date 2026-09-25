"use client";

import * as React from "react";
import type { NodeProps } from "@xyflow/react";
import { Check } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useUi } from "../store/board-context";
import { dismissedLabel } from "../store/finding-state";
import { isFindingData, type BoardNode } from "../store/projection";
import { FINDING_NODE, findingCode } from "../store/relations";
import type { BubbleRow, FindingVisualState } from "../store/types";
import type { ViewPrefs } from "../store/ui-store";
import { useLod } from "../hooks/use-lod";
import { codeInk, FindingCircle, type FindingLook } from "./relation-glyphs";
import { Ports } from "./ports";

/** Findings the View popover asked to fade (never hide — evidence preservation). */
function faded(state: FindingVisualState, view: ViewPrefs): boolean {
  if (state === "resolved") return !view.showResolved;
  if (state === "dismissed") return !view.showDismissed;
  if (state === "gone" || state === "deleted") return !view.showGone;
  return false;
}

/**
 * One finding of an evidence asset, as the old case graph drew it: a small
 * circle in its severity's colour with the detector's code, the finding
 * under it. A child of its asset's node, so it travels with it; drag it
 * anywhere and it keeps that spot. Links and stances end on it.
 */
export const FindingNode = React.memo(function FindingNode({ data, selected }: NodeProps<BoardNode>) {
  const { t } = useTranslation();
  const finding = isFindingData(data) ? data : null;
  const itemId = finding?.findingOf ?? "";
  const findingId = finding?.findingId ?? "";
  const row = useBoard((s) => {
    const bubble = s.bubbles.get(itemId);
    return bubble?.rows.find((r) => r.findingId === findingId) ?? bubble?.unattached.find((r) => r.findingId === findingId);
  });
  const highlight = useBoard((s) => s.items.get(itemId)?.style.rowHighlights?.[findingId] ?? null);
  const readOnly = useBoard((s) => s.readOnly);
  const view = useUi((s) => s.view);
  const lod = useLod();
  if (!finding || !row) return null;

  const look: FindingLook = finding.attached ? row.state : "ghost";
  const severity = row.severity ?? "info";
  const { cx, cy, r, width, height } = FINDING_NODE;

  return (
    <div
      className={cn("relative", faded(row.state, view) && "opacity-25")}
      style={{ width, height }}
      title={describe(row, finding.attached, t)}
      data-finding-id={findingId}
      data-row-attached={finding.attached ? "true" : "false"}
      data-testid="finding-node"
    >
      <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
        <FindingCircle severity={severity} look={look} selected={selected} highlight={highlight} />
      </svg>
      <span
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[9.5px] font-bold leading-none"
        style={{ left: cx, top: cy + 0.5, color: codeInk(severity, look) }}
      >
        {findingCode(row.detector, row.typeLabel)}
      </span>
      {row.state === "new" && finding.attached && (
        <span
          className="pointer-events-none absolute rounded-[2px] border border-[#0a0a0a] bg-accent px-[3px] font-mono text-[7.5px] font-bold leading-[10px] text-accent-foreground"
          style={{ left: cx + 7, top: cy - r - 7 }}
        >
          {t("caseBoard.bubble.newBadge")}
        </span>
      )}
      {row.state === "resolved" && (
        <span
          className="pointer-events-none absolute flex size-3 items-center justify-center rounded-full bg-[var(--cb-supports)] text-white"
          style={{ left: cx + 6, top: cy + 5 }}
        >
          <Check className="size-2" strokeWidth={3.5} aria-hidden />
        </span>
      )}
      {lod === "full" && (
        <span
          className={cn(
            "cb-halo pointer-events-none absolute inset-x-0 truncate px-0.5 text-center font-mono text-[9.5px] leading-tight text-muted-foreground",
            row.state === "dismissed" && "line-through",
            !finding.attached && "italic",
          )}
          style={{ top: cy + r + 5 }}
        >
          {row.typeLabel}
          {row.value ? `: ${row.value}` : ""}
        </span>
      )}
      <Ports connectable={!readOnly} round={{ cx, cy, r }} core={{ cx, cy, d: 2 * r + 8 }} />
    </div>
  );
});

function describe(row: BubbleRow, attached: boolean, t: ReturnType<typeof useTranslation>["t"]): string {
  const state =
    row.state === "open"
      ? null
      : row.state === "dismissed"
        ? t(`caseBoard.states.${dismissedLabel(row.status)}`)
        : t(`caseBoard.states.${row.state}`);
  return [
    t(`caseBoard.severity.${row.severity ?? "info"}`),
    `${row.typeLabel}${row.value ? `: ${row.value}` : ""}`,
    row.detector,
    state,
    attached ? null : t("caseBoard.bubble.notInCase"),
  ]
    .filter(Boolean)
    .join(" · ");
}
