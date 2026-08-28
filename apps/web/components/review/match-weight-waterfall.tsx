"use client";

import * as React from "react";
import type { ReviewWaterfallDto } from "@workspace/api-client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { panelHeadingClass } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import { score2 } from "./review-format";

/**
 * The most important screen in the product: why this pair scored what it did.
 *
 * Every label gets two bars — what it could have contributed if it matched
 * perfectly, and what it gave back by not matching. They sum, by construction,
 * to the score printed above them. That property is the whole point: a
 * reviewer can add up what they see and land on the headline number, so
 * nothing is hidden in a blend.
 *
 * The negative bars are what make this a judgement rather than a rubber stamp.
 * A label present on both sides with no value in common is evidence AGAINST,
 * and it belongs inside the sum where it can be weighed, not in a footnote.
 *
 * Everything stays on [0,1] — the same scale as the histogram, the cutoffs and
 * the stored score. Raw weight units would be a second scale that appears
 * nowhere else on the page, so they live in the tooltip instead.
 */
export function MatchWeightWaterfall({
  waterfall,
}: {
  waterfall: ReviewWaterfallDto;
}) {
  const { t } = useTranslation();

  if (waterfall.rows.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className={panelHeadingClass}>
          {t("review.waterfall.title", { score: score2(waterfall.storedScore) })}
        </h3>
        <p className="text-[12px] text-muted-foreground">
          {t("review.waterfall.unavailable")}
        </p>
      </div>
    );
  }

  // Scale bars against the largest single contribution so the smallest ones
  // stay visible; the axis is the zero line, not the frame edge.
  const extent = Math.max(
    0.0001,
    ...waterfall.rows.map((r) => Math.max(r.potential, Math.abs(r.penalty))),
  );
  const width = (value: number) => `${(Math.abs(value) / extent) * 46}%`;
  const drifted = Math.abs(waterfall.perfect - 1) > 0.005;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className={panelHeadingClass}>
          {t("review.waterfall.title", { score: score2(waterfall.storedScore) })}
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {t("review.waterfall.perfect", { value: score2(waterfall.perfect) })}
        </span>
      </div>

      <div>
        {waterfall.rows.map((row) => (
          <Tooltip key={row.label}>
            <TooltipTrigger asChild>
              <div className="flex cursor-help items-center gap-2 py-1">
                <span className="w-[104px] shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                  {row.label}
                </span>
                <span className="relative h-4 flex-1">
                  {/* Zero line: bars grow right for evidence, left against. */}
                  <span className="absolute inset-y-[-2px] left-1/2 w-px bg-border" />
                  {row.potential > 0 ? (
                    <span
                      className="absolute top-[3px] left-1/2 h-2.5 rounded-r-[2px] bg-accent"
                      style={{ width: width(row.potential) }}
                    />
                  ) : null}
                  {row.penalty < 0 ? (
                    <span
                      className="absolute top-[3px] right-1/2 h-2.5 rounded-l-[2px] bg-destructive"
                      style={{ width: width(row.penalty) }}
                    />
                  ) : null}
                </span>
                <span className="w-11 shrink-0 text-right font-mono text-[11px] tabular-nums text-foreground">
                  {row.actual > 0 ? "+" : ""}
                  {row.actual.toFixed(2)}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-mono text-[11px]">
                {t("review.waterfall.tooltip", {
                  weight: row.weight,
                  count: row.sharedCount,
                })}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {t("review.waterfall.for")} +{row.potential.toFixed(3)}
                {row.penalty < 0
                  ? ` · ${t("review.waterfall.against")} ${row.penalty.toFixed(3)}`
                  : ""}
              </p>
            </TooltipContent>
          </Tooltip>
        ))}

        <div className="mt-2 flex items-center gap-2 border-t-2 border-border pt-2">
          <span className="w-[104px] shrink-0 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground">
            {t("review.pair.eyebrow")}
          </span>
          <span className="flex-1" />
          <span className="w-11 shrink-0 text-right font-mono text-[12px] font-semibold tabular-nums text-foreground">
            {waterfall.total.toFixed(2)}
          </span>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {t("review.waterfall.caption")}
      </p>
      {waterfall.phonetic ? (
        <p className="text-[11px] text-muted-foreground">
          {t("review.waterfall.phonetic")}
        </p>
      ) : null}
      {/* When the profile and the scorer disagree the reference line moves
          visibly, rather than the discrepancy being absorbed silently. */}
      {drifted ? (
        <p className="text-[11px] text-muted-foreground">
          {t("review.waterfall.drift")}
        </p>
      ) : null}
    </div>
  );
}
