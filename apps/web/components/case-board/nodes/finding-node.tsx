"use client";

import * as React from "react";
import type { NodeProps } from "@xyflow/react";
import { FindingNodeView } from "@workspace/case-board/components/finding-node";
import type { FindingLook } from "@workspace/case-board/components/glyphs";
import { useLod } from "@workspace/case-board/hooks/use-lod";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useUi } from "../store/board-context";
import { dismissedLabel } from "../store/finding-state";
import { isFindingData, type BoardNode } from "../store/projection";
import { findingCode } from "../store/relations";
import type { BubbleRow, FindingVisualState } from "../store/types";
import type { ViewPrefs } from "../store/ui-store";

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
  return (
    <FindingNodeView
      findingId={findingId}
      attached={finding.attached}
      severity={severity}
      look={look}
      code={findingCode(row.detector, row.typeLabel)}
      label={`${row.typeLabel}${row.value ? `: ${row.value}` : ""}`}
      title={describe(row, finding.attached, t)}
      lod={lod}
      readOnly={readOnly}
      selected={selected}
      highlight={highlight}
      newBadge={row.state === "new" && finding.attached ? t("caseBoard.bubble.newBadge") : null}
      resolved={row.state === "resolved"}
      struck={row.state === "dismissed"}
      faded={faded(row.state, view)}
    />
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
