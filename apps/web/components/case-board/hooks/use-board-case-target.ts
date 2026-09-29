"use client";

import * as React from "react";
import { toast } from "sonner";
import type { CandidateStatus, CaseCandidate, CaseTarget } from "@/components/case-target/case-target";
import { useTranslation } from "@/hooks/use-translation";
import { useBoard } from "../store/board-context";
import { evidenceStatus, type EvidenceCandidate } from "../store/selectors";
import { usePlaceEvidence } from "./use-place-evidence";

function asEvidence(c: CaseCandidate): EvidenceCandidate {
  return {
    kind: c.kind,
    id: c.id,
    assetId: c.assetId,
    assetName: c.assetName ?? c.label,
    assetType: c.assetType ?? null,
    sourceType: c.sourceType ?? null,
  };
}

/**
 * This board's case as the target of every "Add to case" in its side panel
 * (the duplicates and lineage graphs, similar findings, other findings of an
 * asset…): candidates go onto this board — attached to their asset when it
 * is here, otherwise placed in view — and nowhere else.
 */
export function useBoardCaseTarget(onFlyTo: (nodeId: string) => void): CaseTarget {
  const { t } = useTranslation();
  const caseId = useBoard((s) => s.caseId);
  const readOnly = useBoard((s) => s.readOnly);
  const itemByAsset = useBoard((s) => s.itemByAsset);
  const bubbles = useBoard((s) => s.bubbles);
  const place = usePlaceEvidence(onFlyTo);
  return React.useMemo<CaseTarget>(
    () => ({
      caseId,
      readOnly,
      status: (c): CandidateStatus => {
        const status = evidenceStatus({ itemByAsset, bubbles }, asEvidence(c));
        return status === "onBoard" ? "inCase" : status;
      },
      add: (candidates) => {
        if (readOnly || candidates.length === 0) return;
        // One goes where the view flies to; several stay put and say so.
        const single = candidates.length === 1;
        for (const c of candidates) place(asEvidence(c), { fly: single });
        toast.success(
          single ? t("caseTarget.boardAdded", { label: candidates[0]!.label }) : t("caseTarget.boardAddedMany", { count: candidates.length }),
          { duration: 2000 },
        );
      },
    }),
    [caseId, readOnly, itemByAsset, bubbles, place, t],
  );
}
