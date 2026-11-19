"use client";

import { Suspense, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Loader2, Lock, Megaphone, Share2 } from "lucide-react";
import type { SharedDatasetSummaryDto } from "@workspace/api-client";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { AssetsTable } from "@/components/assets-table";
import {
  CardFootnote,
  FootnoteDot,
  PanelCard,
  microLabelClass,
  panelHeadingClass,
  tileActiveClass,
} from "@/components/panel-card";
import {
  UsageChartCard,
  type UsageSort,
} from "@/components/dashboard/usage-chart-card";
import {
  HATCH,
  LIFECYCLE_LOOK,
  RailLegend,
  SegmentRail,
  type RailSegment,
} from "@/components/dashboard/segment-rail";
import { useTranslation } from "@/hooks/use-translation";
import { useGovernanceUsage } from "@/lib/governance";
import { useSharedDatasets } from "@/lib/shared-datasets";
import { useUrlParams } from "@/lib/url-filters";

const DAYS = 30;
const ANY = "ANY";
/** Whether a dataset can be read now (`?state=`). */
export const DATASET_STATES = [
  "live",
  "blocked",
  "unavailable",
  "retired",
] as const;
type DatasetState = (typeof DATASET_STATES)[number];

/**
 * The Shared tab's own filters, which the asset search does not know — a
 * dataset's availability (`?state=`) and whether it is promoted
 * (`?promoted=1`) — read from the URL so the status card's links set them.
 */
function useDatasetFilters() {
  const { searchParams, setParams } = useUrlParams();
  const pathname = usePathname();
  const raw = searchParams.get("state");
  const state = (DATASET_STATES as readonly string[]).includes(raw ?? "")
    ? (raw as DatasetState)
    : null;
  const promoted = searchParams.get("promoted") === "1";
  /** This page with one filter changed, the rest kept. */
  const hrefWith = (key: "state" | "promoted", value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    return `${pathname}?${params.toString()}`;
  };
  return { state, promoted, setParams, hrefWith };
}

/**
 * The Shared tab (docs/prd/DQ-data-query.md §5.12): saved queries shared as
 * governed datasets — how much they are read, where they stand, and the same
 * asset list as the other tabs, each row labelled as a dataset.
 */
