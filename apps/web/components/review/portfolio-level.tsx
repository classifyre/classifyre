"use client";

import * as React from "react";
import type { ReviewPortfolioResponseDto } from "@workspace/api-client";
import { useRouter } from "next/navigation";
import { PanelCard, microLabelClass } from "@/components/panel-card";
import { useNsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import { PatternQueueList } from "./pattern-queue-list";
import { encodePatternKey, fmt } from "./review-format";
import type { DuplicatesShellContext } from "./duplicates-shell";

/**
 * Level 1.
 *
 * The largest number on screen is the work remaining, not the volume detected.
 * A tool that opens with "247,000 candidate pairs" is telling someone they have
 * already failed, and they close it. The duplicate rate sits small in the
 * corner as a health metric — and as assets affected over total assets, since
 * a cluster count without a denominator cannot distinguish a healthy estate
 * from a broken matcher.
 */
export function PortfolioLevel({
  portfolio,
  bands,
  cutoffs,
}: DuplicatesShellContext) {
  const { t } = useTranslation();
  const router = useRouter();
  const nsPath = useNsPath();
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  const rate =
    portfolio.totalAssets > 0
      ? (portfolio.assetsAffected / portfolio.totalAssets) * 100
      : 0;
  const clear = bands.workRemaining === 0;

  return (
    <PanelCard className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <p className={microLabelClass}>{t("review.hero.eyebrow")}</p>
          <p
            className="block pt-1 text-[clamp(3rem,9vw,5.5rem)] font-bold leading-[0.8] tracking-[0.02em] text-foreground tabular-nums"
            style={{ fontFamily: "var(--font-hero)" }}
          >
            {clear ? "0" : fmt(bands.workRemaining)}
          </p>
          <p className="mt-2 font-mono text-[12px] text-muted-foreground">
            {clear ? (
              t("review.hero.allDoneHint")
            ) : (
              <>
                {t("review.hero.pairsRemaining")}
                {" \u00b7 "}
                {t("review.hero.ofTotal", { total: fmt(bands.total) })}
              </>
            )}
          </p>
        </div>

        {/* Health metric, deliberately small. */}
        <div className="text-right">
          <p className={microLabelClass}>{t("review.hero.duplicateRate")}</p>
          <p className="mt-1 font-mono text-[19px] tabular-nums text-foreground">
            {rate.toFixed(1)}%
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {t("review.hero.assetsAffected", {
              affected: fmt(portfolio.assetsAffected),
              total: fmt(portfolio.totalAssets),
            })}
          </p>
        </div>
      </div>

      <PatternQueueList
        patterns={portfolio.patterns}
        cutoffs={cutoffs}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        onOpen={(key) =>
          router.push(nsPath(`/duplicates/patterns/${encodePatternKey(key)}`))
        }
      />
    </PanelCard>
  );
}
