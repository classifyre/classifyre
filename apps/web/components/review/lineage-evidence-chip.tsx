"use client";

import * as React from "react";
import { ArrowUpRight, GitBranch, HelpCircle, ShieldAlert } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Lineage as evidence attached to a match — never as a view of its own.
 *
 * Three states, because two would lie. "No path" and "we have no lineage for
 * these assets" are different claims, and collapsing them turns every
 * poorly-instrumented corner of an estate into a false positive. Only the
 * middle state is worth chasing:
 *
 *   PATH     a derived copy. Expected redundancy — a mart that resembles its
 *            source is doing its job, and flagging it is the main reason
 *            metadata-only duplicate detection gets ignored.
 *   NO_PATH  both sides have lineage and nothing connects them. Two teams
 *            built the same thing independently, which is expensive and
 *            invisible without both signals.
 *   UNKNOWN  a coverage gap. Not evidence in either direction.
 */
export function LineageEvidenceChip({
  state,
  relation,
  aDegree,
  bDegree,
  hairball,
  onOpenLineage,
  compact,
}: {
  state: string;
  relation?: string;
  aDegree?: number;
  bDegree?: number;
  hairball?: boolean;
  onOpenLineage?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();

  const config =
    state === "PATH"
      ? {
          label: t("review.lineage.path"),
          hint: t("review.lineage.pathHint"),
          Icon: GitBranch,
          className: "border-border bg-muted text-muted-foreground",
        }
      : state === "NO_PATH"
        ? {
            label: t("review.lineage.noPath"),
            hint: t("review.lineage.noPathHint"),
            Icon: ShieldAlert,
            className:
              "border-destructive bg-destructive/10 text-destructive font-semibold",
          }
        : {
            label: t("review.lineage.unknown"),
            hint: hairball
              ? t("review.lineage.hairball")
              : t("review.lineage.unknownHint"),
            Icon: HelpCircle,
            className: "border-border bg-background text-muted-foreground",
          };

  const { Icon } = config;
  const coverage =
    aDegree != null && bDegree != null
      ? aDegree === 0 || bDegree === 0
        ? t("review.lineage.noCoverage")
        : t("review.lineage.coverage", { count: aDegree + bDegree })
      : null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1.5 rounded-[3px] border-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] font-mono ${config.className}`}
          >
            <Icon className="h-3 w-3 shrink-0" aria-hidden />
            {config.label}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px]">
          <p>{config.hint}</p>
          {relation && relation !== "UNKNOWN" ? (
            <p className="mt-1 text-muted-foreground">
              {t(
                `review.lineage.relation.${relation}` as
                  | "review.lineage.relation.ANCESTOR_DESCENDANT"
                  | "review.lineage.relation.SIBLING"
                  | "review.lineage.relation.CONNECTED_OTHER"
                  | "review.lineage.relation.DISCONNECTED"
                  | "review.lineage.relation.UNKNOWN",
              )}
            </p>
          ) : null}
          {/* Coverage sits next to the verdict on purpose: "no path" is only
              meaningful if you can see how much lineage we actually have. */}
          {coverage ? (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {coverage}
            </p>
          ) : null}
        </TooltipContent>
      </Tooltip>

      {!compact && onOpenLineage ? (
        <button
          type="button"
          onClick={onOpenLineage}
          className="inline-flex items-center gap-0.5 text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t("review.lineage.openInLineage")}
          <ArrowUpRight className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
