"use client";

import * as React from "react";
import type { NodeProps } from "@xyflow/react";
import { getAssetKindIcon } from "@/lib/asset-kind";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard, useBoardStore, useUi, useUiStore } from "../store/board-context";
import { setCollapsed } from "../store/commands";
import type { BoardNode } from "../store/projection";
import { MAX_FINDING_NODES, severityMix } from "../store/relations";
import { hypothesisMeta, stanceThreadKey } from "../store/selectors";
import { useLod } from "../hooks/use-lod";
import { AssetNode, type HypothesisDot, type NodeBadge } from "./asset-node";

/**
 * Evidence: an asset in the case, as the old case graph drew it (PRD §5.2).
 * Its findings are their own nodes around it (see FindingNode), joined by
 * CONTAINS edges. Badges say what is not on screen: "+n" findings of the
 * asset that are not in the case, "▸n" findings folded away. A collapsed
 * asset, or any asset at far zoom, wears their severity mix as a donut.
 */
export const EvidenceBubble = React.memo(function EvidenceBubble({ id, selected }: NodeProps<BoardNode>) {
  const { t } = useTranslation();
  const item = useBoard((s) => s.items.get(id));
  const bubble = useBoard((s) => s.bubbles.get(id));
  const readOnly = useBoard((s) => s.readOnly);
  const lod = useLod();
  const showAll = useUi((s) => s.showAllRows.has(id));
  const moreOpen = useUi((s) => s.expandedUnattached.has(id));
  const incoming = useUi((s) => s.incoming.has(id));
  const pulse = useUi((s) => s.pulse === id);
  const store = useBoardStore();
  const ui = useUiStore();
  const dots = useHypothesisDots(id);

  if (!item || !bubble) return null;

  const total = bubble.rows.length;
  const findingsHidden = item.collapsed || lod === "chip";
  const folded = findingsHidden ? total : showAll ? 0 : Math.max(0, total - MAX_FINDING_NODES);

  const bottomRight: NodeBadge | null =
    folded > 0
      ? {
          text: `▸${folded}`,
          title: t("caseBoard.bubble.foldedHint", { count: folded }),
          onClick: readOnly && item.collapsed ? undefined : () => {
            if (item.collapsed) store.getState().run(setCollapsed(item, false));
            else ui.getState().toggle("showAllRows", id);
          },
        }
      : showAll && total > MAX_FINDING_NODES
        ? { text: "◂", title: t("caseBoard.bubble.showFewer"), onClick: () => ui.getState().toggle("showAllRows", id) }
        : null;

  const topRight: NodeBadge | null =
    bubble.unattached.length > 0 && !findingsHidden
      ? {
          text: moreOpen ? "−" : `+${bubble.unattached.length}`,
          title: moreOpen ? t("caseBoard.bubble.hideMore") : t("caseBoard.bubble.moreOnAsset", { count: bubble.unattached.length }),
          accent: true,
          onClick: () => ui.getState().toggle("expandedUnattached", id),
        }
      : null;

  const topLeft: NodeBadge | null =
    incoming || (findingsHidden && bubble.newCount > 0)
      ? {
          text: t("caseBoard.bubble.newBadge"),
          title: incoming ? t("caseBoard.bubble.incoming") : t("caseBoard.bubble.newCount", { count: bubble.newCount }),
          accent: true,
        }
      : null;

  const source = bubble.sourceName ?? bubble.sourceType;
  return (
    <AssetNode
      testId="evidence-bubble"
      label={bubble.label || t("caseBoard.bubble.unknownAsset")}
      title={[bubble.label, source, bubble.missing ? t("caseBoard.bubble.assetDeleted") : null].filter(Boolean).join(" · ")}
      Icon={getAssetKindIcon(bubble.assetType)}
      lod={lod}
      inCase
      selected={selected}
      pulse={pulse}
      missing={bubble.missing}
      pending={bubble.pending}
      highlight={item.style.highlight ?? null}
      donut={findingsHidden && total > 0 ? severityMix(bubble.rows) : null}
      topRight={topRight}
      bottomRight={bottomRight}
      topLeft={topLeft}
      dots={dots}
      readOnly={readOnly}
    />
  );
});

/** One dot per hypothesis this evidence bears on; a click focuses that hypothesis. */
function useHypothesisDots(itemId: string): HypothesisDot[] {
  const key = useBoard((s) => stanceThreadKey(s, itemId));
  const threads = useBoard((s) => s.threads);
  const ui = useUiStore();
  return React.useMemo(() => {
    if (!key) return [];
    const meta = hypothesisMeta(threads);
    return key
      .split("|")
      .filter((threadId) => meta.has(threadId))
      .map((threadId) => {
        const thread = threads.get(threadId);
        const m = meta.get(threadId)!;
        return {
          id: threadId,
          color: m.color,
          title: `${m.label} · ${thread?.title ?? ""}`,
          onClick: () =>
            ui.getState().set({
              focusHypothesisItemId:
                ui.getState().focusHypothesisItemId === thread?.itemId ? null : (thread?.itemId ?? null),
            }),
        };
      });
  }, [key, threads, ui]);
}
