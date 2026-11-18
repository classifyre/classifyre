"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { DashboardTotalsDto } from "@workspace/api-client";
import { CardFootnote, FootnoteDot, PanelCard } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import type { DashboardScope } from "@/lib/governance";
import { assetsHref, type AssetsDrill } from "@/lib/dashboard-links";
import {
  HATCH,
  RailLegend,
  SegmentRail,
  type RailSegment,
} from "./segment-rail";

/**
 * The hero of the dashboard: how much of the data someone answers for.
 *
 * One number (governed) over the whole (assets), and one rail that splits the
 * whole three ways — certified, governed but not certified yet, ungoverned —
 * so the next job reads off its longest hatched or dark stretch. Every part of
 * the rail, and every count under it, opens those assets.
 */
export function GovernanceBriefCard({
  totals,
  scope,
  sourceId,
}: {
  totals: DashboardTotalsDto | undefined;
  scope: DashboardScope;
  sourceId: string | null;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const href = (drill: AssetsDrill | null) =>
    nsPath(assetsHref(drill, scope, sourceId));

  const assets = totals?.assets ?? 0;
  const governed = totals?.governed ?? 0;
  const certified = totals?.certified ?? 0;
  const percent = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 100) : 0;

  const segments: RailSegment[] = [
    {
      key: "certified",
      label: t("dashboard.brief.certified"),
      href: href("active"),
      count: certified,
      className: "bg-accent text-accent-foreground",
    },
    {
      key: "notCertified",
      label: t("dashboard.brief.notCertified"),
      href: href("draft"),
      count: Math.max(0, governed - certified),
      className: "bg-foreground text-background",
    },
    {
      key: "ungoverned",
      label: t("dashboard.brief.ungoverned"),
      href: href("ungoverned"),
      count: Math.max(0, assets - governed),
      className: "bg-card text-foreground",
      style: HATCH,
      chip: true,
    },
  ];

  return (
    <PanelCard className="flex flex-col justify-between gap-6 sm:col-span-2 sm:p-8 xl:col-span-5 xl:row-span-2">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-foreground" aria-hidden />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
            {t("dashboard.brief.label")}
          </span>
        </div>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {scope === "mine"
            ? t("dashboard.brief.mine")
            : t("dashboard.brief.all")}
        </p>
      </div>

      <Link
        href={href("governed")}
        className="group block w-fit"
        data-testid="brief-governed"
      >
        <span
          className="flex items-baseline gap-3 font-bold leading-[0.78] tracking-[0.02em] text-foreground"
          style={{ fontFamily: "var(--font-hero)" }}
        >
          <span className="text-[clamp(4rem,13vw,7.5rem)]">
            {governed.toLocaleString()}
          </span>
          <span className="text-[clamp(1.5rem,4vw,2.5rem)] text-muted-foreground/60">
            /{assets.toLocaleString()}
          </span>
        </span>
        <span className="mt-3 block font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground group-hover:text-foreground">
          {t("dashboard.brief.governed")}
        </span>
      </Link>

      <div className="space-y-3">
        {assets === 0 ? (
          <p className="rounded-[4px] border-2 border-dashed border-border/40 px-3 py-4 text-sm text-muted-foreground">
            {t("dashboard.brief.empty")}
          </p>
        ) : (
          <SegmentRail
            segments={segments}
            label={t("dashboard.brief.rail")}
            testId="governance-rail"
          />
        )}
        <RailLegend segments={segments} testIdPrefix="brief" />
      </div>

      <CardFootnote>
        <span>
          {t("dashboard.brief.governedShare", {
            percent: percent(governed, assets),
          })}
        </span>
        <FootnoteDot />
        <span>
          {t("dashboard.brief.certifiedShare", {
            percent: percent(certified, governed),
          })}
        </span>
      </CardFootnote>
    </PanelCard>
  );
}
