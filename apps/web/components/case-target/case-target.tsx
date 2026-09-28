"use client";

import * as React from "react";
import { AddToCaseDialog } from "./add-to-case-dialog";

/**
 * Adding things to a case from anywhere that shows assets or findings (the
 * duplicates and lineage graphs, similar findings, where a value was found
 * again…), with one behaviour everywhere:
 *
 * - inside a case (its board provides a {@link CaseTarget}), they go into
 *   that case and nowhere else — the panel already says which case it is;
 * - anywhere else, the person picks the case (or starts one) in a dialog.
 *
 * Components ask {@link useAddToCase} and render the `dialog` it returns; they
 * never need to know which of the two they are in.
 */

/** Something from the corpus that can join a case. */
export interface CaseCandidate {
  kind: "asset" | "finding";
  /** The asset's id, or the finding's. */
  id: string;
  /** The asset itself, or the one the finding was found in. */
  assetId: string;
  /** What to call it: the asset's name, or the finding's type and value. */
  label: string;
  /** The asset's name, for a finding (its node is labelled with it until the server answers). */
  assetName?: string | null;
  assetType?: string | null;
  sourceType?: string | null;
}

/**
 * Where a candidate stands against the case: in it, attachable (a finding
 * whose asset is in the case already), absent, or unknown (no case chosen).
 */
export type CandidateStatus = "inCase" | "attachable" | "absent" | "unknown";

export interface CaseTarget {
  /** The case adds go to; null when the person picks one per add. */
  caseId: string | null;
  /** Whether the case is read-only (closed, a demo): nothing can be added. */
  readOnly: boolean;
  status(candidate: CaseCandidate): CandidateStatus;
  add(candidates: CaseCandidate[]): void;
}

const CaseTargetContext = React.createContext<CaseTarget | null>(null);

/** Make the given case the target of every add below (the case board does this). */
export function CaseTargetProvider({ value, children }: { value: CaseTarget; children: React.ReactNode }) {
  return <CaseTargetContext.Provider value={value}>{children}</CaseTargetContext.Provider>;
}

/** The case the surrounding view adds to, if it is inside one. */
export function useCaseTargetContext(): CaseTarget | null {
  return React.useContext(CaseTargetContext);
}

/**
 * The way to add things to a case from here, and the dialog to render for it
 * (null inside a case: nothing to pick).
 */
export function useAddToCase(): { target: CaseTarget; dialog: React.ReactNode } {
  const context = useCaseTargetContext();
  const [pending, setPending] = React.useState<CaseCandidate[] | null>(null);
  const fallback = React.useMemo<CaseTarget>(
    () => ({
      caseId: null,
      readOnly: false,
      status: () => "unknown",
      add: (candidates) => {
        if (candidates.length > 0) setPending(candidates);
      },
    }),
    [],
  );
  if (context) return { target: context, dialog: null };
  return {
    target: fallback,
    dialog: pending ? (
      <AddToCaseDialog open candidates={pending} onOpenChange={(open) => !open && setPending(null)} />
    ) : null,
  };
}

/** Asset and finding candidates from the shapes the graphs use. */
export function assetCandidate(asset: {
  id: string;
  label?: string | null;
  name?: string | null;
  assetType?: string | null;
  sourceType?: string | null;
}): CaseCandidate {
  const label = asset.name ?? asset.label ?? asset.id;
  return {
    kind: "asset",
    id: asset.id,
    assetId: asset.id,
    label,
    assetName: label,
    assetType: asset.assetType ?? null,
    sourceType: asset.sourceType ?? null,
  };
}

export function findingCandidate(finding: {
  id: string;
  assetId: string;
  findingType?: string | null;
  value?: string | null;
  assetName?: string | null;
  assetType?: string | null;
  sourceType?: string | null;
}): CaseCandidate {
  const value = finding.value ? (finding.value.length > 60 ? `${finding.value.slice(0, 60)}…` : finding.value) : "";
  return {
    kind: "finding",
    id: finding.id,
    assetId: finding.assetId,
    label: [finding.findingType, value].filter(Boolean).join(": ") || finding.id,
    assetName: finding.assetName ?? null,
    assetType: finding.assetType ?? null,
    sourceType: finding.sourceType ?? null,
  };
}
