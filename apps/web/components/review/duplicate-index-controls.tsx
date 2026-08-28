"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, RefreshCw } from "lucide-react";
import { api, type ReviewPortfolioResponseDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { formatDate } from "@/lib/date";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Health of the duplicate index, in the same shape as the semantic one next to
 * it: what it currently holds, when it was last built, and one button.
 *
 * "Scheduled" is not a status a person can act on. These are the numbers that
 * tell you whether the queue you are about to work through is describing the
 * corpus as it stands.
 */
export function DuplicateIndexControls() {
  const { t } = useTranslation();
  const [portfolio, setPortfolio] =
    React.useState<ReviewPortfolioResponseDto | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(() => {
    api.correlationReview
      .correlationReviewControllerPortfolio()
      .then((p) => {
        setPortfolio(p);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : t("review.loadFailed")),
      );
  }, [t]);

  React.useEffect(() => refresh(), [refresh]);

  const rebuild = async () => {
    setBusy(true);
    try {
      const r =
        await api.correlationReview.correlationReviewControllerRebuild();
      toast.success(
        t("review.rebuildDone", { pairs: r.pairs, patterns: r.patterns }),
      );
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("review.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-[4px] border border-border bg-muted/30 p-3">
      <h3 className="flex items-center gap-1.5 font-serif text-sm font-black uppercase tracking-[0.06em]">
        <Copy className="h-3.5 w-3.5" />
        {t("review.index.dupTitle")}
      </h3>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : !portfolio ? (
        <Spinner size="sm" label={t("review.index.dupTitle")} />
      ) : (
        <div className="space-y-2 text-xs">
          <dl className="grid grid-cols-2 gap-1.5">
            <Stat
              label={t("review.index.dupPairs")}
              value={portfolio.totalPairs.toLocaleString()}
            />
            <Stat
              label={t("review.index.dupPatterns")}
              value={portfolio.patterns.length.toLocaleString()}
            />
            <Stat
              label={t("review.index.dupBuilt")}
              value={
                portfolio.computedAt
                  ? formatDate(portfolio.computedAt)
                  : t("review.index.dupNever")
              }
            />
            <Stat
              label={t("review.index.dupLineage")}
              // Worth stating plainly: with no lineage every pair reads
              // UNKNOWN, and the 2x2 that separates a derived copy from
              // genuinely unexplained duplication cannot do its job.
              value={
                portfolio.lineageHairball
                  ? t("review.lineage.unknown")
                  : t("review.index.dupLineageNone")
              }
            />
          </dl>

          <p className="text-[11px] text-muted-foreground">
            {t("review.index.dupHint")}
          </p>

          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-[11px]"
            onClick={rebuild}
            disabled={busy}
          >
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
            {busy
              ? t("review.index.dupRebuilding")
              : t("review.index.dupRebuild")}
          </Button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[3px] border border-border bg-background px-2 py-1">
      <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate font-mono text-[11px] text-foreground">{value}</dd>
    </div>
  );
}