export function SharedAssetsView() {
  const [sort, setSort] = useState<UsageSort>("used");
  const usage = useGovernanceUsage({
    scope: "all",
    days: DAYS,
    sort,
    kind: "shared",
  });
  const { t } = useTranslation();
  const datasets = useSharedDatasets();
  const filters = useDatasetFilters();
  // Sent with the list's other filters: the search works them out itself.
  const datasetFilters = useMemo(
    () => ({
      datasetState: filters.state ?? undefined,
      promoted: filters.promoted ? true : undefined,
    }),
    [filters.state, filters.promoted],
  );

  return (
    <div className="space-y-6" data-testid="shared-assets-view">
      <div className="grid gap-4 xl:grid-cols-2">
        <UsageChartCard
          usage={usage.data}
          loading={usage.loading}
          days={DAYS}
          sort={sort}
          onSortChange={setSort}
        />
        <SharedStatusCard
          rows={datasets.data}
          loading={datasets.loading}
          hrefWith={filters.hrefWith}
        />
      </div>

      <Suspense>
        <AssetsTable
          kind="shared"
          preset="shared"
          datasetFilters={datasetFilters}
          toolbar={
            <>
              <Select
                value={filters.state ?? ANY}
                onValueChange={(value) =>
                  filters.setParams({ state: value === ANY ? null : value })
                }
              >
                <SelectTrigger
                  className="h-9 w-[190px] rounded-[4px] border-2 border-border"
                  data-testid="dataset-state-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>
                    {t("assets.sharedFilter.anyAvailability")}
                  </SelectItem>
                  {DATASET_STATES.map((state) => (
                    <SelectItem key={state} value={state}>
                      {t(`sharedDatasets.state.${state}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={filters.promoted}
                onClick={() =>
                  filters.setParams({ promoted: filters.promoted ? null : "1" })
                }
                className={cn(
                  "h-9 gap-1.5 rounded-[4px] border-2",
                  filters.promoted && tileActiveClass,
                  filters.promoted &&
                    "hover:bg-foreground/90 hover:text-accent dark:hover:bg-background/90",
                )}
                data-testid="dataset-promoted-filter"
              >
                <Megaphone className="h-3.5 w-3.5" aria-hidden />
                {t("assets.sharedFilter.promoted")}
              </Button>
            </>
          }
        />
      </Suspense>
    </div>
  );
}

const count = (
  rows: SharedDatasetSummaryDto[],
  test: (row: SharedDatasetSummaryDto) => boolean,
) => rows.filter(test).length;

/**
 * Where the shared datasets stand, as two rails: their lifecycle (certified,
 * draft, deprecated, retired) and whether they can be read now (live,
 * blocked, unreadable, retired) — and how many are promoted, or locked for
 * whoever is looking.
 */
function SharedStatusCard({
  rows: loaded,
  loading,
  hrefWith,
}: {
  rows: SharedDatasetSummaryDto[] | null;
  loading: boolean;
  hrefWith: (key: "state" | "promoted", value: string | null) => string;
}) {
  const { t } = useTranslation();
  const rows = loaded ?? [];

  const lifecycle: RailSegment[] = [
    {
      key: "active",
      label: t("governance.status.ACTIVE"),
      count: count(rows, (row) => row.lifecycle === "ACTIVE"),
      ...LIFECYCLE_LOOK.ACTIVE,
    },
    {
      key: "draft",
      label: t("governance.status.DRAFT"),
      count: count(rows, (row) => !row.lifecycle || row.lifecycle === "DRAFT"),
      ...LIFECYCLE_LOOK.DRAFT,
    },
    {
      key: "deprecated",
      label: t("governance.status.DEPRECATED"),
      count: count(rows, (row) => row.lifecycle === "DEPRECATED"),
      ...LIFECYCLE_LOOK.DEPRECATED,
    },
    {
      key: "retired",
      label: t("governance.status.RETIRED"),
      count: count(rows, (row) => row.lifecycle === "RETIRED"),
      ...LIFECYCLE_LOOK.RETIRED,
    },
  ];
  const availability: RailSegment[] = [
    {
      key: "live",
      href: hrefWith("state", "live"),
      label: t("sharedDatasets.state.live"),
      count: count(rows, (row) => row.state === "live"),
      className: "bg-accent text-accent-foreground",
    },
    {
      key: "blocked",
      href: hrefWith("state", "blocked"),
      label: t("sharedDatasets.state.blocked"),
      count: count(rows, (row) => row.state === "blocked"),
      className: "bg-destructive text-destructive-foreground",
    },
    {
      key: "unavailable",
      href: hrefWith("state", "unavailable"),
      label: t("sharedDatasets.state.unavailable"),
      count: count(rows, (row) => row.state === "unavailable"),
      className: "bg-card text-destructive",
      style: {
        backgroundImage:
          "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--destructive) 35%, transparent) 5px 7px)",
      },
      chip: true,
    },
    {
      key: "retired",
      href: hrefWith("state", "retired"),
      label: t("sharedDatasets.state.retired"),
      count: count(rows, (row) => row.state === "retired"),
      className: "bg-card text-foreground",
      style: HATCH,
      chip: true,
    },
  ];
  const promoted = count(rows, (row) => row.promoted);
  const locked = count(rows, (row) => !row.canQuery);

  return (
    <PanelCard className="flex flex-col">
      <div className="mb-4 min-w-0" data-testid="shared-status">
        <h3 className={panelHeadingClass}>{t("assets.sharedStatus.title")}</h3>
        <p className={microLabelClass}>
          {t("assets.sharedStatus.lead", { count: rows.length })}
        </p>
      </div>

      {loading && !loaded ? (
        <div className="flex h-[200px] items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center gap-2 rounded-[4px] border-2 border-dashed border-border/40 px-4 text-center text-sm text-muted-foreground">
          <Share2 className="size-6" aria-hidden />
          {t("sharedDatasets.page.emptyLead")}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <section className="space-y-2">
            <p className={microLabelClass}>
              {t("assets.sharedStatus.lifecycle")}
            </p>
            <SegmentRail
              segments={lifecycle}
              label={t("assets.sharedStatus.lifecycle")}
              testId="shared-lifecycle-rail"
            />
            <RailLegend segments={lifecycle} />
          </section>
          <section className="space-y-2">
            <p className={microLabelClass}>
              {t("assets.sharedStatus.availability")}
            </p>
            <SegmentRail
              segments={availability}
              label={t("assets.sharedStatus.availability")}
              testId="shared-availability-rail"
            />
            <RailLegend segments={availability} />
          </section>
        </div>
      )}

      {rows.length > 0 && (
        <CardFootnote className="mt-auto pt-2">
          <Link
            href={hrefWith("promoted", "1")}
            className="inline-flex items-center gap-1 hover:text-foreground"
            data-testid="shared-status-promoted"
          >
            <Megaphone className="h-3 w-3" aria-hidden />
            {t("assets.sharedStatus.promoted", { count: promoted })}
          </Link>
          <FootnoteDot />
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3" aria-hidden />
            {t("assets.sharedStatus.locked", { count: locked })}
          </span>
        </CardFootnote>
      )}
    </PanelCard>
  );
}
