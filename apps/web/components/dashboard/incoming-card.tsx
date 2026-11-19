"use client";

import type { GovernanceUsageDto } from "@workspace/api-client";
import { CardFootnote, FootnoteDot, PanelCard } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import { growthLabel } from "./usage-chart-card";

/**
 * What comes in for your data: people asking for access, and people reading
 * it. Always dark — the one panel that is about other people, not the data.
 */
export function IncomingCard({
  requestsForMe,
  usage,
  days,
  onShowRequests,
}: {
  requestsForMe: number | undefined;
  usage: GovernanceUsageDto | null;
  days: number;
  onShowRequests: () => void;
}) {
  const { t } = useTranslation();
  const perDay = usage?.perDay ?? [];
  const today = perDay[perDay.length - 1];
  const readsToday = today ? today.reads : 0;
  const reads = usage?.reads ?? 0;
  const exports = usage?.exports ?? 0;
  const change = growthLabel(
    reads + exports,
    usage?.previous ?? 0,
    t("dashboard.usage.fresh"),
  );

  return (
    <PanelCard className="flex flex-col justify-between overflow-hidden border-accent/30 bg-foreground text-accent sm:p-6 dark:bg-background xl:col-span-3 xl:row-span-2">
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-accent/80">
        {t("dashboard.incoming.label")}
      </span>
      <div className="mt-4 flex flex-1 flex-col justify-center space-y-5">
        <button
          type="button"
          onClick={onShowRequests}
          className="group block cursor-pointer text-left"
          data-testid="incoming-requests"
        >
          <span
            className="block text-4xl font-bold leading-[0.85] sm:text-5xl"
            style={{ fontFamily: "var(--font-hero)" }}
          >
            {requestsForMe === undefined ? "—" : requestsForMe}
          </span>
          <span className="mt-1 block font-mono text-xs uppercase tracking-[0.15em] text-accent/70 group-hover:text-accent">
            {t("dashboard.incoming.requests")}
          </span>
        </button>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          <div className="min-w-0">
            <span
              className="block text-xl font-bold sm:text-2xl"
              style={{ fontFamily: "var(--font-hero)" }}
            >
              {readsToday.toLocaleString()}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-accent/60">
              {t("dashboard.incoming.readsToday")}
            </span>
          </div>
          <div className="min-w-0">
            <span
              className="block text-xl font-bold sm:text-2xl"
              style={{ fontFamily: "var(--font-hero)" }}
            >
              {reads.toLocaleString()}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-accent/60">
              {t("dashboard.incoming.readsPeriod", { days })}
            </span>
          </div>
        </div>
      </div>
      <CardFootnote tone="inverted" className="border-accent/25 text-accent/55">
        <span>{t("dashboard.incoming.exports", { count: exports })}</span>
        <FootnoteDot tone="inverted" />
        <span>{t("dashboard.incoming.change", { change, days })}</span>
      </CardFootnote>
    </PanelCard>
  );
}
