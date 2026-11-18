"use client";

import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { Database, Share2, ShieldCheck, Waypoints } from "lucide-react";
import { api } from "@workspace/api-client";
import type { AssetsOverviewDto } from "@workspace/api-client";
import { Skeleton, TabsList, TabsTrigger } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

export const ASSETS_TABS = ["raw", "governed", "shared", "explore"] as const;
export type AssetsTab = (typeof ASSETS_TABS)[number];

/**
 * The four views of the assets page, as cards that are tabs: each shows
 * what is behind it, and the URL keeps the one picked (`?tab=`).
 */
export function AssetTabCards({
  overview,
}: {
  overview: AssetsOverviewDto | null;
}) {
  const { t } = useTranslation();
  // null while loading: the card keeps its height with a skeleton.
  const n = (value: number | undefined) =>
    value === undefined ? null : value.toLocaleString();
  // Explore's card counts what was kept of it: the saved views.
  const [savedViews, setSavedViews] = useState<number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api.explore
      .exploreControllerListViews()
      .then((views) => live && setSavedViews(views.length))
      .catch(() => live && setSavedViews(0));
    return () => {
      live = false;
    };
  }, []);

  return (
    <TabsList
      className="grid h-auto w-full grid-cols-1 gap-3 bg-transparent p-0 group-data-[orientation=horizontal]/tabs:h-auto sm:grid-cols-2 xl:grid-cols-4"
      aria-label={t("assets.tabs.label")}
    >
      <TabCard
        value="raw"
        icon={Database}
        label={t("assets.tabs.raw")}
        value_={n(overview?.raw.total)}
        sub={
          overview
            ? t("assets.tabs.rawSub", {
                new: overview.raw._new.toLocaleString(),
                updated: overview.raw.updated.toLocaleString(),
              })
            : null
        }
      />
      <TabCard
        value="governed"
        icon={ShieldCheck}
        label={t("assets.tabs.governed")}
        value_={n(overview?.governance.governed)}
        sub={
          overview
            ? t("assets.tabs.governedSub", {
                certified: overview.governance.certified.toLocaleString(),
                failing: overview.governance.failing.toLocaleString(),
              })
            : null
        }
      />
      <TabCard
        value="shared"
        icon={Share2}
        label={t("assets.tabs.shared")}
        value_={n(overview?.shared.total)}
        sub={
          overview
            ? t("assets.tabs.sharedSub", {
                certified: overview.shared.certified.toLocaleString(),
              })
            : null
        }
      />
      <TabCard
        value="explore"
        icon={Waypoints}
        label={t("assets.explore.tab")}
        value_={n(savedViews)}
        sub={t("assets.explore.tabSub")}
      />
    </TabsList>
  );
}

function TabCard({
  value,
  icon: Icon,
  label,
  value_,
  sub,
}: {
  value: AssetsTab;
  icon: ComponentType<{ className?: string }>;
  label: string;
  /** null while loading. */
  value_: string | null;
  /** null while loading. */
  sub: string | null;
}) {
  return (
    <TabsTrigger
      value={value}
      data-testid={`assets-tab-${value}`}
      className={cn(
        "group h-auto w-full flex-col items-stretch justify-start gap-0 whitespace-normal rounded-[6px] border-2 p-4 text-left shadow-none transition-all hover:-translate-y-px",
        // As every tile that is a choice (tileIdleClass / tileActiveClass in
        // panel-card): a plain card, dark like Incoming once chosen.
        "data-[state=inactive]:border-border data-[state=inactive]:bg-card data-[state=inactive]:text-foreground data-[state=inactive]:hover:bg-secondary/40 data-[state=inactive]:hover:text-foreground dark:data-[state=inactive]:text-foreground",
        "data-[state=active]:border-accent/30 data-[state=active]:bg-foreground data-[state=active]:text-accent data-[state=active]:shadow-none data-[state=active]:hover:text-accent dark:data-[state=active]:border-accent/30 dark:data-[state=active]:bg-background dark:data-[state=active]:text-accent dark:data-[state=active]:hover:text-accent",
      )}
    >
      <span className="flex w-full items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-[6px] [&_svg]:size-5",
            // tileIconClass: inverted, then the accent once chosen.
            "bg-foreground text-background group-data-[state=active]:bg-accent group-data-[state=active]:text-accent-foreground",
          )}
          aria-hidden
        >
          <Icon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground group-data-[state=active]:text-accent/70">
            {label}
          </span>
          {value_ === null ? (
            <Skeleton className="mt-1 h-[30px] w-20 bg-muted group-data-[state=active]:bg-accent/20" />
          ) : (
            <span
              className="mt-1 block text-3xl font-black leading-none"
              style={{ fontFamily: "var(--font-hero)" }}
            >
              {value_}
            </span>
          )}
          {sub === null ? (
            <Skeleton className="mt-1.5 h-4 w-36 bg-muted group-data-[state=active]:bg-accent/20" />
          ) : (
            <span className="mt-1.5 block truncate text-xs text-muted-foreground group-data-[state=active]:text-accent/70">
              {sub}
            </span>
          )}
        </span>
      </span>
    </TabsTrigger>
  );
}
