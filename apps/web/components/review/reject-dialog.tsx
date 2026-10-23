"use client";

import * as React from "react";
import { toast } from "sonner";
import { api, type RejectCauseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
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
 * The weight offer is only made when one label genuinely dominates. On an
 * even split there is nothing to single out, and suggesting a weight change
 * would be advice to break the labels that were doing their job. Values are
 * different: a letterhead spreads a match across its address, phone and bank
 * account, and every one of them is the same mistake. So each shared value is
 * listed with how many documents hold it, and the ones that reach beyond this
 * pair start ticked.
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
  // Ticked values, keyed "label\u0000value".
  const [picked, setPicked] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setCause(null);
    api.correlationReview
      .correlationReviewControllerCause({ aId, bId })
      .then((c) => {
        if (!active) return;
        setCause(c);
        setPicked(
          new Set(
            c.drivers.flatMap((d) =>
              d.values
                .filter((_, i) => (d.holders[i] ?? 2) > 2)
                .map((v) => pickKey(d.label, v)),
            ),
          ),
        );
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

  const lowerWeight = async () => {
    if (!cause?.dominantLabel) return;
    setBusy(true);
    try {
      await record();
      const driver = cause.drivers.find((d) => d.label === cause.dominantLabel);
      await api.correlation.correlationControllerUpdateConfig({
        updateCorrelationConfigDto: {
          labelWeights: {
            [cause.dominantLabel]: Math.max(0, (driver?.weight ?? 1) - 1),
          },
        },
      });
      toast.success(t("review.actions.fixApplied"));
      onOpenChange(false);
      onRejected();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * One value rule per ticked value, scoped to its label — never the whole
   * label. One bank account on every invoice the firm sends is noise; the
   * same label carrying another account under two supplier names is the case.
   * Switching a whole label off belongs on the tuning screen.
   */
  const excludePicked = async () => {
    if (!cause || picked.size === 0) return;
    setBusy(true);
    try {
      await record();
      for (const d of cause.drivers) {
        for (const value of d.values) {
          if (!picked.has(pickKey(d.label, value))) continue;
          await api.correlation.correlationControllerAddExclusion({
            addExclusionDto: { mode: "value", label: d.label, value },
          });
        }
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

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const dominant = cause?.dominantLabel
    ? cause.drivers.find((d) => d.label === cause.dominantLabel)
    : null;
  const hasValues = cause?.drivers.some((d) => d.values.length > 0) ?? false;

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
                  {d.values.map((v, i) => {
                    const key = pickKey(d.label, v);
                    return (
                      <label
                        key={key}
                        className="flex cursor-pointer items-center gap-2 py-0.5"
                      >
                        <Checkbox
                          checked={picked.has(key)}
                          onCheckedChange={() => toggle(key)}
                          className="border-2 border-foreground/25 rounded-[2px] data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-accent-foreground"
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                          {v}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                          {t("review.actions.causeHolders", {
                            count: fmt(d.holders[i] ?? 2),
                          })}
                        </span>
                      </label>
                    );
                  })}
                </li>
              ))}
            </ul>

            {/* Scale is what turns one rejection into a decision worth taking:
                fixing the driver clears every pair the same combination made. */}
            {hasValues ? (
              <p className="text-[11px] text-muted-foreground">
                {t("review.actions.causePickHint")}
              </p>
            ) : null}

            {cause.similarPairs > 0 ? (
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
            <Button
              variant="outline"
              size="sm"
              onClick={lowerWeight}
              disabled={busy}
            >
              {t("review.actions.fixWeight", { label: dominant.label })}
            </Button>
          ) : null}
          {hasValues ? (
            <Button
              variant="outline"
              size="sm"
              onClick={excludePicked}
              disabled={busy || picked.size === 0}
            >
              {t("review.actions.fixExclude")}
            </Button>
          ) : null}
          <Button size="sm" onClick={rejectOnly} disabled={busy}>
            {t("review.actions.fixSkip")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const pickKey = (label: string, value: string): string =>
  `${label}\u0000${value}`;
