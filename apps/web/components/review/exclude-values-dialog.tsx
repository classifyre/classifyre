"use client";

import * as React from "react";
import { toast } from "sonner";
import { Ban, Loader2 } from "lucide-react";
import {
  api,
  type PatternExclusionCandidatesResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Spinner } from "@workspace/ui/components/spinner";
import { useTranslation } from "@/hooks/use-translation";
import { fmt } from "./review-format";
import type { Cutoffs, LineageFilter } from "./review-format";

const CHECKBOX_CLASS =
  "border-2 border-foreground/25 rounded-[2px] data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-accent-foreground";

/**
 * The fix a "rule candidate" pattern has been promising.
 *
 * A near-duplicate text pattern is a diagnosis, not the damage. Its own pairs
 * come from embedding similarity and survive any exclusion; what an exclusion
 * removes is the shared-value matches the template causes in OTHER patterns —
 * the mailbox in a signature block linking four hundred unrelated documents.
 * So the dialog leads with that number rather than the pattern's own size,
 * which would be the one figure on screen the action does not change.
 *
 * Values are shown and chosen individually because this writes instance-wide
 * config. "Stop matching on these values" with no list of the values would ask
 * someone to approve a change they cannot see.
 */
export function ExcludeValuesDialog({
  open,
  onOpenChange,
  patternKey,
  cutoffs,
  lineage,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patternKey: string;
  cutoffs: Cutoffs;
  lineage: LineageFilter | null;
  onApplied: () => void;
}) {
  const { t } = useTranslation();
  const [data, setData] =
    React.useState<PatternExclusionCandidatesResponseDto | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setData(null);
    api.correlationReview
      .correlationReviewControllerExclusionCandidates({ patternKey })
      .then((res) => {
        if (!active) return;
        setData(res);
        // Everything on by default: the list is already filtered to values
        // more than one asset holds, so the common case is "all of it".
        setPicked(new Set(res.candidates.map((c) => c.valueHash)));
      })
      .catch((e: unknown) => {
        if (active)
          toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, patternKey, t]);

  const toggle = (hash: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });

  const apply = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const res = await api.correlationReview.correlationReviewControllerApply({
        patternKey,
        patternActionDto: {
          // Not a duplicate, not confirmed: these assets matched because they
          // carry the same template, which is the opposite of being the same
          // thing. REJECTED is also what stops later scans re-clustering them.
          verdict: "REJECTED",
          min: cutoffs.review,
          max: cutoffs.merge,
          ...(lineage ? { lineage } : {}),
          excludeValueHashes: [...picked],
        },
      });
      toast.success(
        t("review.exclude.applied", {
          rules: fmt(res.exclusionRuleIds.length),
          pairs: fmt(res.applied),
        }),
      );
      onOpenChange(false);
      onApplied();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const candidates = data?.candidates ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("review.exclude.title")}</DialogTitle>
          <DialogDescription>{t("review.exclude.intro")}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : candidates.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            {t("review.exclude.none")}
          </p>
        ) : (
          <div className="space-y-3">
            {/* The consequence, stated before the list. This is the number the
                action changes; the pattern's own pair count is not. */}
            <p className="rounded-[4px] border-2 border-border bg-background px-3 py-2 text-[12px] leading-5 text-foreground">
              {t("review.exclude.impact", {
                pairs: fmt(data?.pairsDriven ?? 0),
                values: fmt(candidates.length),
              })}
            </p>

            <ul className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
              {candidates.map((c) => (
                <li key={c.valueHash}>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-[3px] px-1 py-1.5 hover:bg-muted/50">
                    <Checkbox
                      className={`mt-0.5 ${CHECKBOX_CLASS}`}
                      checked={picked.has(c.valueHash)}
                      onCheckedChange={() => toggle(c.valueHash)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[11px] text-foreground">
                        {c.value}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {c.label} ·{" "}
                        {t("review.exclude.assets", {
                          count: fmt(c.assetCount),
                        })}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            {data && data.totalCandidates > candidates.length ? (
              <p className="font-mono text-[10px] text-muted-foreground">
                {t("review.exclude.capped", {
                  shown: fmt(candidates.length),
                  total: fmt(data.totalCandidates),
                })}
              </p>
            ) : null}

            <p className="font-mono text-[10px] leading-4 text-muted-foreground">
              {t("review.exclude.recomputeNote")}
            </p>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("review.exclude.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={apply}
            disabled={busy || picked.size === 0}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            {t("review.exclude.apply", { count: picked.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
