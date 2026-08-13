"use client";

import { RefreshCw } from "lucide-react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { formatDate, formatRelative } from "@/lib/date";
import { useTranslation } from "@/hooks/use-translation";

type StatsFreshnessProps = {
  /** When the underlying rollup was last rebuilt. */
  refreshedAt?: Date | string | null;
  /** False while a workspace has never built its rollup. */
  isBuilt?: boolean;
  /** 'live' means the figures were counted directly rather than read from the rollup. */
  source?: "rollup" | "live";
  /** Queues a rebuild. Resolve when the request is accepted, not when it finishes. */
  onRefresh: () => void | Promise<void>;
  isRefreshing?: boolean;
};

/**
 * Says how old a cached figure is and offers to rebuild it.
 *
 * The dashboard reads pre-aggregated tables instead of counting findings live,
 * which is the difference between an instant page and a ~43 s one. That is only
 * an honest trade if the page admits the numbers are a snapshot — so this sits
 * in the corner of any section backed by the rollup, small enough to ignore and
 * specific enough to trust.
 */
export function StatsFreshness({
  refreshedAt,
  isBuilt = true,
  source = "rollup",
  onRefresh,
  isRefreshing = false,
}: StatsFreshnessProps) {
  const { t } = useTranslation();
  const at = refreshedAt ? new Date(refreshedAt) : null;

  // Counted live: exact as of now, so a "last updated" stamp would be noise —
  // but the first rollup build is still pending, which is worth saying.
  const label =
    source === "live" || !isBuilt
      ? t("discovery.stats.building")
      : at
        ? t("discovery.stats.updated", { when: formatRelative(at) })
        : t("discovery.stats.never");

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground font-mono cursor-default">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px]">
          {source === "live" || !isBuilt
            ? t("discovery.stats.buildingHint")
            : t("discovery.stats.updatedHint")}
          {at && (
            <div className="text-muted-foreground/70 mt-1">{formatDate(at)}</div>
          )}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 rounded-[4px]"
            onClick={() => void onRefresh()}
            disabled={isRefreshing}
            aria-label={t("discovery.stats.refresh")}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("discovery.stats.refresh")}</TooltipContent>
      </Tooltip>
    </div>
  );
}
