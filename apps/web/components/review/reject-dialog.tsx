"use client";

import * as React from "react";
import { toast } from "sonner";
import { api, type RejectCauseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Spinner } from "@workspace/ui/components/spinner";
import { useTranslation } from "@/hooks/use-translation";
import { fmt, pct } from "./review-format";

/**
 * Rejecting a pair, and offering to stop it happening again.
 *
 * A rejection on its own changes nothing about the matcher: the next scan
 * produces the same pair from the same evidence, and the backlog regenerates.
 * So the rejection names the label carrying the score and offers the two fixes
 * that actually address it — lower that label's weight, or stop matching on
 * the specific values involved.
 *
 * The offer is only made when one label genuinely dominates. On an even split
 * there is nothing to single out, and suggesting a weight change would be
 * advice to break the labels that were doing their job.
 */
export function RejectDialog({
  open,
  onOpenChange,
  aId,
  bId,
  onRejected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  aId: string;
  bId: string;
  onRejected: () => void;
}) {
  const { t } = useTranslation();
  const [cause, setCause] = React.useState<RejectCauseDto | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setCause(null);
    api.correlationReview
      .correlationReviewControllerCause({ aId, bId })
      .then((c) => {
        if (active) setCause(c);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, aId, bId]);

  const record = React.useCallback(async () => {
    await api.correlationReview.correlationReviewControllerRecordVerdicts({
      recordVerdictDto: { pairs: [{ aId, bId }], verdict: "REJECTED" },
    });
  }, [aId, bId]);

  const rejectOnly = async () => {
    setBusy(true);
    try {
      await record();
      toast.success(t("review.actions.rejected"));
      onOpenChange(false);
      onRejected();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const rejectAndFix = async (mode: "weight" | "exclude") => {
    if (!cause?.dominantLabel) return;
    setBusy(true);
    try {
      await record();
      if (mode === "weight") {
        const driver = cause.drivers.find(
          (d) => d.label === cause.dominantLabel,
        );
        await api.correlation.correlationControllerUpdateConfig({
          updateCorrelationConfigDto: {
            labelWeights: {
              [cause.dominantLabel]: Math.max(
                0,
                (driver?.weight ?? 1) - 1,
              ),
            },
          },
        });
      } else {
        await api.correlation.correlationControllerAddExclusion({
          addExclusionDto: { mode: "label", label: cause.dominantLabel },
        });
      }
      toast.success(t("review.actions.fixApplied"));
      onOpenChange(false);
      onRejected();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const dominant = cause?.dominantLabel
    ? cause.drivers.find((d) => d.label === cause.dominantLabel)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("review.actions.causeTitle")}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : cause ? (
          <div className="space-y-3">
            <p className="text-[13px] text-foreground">
              {dominant
                ? t("review.actions.causeDominant", {
                    label: dominant.label,
                    percent: pct(dominant.share),
                    weight: dominant.weight,
                  })
                : t("review.actions.causeSpread", {
                    count: cause.drivers.length,
                  })}
            </p>

            <ul className="space-y-1.5">
              {cause.drivers.slice(0, 5).map((d) => (
                <li key={d.label} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[11px] text-foreground">
                      {d.label}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {pct(d.share)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-[2px] bg-muted">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${d.share * 100}%` }}
                    />
                  </div>
                  {d.values.length > 0 ? (
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {d.values.join(", ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>

            {/* Scale is what turns one rejection into a decision worth taking:
                fixing the driver clears every pair the same combination made. */}
            {cause.similarPairs > 1 ? (
              <p className="rounded-[4px] border-2 border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
                {t("review.actions.causeSimilar", {
                  count: fmt(cause.similarPairs),
                })}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="flex-wrap gap-2">
          {dominant ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => rejectAndFix("weight")}
                disabled={busy}
              >
                {t("review.actions.fixWeight", { label: dominant.label })}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => rejectAndFix("exclude")}
                disabled={busy}
              >
                {t("review.actions.fixExclude")}
              </Button>
            </>
          ) : null}
          <Button size="sm" onClick={rejectOnly} disabled={busy}>
            {t("review.actions.fixSkip")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
