"use client";

import type { ComponentType, ReactNode } from "react";
import { Database, Inbox, Share2, ShieldCheck } from "lucide-react";
import type { AssetsOverviewDto } from "@workspace/api-client";
import { TabsList, TabsTrigger } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

export type AssetsTab = "governance" | "raw" | "shared";

/**
 * The three views of the assets page, as cards that are tabs: each shows
 * what is behind it, and the URL keeps the one picked (`?tab=`).
 */
export function AssetTabCards({
  overview,
}: {
  overview: AssetsOverviewDto | null;
}) {
  const { t } = useTranslation();
  const n = (value: number | undefined) =>
    value === undefined ? "—" : value.toLocaleString();
  const governance = overview?.governance;
  const waiting = governance?.requestsForMe ?? 0;

  return (
    <TabsList
      className="grid h-auto w-full grid-cols-1 gap-3 bg-transparent p-0 group-data-[orientation=horizontal]/tabs:h-auto sm:grid-cols-3"
      aria-label={t("assets.tabs.label")}
    >
      <TabCard
        value="governance"
        icon={ShieldCheck}
        iconClass="bg-accent text-accent-foreground"
        label={t("assets.tabs.governance")}
        value_={n(governance?.governed)}
        sub={
          governance
            ? t("assets.tabs.governanceSub", {
                certified: governance.certified.toLocaleString(),
                failing: governance.failing.toLocaleString(),
              })
            : null
        }
        badge={
          waiting > 0 ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-400/15 dark:text-amber-300"
              data-testid="requests-waiting"
            >
              <Inbox className="size-3" aria-hidden />
              {t("assets.tabs.requestsWaiting", { count: waiting })}
            </span>
          ) : null
        }
      />
      <TabCard
        value="raw"
        icon={Database}
        iconClass="bg-[color-mix(in_srgb,var(--chart-4)_16%,transparent)] text-[var(--chart-4)]"
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
        value="shared"
        icon={Share2}
        iconClass="bg-foreground text-background"
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
    </TabsList>
  );
}

function TabCard({
  value,
  icon: Icon,
  iconClass,
  label,
  value_,
  sub,
  badge,
}: {
  value: AssetsTab;
  icon: ComponentType<{ className?: string }>;
  iconClass: string;
  label: string;
  value_: string;
  sub: string | null;
  badge?: ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      data-testid={`assets-tab-${value}`}
      className={cn(
        "group h-auto w-full flex-col items-stretch justify-start gap-0 whitespace-normal rounded-[6px] border-2 border-border bg-card p-4 text-left text-foreground shadow-none transition-all",
        "hover:-translate-y-px hover:bg-secondary/40 hover:text-foreground",
        "data-[state=active]:border-foreground data-[state=active]:bg-card data-[state=active]:shadow-[4px_4px_0_0_var(--accent)]",
        "dark:text-foreground dark:data-[state=active]:border-foreground dark:data-[state=active]:bg-card",
      )}
    >
      <span className="flex w-full items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-[6px] [&_svg]:size-5",
            iconClass,
          )}
          aria-hidden
        >
          <Icon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground group-data-[state=active]:text-foreground">
              {label}
            </span>
            {badge}
          </span>
          <span
            className="mt-1 block text-3xl font-black leading-none"
            style={{ fontFamily: "var(--font-hero)" }}
          >
            {value_}
          </span>
          {sub && (
            <span className="mt-1.5 block truncate text-xs text-muted-foreground">
              {sub}
            </span>
          )}
        </span>
      </span>
    </TabsTrigger>
  );
}
