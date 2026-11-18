"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { DashboardTotalsDto } from "@workspace/api-client";
import { CardFootnote, FootnoteDot, PanelCard } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import type { DashboardScope } from "@/lib/governance";
import type { AssetsLink } from "@/lib/dashboard-links";
import {
  LIFECYCLE_LOOK,
  RailLegend,
  SegmentRail,
  type RailSegment,
} from "./segment-rail";

/**
 * The hero of the dashboard: how much of the data someone answers for.
 *
 * One number (governed) over the whole (assets), and one rail that splits the
 * whole by lifecycle — certified, draft, deprecated, retired — and the
 * ungoverned rest, so the next job reads off its longest stretch. Every part
 * of the rail, and every count under it, opens exactly those assets.
 */
export function GovernanceBriefCard({
  totals,
  scope,
  link,
}: {
  totals: DashboardTotalsDto | undefined;
  scope: DashboardScope;
  link: AssetsLink;
}) {
  const { t } = useTranslation();
  const assets = totals?.assets ?? 0;
  const governed = totals?.governed ?? 0;
  const certified = totals?.certified ?? 0;
  const percent = (part: number, whole: number) =>
    whole > 0 ? Math.round((part / whole) * 100) : 0;

  const segments: RailSegment[] = [
    {
      key: "certified",
      label: t("governance.status.ACTIVE"),
      href: link("active"),
      count: certified,
      ...LIFECYCLE_LOOK.ACTIVE,
    },
    {
      key: "draft",
      label: t("governance.status.DRAFT"),
      href: link("draft"),
      count: totals?.draft ?? 0,
      ...LIFECYCLE_LOOK.DRAFT,
    },
    {
      key: "deprecated",
      label: t("governance.status.DEPRECATED"),
      href: link("deprecated"),
      count: totals?.deprecated ?? 0,
      ...LIFECYCLE_LOOK.DEPRECATED,
    },
    {
      key: "retired",
      label: t("governance.status.RETIRED"),
      href: link("retired"),
      count: totals?.retired ?? 0,
      ...LIFECYCLE_LOOK.RETIRED,
    },
    {
      key: "ungoverned",
      label: t("governance.status.UNGOVERNED"),
      href: link("ungoverned"),
      count: Math.max(0, assets - governed),
      ...LIFECYCLE_LOOK.UNGOVERNED,
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
        href={link("governed")}
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
        <RailLegend
          segments={segments}
          testIdPrefix="brief"
          columns="grid-cols-3 sm:grid-cols-5"
        />
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
