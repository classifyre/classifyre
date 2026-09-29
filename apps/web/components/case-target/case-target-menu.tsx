"use client";

import * as React from "react";
import { Check, FolderPlus, Plus } from "lucide-react";
import type { GraphNodeDto } from "@workspace/api-client";
import { DropdownMenuItem } from "@workspace/ui/components/dropdown-menu";
import { Button } from "@workspace/ui/components/button";
import type { NodeDecoration, NodeDecorator } from "@/components/graph-explorer/explorer-types";
import { useTranslation } from "@/hooks/use-translation";
import type { CandidateStatus, CaseCandidate, CaseTarget } from "./case-target";

/** How one candidate's add reads, from where it stands against the case. */
function useAddWords() {
  const { t } = useTranslation();
  return (target: CaseTarget, candidates: CaseCandidate[]) => {
    if (!target.caseId) {
      return { label: t("caseTarget.menu.addToCase"), disabled: false, done: false };
    }
    const statuses = candidates.map((c) => target.status(c));
    const open = statuses.filter((s) => s !== "inCase").length;
    if (open === 0) {
      return {
        label: candidates.length === 1 ? t("caseTarget.menu.inCase") : t("caseTarget.menu.allInCase"),
        disabled: true,
        done: true,
      };
    }
    if (candidates.length === 1 && statuses[0] === "attachable") {
      return { label: t("caseTarget.menu.attach"), disabled: target.readOnly, done: false };
    }
    return {
      label: candidates.length === 1 ? t("caseTarget.menu.addHere") : t("caseTarget.menu.addManyHere", { count: open }),
      disabled: target.readOnly,
      done: false,
    };
  };
}

/** "Add to this case" (inside a case) or "Add to case…" (anywhere else), as a menu item. */
export function AddToCaseMenuItem({
  target,
  candidates,
  onDone,
}: {
  target: CaseTarget;
  candidates: CaseCandidate[];
  onDone?: () => void;
}) {
  const words = useAddWords()(target, candidates);
  const Icon = words.done ? Check : target.caseId ? Plus : FolderPlus;
  return (
    <DropdownMenuItem
      disabled={words.disabled || candidates.length === 0}
      onSelect={() => {
        target.add(candidates.filter((c) => !target.caseId || target.status(c) !== "inCase"));
        onDone?.();
      }}
      data-testid="menu-add-to-case"
    >
      <Icon className="size-4" /> {words.label}
    </DropdownMenuItem>
  );
}

/** The same choice as a small button, for lists. */
export function AddToCaseButton({
  target,
  candidate,
  className,
}: {
  target: CaseTarget;
  candidate: CaseCandidate;
  className?: string;
}) {
  const { t } = useTranslation();
  const status: CandidateStatus = target.status(candidate);
  if (status === "inCase") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 rounded-[3px] border border-border px-1 py-px font-mono text-[9px] text-muted-foreground uppercase"
        title={t("caseTarget.menu.inCase")}
      >
        <Check className="size-2.5" aria-hidden /> {t("caseTarget.inCaseShort")}
      </span>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className ?? "h-6 shrink-0 gap-0.5 px-1.5 font-mono text-[9px] uppercase"}
      disabled={target.readOnly}
      title={status === "attachable" ? t("caseTarget.menu.attach") : target.caseId ? t("caseTarget.menu.addHere") : t("caseTarget.menu.addToCase")}
      onClick={(e) => {
        e.stopPropagation();
        target.add([candidate]);
      }}
      data-testid="add-to-case-button"
    >
      {target.caseId ? <Plus className="size-2.5" aria-hidden /> : <FolderPlus className="size-2.5" aria-hidden />}
      {status === "attachable" ? t("caseTarget.attachShort") : t("caseTarget.addShort")}
    </Button>
  );
}

/** A graph node as a candidate, when it names something that can join a case. */
export function nodeCandidate(node: GraphNodeDto): CaseCandidate | null {
  if (node.type === "asset") {
    return {
      kind: "asset",
      id: node.id,
      assetId: node.id,
      label: node.label,
      assetName: node.label,
      assetType: node.assetType ?? null,
      sourceType: node.sourceType ?? null,
    };
  }
  if (node.type === "finding" && node.assetId) {
    return {
      kind: "finding",
      id: node.id,
      assetId: node.assetId,
      label: [node.detectorType, node.label].filter(Boolean).join(": "),
      assetName: node.assetName ?? null,
      sourceType: node.sourceType ?? null,
    };
  }
  return null;
}

const IN_CASE_BADGE = { id: "in-case", text: "IN CASE", placement: "tr" as const, accent: true };

/**
 * Mark the nodes already in the case (inside a case only): the graph's own
 * decoration, plus an "in case" badge.
 */
export function useCaseDecorator(target: CaseTarget, decorate?: NodeDecorator | null): NodeDecorator | undefined {
  return React.useMemo(() => {
    if (!target.caseId) return decorate ?? undefined;
    return (node: GraphNodeDto): NodeDecoration | null => {
      const base = decorate?.(node) ?? null;
      const candidate = nodeCandidate(node);
      if (!candidate || target.status(candidate) !== "inCase") return base;
      return { ...(base ?? {}), badges: [...(base?.badges ?? []), IN_CASE_BADGE] };
    };
  }, [target, decorate]);
}
