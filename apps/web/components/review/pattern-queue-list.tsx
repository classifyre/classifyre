"use client";

import * as React from "react";
import { ChevronRight, ShieldAlert } from "lucide-react";
import type { ReviewPatternDto } from "@workspace/api-client";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { panelHeadingClass } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { fmt, patternBand, score2, type Cutoffs } from "./review-format";

/**
 * The main object on level 1.
 *
 * Clusters are one level down, and that inversion is what makes the tool
 * scale: eighteen thousand clusters is unnavigable however it is sorted, but
 * the same estate is five or six failure signatures, and the top one is
 * usually a normalisation rule someone can write in an afternoon.
 */
export function PatternQueueList({
  patterns,
  cutoffs,
  selectedIndex,
  onSelect,
  onOpen,
}: {
  patterns: ReviewPatternDto[];
  cutoffs: Cutoffs;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onOpen: (patternKey: string) => void;
}) {
  const { t } = useTranslation();

  const ranked = React.useMemo(
    () =>
      patterns
        .map((pattern) => ({ pattern, band: patternBand(pattern, cutoffs) }))
        .filter((row) => row.band.inBand > 0)
        .sort((a, b) => b.band.reviewValue - a.band.reviewValue),
    [patterns, cutoffs],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className={panelHeadingClass}>{t("review.patterns.title")}</h3>
      </div>

      {ranked.length === 0 ? (
        <p className="border-t-2 border-border py-6 text-center text-[12px] text-muted-foreground">
          {t("review.patterns.noneInBand")}
        </p>
      ) : (
        <ul className="border-t-2 border-border">
          {ranked.map(({ pattern, band }, index) => {
            const isMisc = pattern.patternKey.endsWith("misc");
            const name = isMisc
              ? t("review.patterns.miscLabel")
              : pattern.labels.join(" + ") || pattern.patternKey;
            const capped = pattern.truePairCount > pattern.pairCount;

            return (
              <li key={pattern.patternKey}>
                <button
                  type="button"
                  onMouseEnter={() => onSelect(index)}
                  onFocus={() => onSelect(index)}
                  onClick={() => onOpen(pattern.patternKey)}
                  aria-current={index === selectedIndex}
                  className={`flex w-full items-center gap-3 border-b-2 border-border px-1 py-3 text-left transition-colors hover:bg-muted/60 ${
                    index === selectedIndex ? "bg-muted/40" : ""
                  }`}
                >
                  <span className="w-7 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="truncate text-[13.5px] font-medium text-foreground">
                        {name}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {t(
                          `review.patterns.family.${pattern.family}` as TranslationKey,
                        )}
                      </span>
                    </span>
                    <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-muted-foreground">
                      {band.undecided === 1
                        ? t("review.patterns.undecidedOne")
                        : t("review.patterns.undecided", {
                            count: fmt(band.undecided),
                          })}
                      {" · "}
                      {band.clustersInBand === 1
                        ? t("review.patterns.clustersOne")
                        : t("review.patterns.clusters", {
                            count: fmt(band.clustersInBand),
                          })}
                      {" · "}
                      {t("review.patterns.avg", {
                        score: score2(pattern.avgWeighted),
                      })}
                      {" · "}
                      {t(
                        `review.patterns.shape.${pattern.topologyShape}` as TranslationKey,
                      )}
                      {capped
                        ? ` · ${t("review.patterns.capped", {
                            shown: fmt(pattern.pairCount),
                            total: fmt(pattern.truePairCount),
                          })}`
                        : ""}
                    </span>
                  </span>

                  {/* An unexplained match is the finding worth surfacing, so
                      it gets its own marker rather than being folded into the
                      score. */}
                  {pattern.lineageNoPathPairs > 0 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-[3px] border-2 border-destructive bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] text-destructive">
                          <ShieldAlert className="h-3 w-3" aria-hidden />
                          {fmt(pattern.lineageNoPathPairs)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px]">
                        {t("review.lineage.noPathHint")}
                      </TooltipContent>
                    </Tooltip>
                  ) : null}

                  <span
                    className={`shrink-0 rounded-[3px] border-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
                      pattern.ruleKind === "JUDGEMENT"
                        ? "border-border bg-background text-muted-foreground"
                        : "border-accent bg-accent/20 text-foreground"
                    }`}
                  >
                    {t(`review.patterns.rule.${pattern.ruleKind}` as TranslationKey)}
                  </span>

                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
