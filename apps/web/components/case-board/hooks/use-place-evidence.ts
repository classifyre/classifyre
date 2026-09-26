"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import { useBoardStore, useUiStore } from "../store/board-context";
import { addEvidence, attachFinding } from "../store/commands";
import { freeSpotNear, newEvidenceSize, takenRects } from "../store/geometry";
import { MAX_FINDING_NODES } from "../store/projection";
import { findingNodeId } from "../store/relations";
import { evidenceStatus, type EvidenceCandidate } from "../store/selectors";
import { useVisibleCentre } from "./use-visible-centre";

export { evidenceStatus, type EvidenceCandidate, type EvidenceStatus } from "../store/selectors";

/**
 * Fly to an item, or to one of its findings: a finding folded behind "▸n",
 * or not attached, gets its node shown first.
 */
export function useFlyToEvidence(onFlyTo: (nodeId: string) => void) {
  const store = useBoardStore();
  const ui = useUiStore();
  const rf = useReactFlow();
  return React.useCallback(
    (itemId: string, findingId?: string | null) => {
      if (findingId) {
        const bubble = store.getState().bubbles.get(itemId);
        const index = bubble?.rows.findIndex((r) => r.findingId === findingId) ?? -1;
        if (index >= MAX_FINDING_NODES && !ui.getState().showAllRows.has(itemId)) ui.getState().toggle("showAllRows", itemId);
        if (index < 0 && !ui.getState().expandedUnattached.has(itemId)) ui.getState().toggle("expandedUnattached", itemId);
      }
      // Two frames: a finding's node appears on the next render.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const node = findingId ? findingNodeId(itemId, findingId) : null;
          onFlyTo(node && rf.getNode(node) ? node : itemId);
        }),
      );
    },
    [store, ui, rf, onFlyTo],
  );
}

/**
 * Put a candidate on the board the one way that fits it: fly to it when it is
 * there already, attach a finding to its asset when that is, otherwise add it
 * near the middle of the visible canvas, clear of what is there.
 */
export function usePlaceEvidence(onFlyTo: (nodeId: string) => void) {
  const store = useBoardStore();
  const centre = useVisibleCentre();
  const flyTo = useFlyToEvidence(onFlyTo);
  return React.useCallback(
    (c: EvidenceCandidate) => {
      const s = store.getState();
      const status = evidenceStatus(s, c);
      const itemId = s.itemByAsset.get(c.assetId);
      if (status === "onBoard" && itemId) {
        flyTo(itemId, c.kind === "finding" ? c.id : null);
        return;
      }
      if (status === "attachable" && itemId) {
        s.run(attachFinding(itemId, c.id));
        flyTo(itemId, c.id);
        return;
      }
      const at = centre();
      const size = newEvidenceSize();
      const spot = freeSpotNear({ x: at.x - size.width / 2, y: at.y - size.height / 2 }, size, takenRects(s));
      const cmd = addEvidence({ entityType: c.kind, entityId: c.id }, spot, {
        label: c.assetName,
        assetType: c.assetType,
        sourceType: c.sourceType,
      });
      s.run(cmd);
      flyTo(cmd.itemId);
    },
    [store, centre, flyTo],
  );
}
