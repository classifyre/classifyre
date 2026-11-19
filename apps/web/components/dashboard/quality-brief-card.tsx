"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { GovernanceDashboardDto } from "@workspace/api-client";
import { FINDING_SEVERITY_COLOR_BY_LEVEL } from "@workspace/ui/lib/finding-severity";
import { CardFootnote, PanelCard } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import type { AssetsLink } from "@/lib/dashboard-links";
import type { TranslationKey } from "@/i18n";

const SEVERITY_RANK = ["critical", "high", "medium", "low", "info"] as const;
type Severity = (typeof SEVERITY_RANK)[number];

/** Every rule passes: the accent's ink, deep enough to carry white text. */
const PASSING = "#3f5800";
/** No rule yet: the same slate the findings brief used for "nothing". */
const NOTHING = "#111827";

/**
 * Quality, coloured by its worst news.
 *
 * The card takes the colour of the most severe failing rule — the same scale
 * the findings pages use, so a red card here means what a red badge means
 * there. With nothing failing it turns the accent's deep green; with no rule
 * at all, slate. Rows are the score per quality dimension.
 */
export function QualityBriefCard({
  dashboard,
  link,
}: {
  dashboard: GovernanceDashboardDto | null;
  link: AssetsLink;
}) {
  const { t } = useTranslation();
  const totals = dashboard?.totals;
  const score = totals?.score ?? null;
  const failing = totals?.failing ?? 0;
  const dimensions = (dashboard?.quality.dimensions ?? []).filter(
    (dimension) => dimension.rules > 0,
  );

  const worst: Severity | null =
    SEVERITY_RANK.find((level) =>
      dashboard?.failing.some((row) => row.severity.toLowerCase() === level),
    ) ?? (failing > 0 ? "medium" : null);
  const background = worst
    ? FINDING_SEVERITY_COLOR_BY_LEVEL[worst]
    : score !== null
      ? PASSING
      : NOTHING;

  const dimensionLabel = (dimension: string) => {
    const key = `governance.quality.dimension.${dimension}` as TranslationKey;
    const label = t(key);
    return label === key ? dimension : label;
  };

  return (
    <PanelCard
      className="flex flex-col justify-between text-white sm:col-span-2 sm:p-8 xl:col-span-4 xl:row-span-2"
      style={{ backgroundColor: background }}
    >
      <div className="flex items-end justify-between gap-4">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-white/80">
          {t("dashboard.qualityBrief.label")}
        </span>
        <div className="text-right" data-testid="quality-score">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/70">
            {score === null
              ? t("dashboard.qualityBrief.noScore")
              : t("dashboard.qualityBrief.score")}
          </span>
          <span
            className="block text-3xl font-bold leading-tight"
            style={{ fontFamily: "var(--font-hero)" }}
          >
            {score === null ? "—" : `${score}%`}
          </span>
        </div>
      </div>

      {dimensions.length === 0 ? (
        <p className="mt-4 text-sm text-white/85">
          {t("dashboard.qualityBrief.none")}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {dimensions.map((dimension) => (
            <li key={dimension.dimension}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-sm uppercase tracking-[0.15em] text-white/90">
                  {dimensionLabel(dimension.dimension)}
                </span>
                <span
                  className="text-2xl font-bold tabular-nums"
                  style={{ fontFamily: "var(--font-hero)" }}
                >
                  {dimension.score === null ? "—" : `${dimension.score}%`}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-white"
                  style={{ width: `${dimension.score ?? 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <CardFootnote tone="inverted">
        {failing > 0 ? (
          <Link
            href={link("failing")}
            className="group/fail inline-flex items-center gap-1 text-white/90 hover:text-white"
            data-testid="quality-failing"
          >
            {t("dashboard.qualityBrief.failing", {
              count: failing.toLocaleString(),
            })}
            <ArrowRight className="h-3 w-3 transition-transform group-hover/fail:translate-x-0.5" />
          </Link>
        ) : score !== null ? (
          t("dashboard.qualityBrief.allPassing")
        ) : (
          t("dashboard.qualityBrief.howTo")
        )}
      </CardFootnote>
    </PanelCard>
  );
}
