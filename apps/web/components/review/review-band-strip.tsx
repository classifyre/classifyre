"use client";

import * as React from "react";
import { microLabelClass } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import { fmt, type PortfolioBands } from "./review-format";

/**
 * Three numbers and one bar, before any list.
 *
 * It exists to say "most of this is already handled" in the first second. A
 * queue that opens with its total volume reads as an accusation; the same
 * corpus split into auto-confirmed, yours, and rejected reads as a workload.
 * It also makes the size of the auto-confirmed band visible, which is what
 * makes moving a cutoff feel consequential rather than cosmetic.
 */
export function ReviewBandStrip({ bands }: { bands: PortfolioBands }) {
  const { t } = useTranslation();
  const total = Math.max(1, bands.total);
  const segments = [
    {
      key: "autoConfirmed" as const,
      value: bands.autoConfirmed,
      label: t("review.band.autoConfirmed"),
      bar: "bg-foreground",
      swatch: "bg-foreground",
    },
    {
      key: "needsReview" as const,
      value: bands.needsReview,
      label: t("review.band.needsReview"),
      bar: "bg-accent",
      swatch: "bg-accent",
    },
    {
      key: "rejected" as const,
      value: bands.rejected,
      label: t("review.band.rejected"),
      bar: "bg-muted",
      swatch: "bg-muted",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className={microLabelClass}>{t("review.band.title")}</span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {t("review.band.caption")}
        </span>
      </div>
      <div
        className="flex h-3 overflow-hidden rounded-[3px] border-2 border-border"
        role="img"
        aria-label={segments
          .map((s) => `${s.label}: ${fmt(s.value)}`)
          .join(", ")}
      >
        {segments.map((s) => (
          <span
            key={s.key}
            className={s.bar}
            style={{ width: `${(s.value / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {segments.map((s) => (
          <span key={s.key} className="flex items-baseline gap-2">
            <span
              className={`h-2 w-2 shrink-0 translate-y-[-1px] rounded-[2px] border border-border ${s.swatch}`}
            />
            <span className="text-[11px] text-muted-foreground">{s.label}</span>
            <span className="font-mono text-[12px] font-semibold tabular-nums text-foreground">
              {fmt(s.value)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
