"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutDashboard, Loader2 } from "lucide-react";
import { api, type SourceListItem } from "@workspace/api-client";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { useUrlParams } from "@/lib/url-filters";
import {
  useAssetsOverview,
  useGovernanceDashboard,
  useGovernanceUsage,
  type DashboardScope,
} from "@/lib/governance";
import { GovernanceBriefCard } from "@/components/dashboard/governance-brief-card";
import { QualityBriefCard } from "@/components/dashboard/quality-brief-card";
import { IncomingCard } from "@/components/dashboard/incoming-card";
import {
  UsageChartCard,
  type UsageSort,
} from "@/components/dashboard/usage-chart-card";
import { QualityTrendCard } from "@/components/dashboard/quality-trend-card";
import { WaitingOnYouCard } from "@/components/dashboard/waiting-on-you-card";
import { assetsHref, type AssetsLink } from "@/lib/dashboard-links";
import { useNsPath } from "@/lib/ns-path";
import { useMe } from "@/hooks/use-me";
import { NamespaceRedirect } from "@/components/namespace-redirect";

const PERIODS = [7, 30, 90] as const;
const ALL_SOURCES = "ALL";

function periodOf(value: string | null): number {
  const days = Number(value);
  return (PERIODS as readonly number[]).includes(days) ? days : 30;
}

/**
 * Where someone starts work (docs/prd/GOV-governed-data-assets.md §5.7): how
 * much of their data is governed, how good it is, who asks for it and reads
 * it, and what waits on them — for the assets they answer for, or all of
 * them. Every number opens the assets behind it on the assets page.
 */
/**
 * The dashboard is about assets: someone who sees none (a Data consumer given
 * one shared dataset) goes to the SQL page instead of a page of refusals.
 */
export default function DashboardPage() {
  const me = useMe();
  if (me && !(me.capabilities as string[]).includes("asset.view")) {
    return <NamespaceRedirect to="/query" />;
  }
  return <DashboardContent />;
}

function DashboardContent() {
  const { t } = useTranslation();
  const { searchParams, setParams } = useUrlParams();
  const [scope, setScope] = useState<DashboardScope>(() =>
    searchParams.get("scope") === "all" ? "all" : "mine",
  );
  const [days, setDays] = useState(() => periodOf(searchParams.get("days")));
  const [sourceId, setSourceId] = useState<string | null>(() =>
    searchParams.get("source"),
  );
  const [usageSort, setUsageSort] = useState<UsageSort>("used");
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);

  const synced = useRef(false);
  useEffect(() => {
    if (!synced.current) {
      synced.current = true;
      return;
    }
    setParams({
      scope: scope === "mine" ? null : scope,
      days: days === 30 ? null : String(days),
      source: sourceId,
    });
  }, [scope, days, sourceId, setParams]);

  useEffect(() => {
    let active = true;
    api.sources
      .sourcesControllerListSources()
      .then((list) => {
        if (!active) return;
        setSources(
          ((list ?? []) as unknown as SourceListItem[])
            .filter((source): source is SourceListItem & { id: string } =>
              Boolean(source.id),
            )
            .map((source) => ({
              id: source.id,
              name: source.name || source.id,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => setSources([]));
    return () => {
      active = false;
    };
  }, []);

  const dashboard = useGovernanceDashboard({ scope, days, sourceId });
  const usage = useGovernanceUsage({ scope, days, sourceId, sort: usageSort });
  const overview = useAssetsOverview();
  const data = dashboard.data;
  // Mine falls back to all for someone who answers for nothing.
  const effectiveScope: DashboardScope = data?.scope ?? scope;
  const nsPath = useNsPath();
  // Every card's links carry the scope and source shown.
  const link: AssetsLink = (drill) =>
    nsPath(assetsHref(drill, effectiveScope, sourceId));

  const showRequests = () =>
    document
      .getElementById("waiting-on-you")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (dashboard.loading && !data) {
    return (
      <div
        className="flex h-96 items-center justify-center"
        data-testid="namespace-workspace"
        data-app-state="loading"
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (dashboard.error && !data) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-4"
        data-testid="namespace-workspace"
        data-app-state="error"
      >
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
            {t("dashboard.title")}
          </h1>
          <p className="text-destructive">{t("dashboard.loadError")}</p>
        </div>
        <Button onClick={() => void dashboard.reload()}>
          {t("dashboard.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="min-w-0 space-y-6 overflow-x-hidden"
      data-testid="namespace-workspace"
      data-app-state="ready"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="size-7" aria-hidden />
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
            {t("dashboard.title")}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={effectiveScope}
            onValueChange={(value) =>
              value && setScope(value as DashboardScope)
            }
            aria-label={t("dashboard.scope.label")}
            data-testid="dashboard-scope"
          >
            <ToggleGroupItem value="mine" className="px-3">
              {t("dashboard.scope.mine")}
            </ToggleGroupItem>
            <ToggleGroupItem value="all" className="px-3">
              {t("dashboard.scope.all")}
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(days)}
            onValueChange={(value) => value && setDays(Number(value))}
            aria-label={t("dashboard.period")}
            data-testid="dashboard-period"
          >
            {PERIODS.map((period) => (
              <ToggleGroupItem
                key={period}
                value={String(period)}
                className="px-3"
              >
                {t("dashboard.days", { days: period })}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select
            value={sourceId ?? ALL_SOURCES}
            onValueChange={(value) =>
              setSourceId(value === ALL_SOURCES ? null : value)
            }
          >
            <SelectTrigger
              className="h-8 w-full rounded-[4px] border-2 border-border sm:w-[200px]"
              data-testid="dashboard-source"
            >
              <SelectValue placeholder={t("assets.allSources")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SOURCES}>
                {t("assets.allSources")}
              </SelectItem>
              {sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {scope === "mine" && data?.scope === "all" && (
        <p className="-mt-3 text-xs text-muted-foreground">
          {t("dashboard.scope.nothingYours")}
        </p>
      )}

      <div className="grid min-w-0 auto-rows-[minmax(120px,auto)] grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5 xl:grid-cols-12">
        <GovernanceBriefCard
          totals={data?.totals}
          scope={effectiveScope}
          link={link}
        />
        <QualityBriefCard dashboard={data} link={link} />
        <IncomingCard
          requestsForMe={overview.data?.governance.requestsForMe}
          usage={usage.data}
          days={days}
          onShowRequests={showRequests}
        />

        <UsageChartCard
          usage={usage.data}
          loading={usage.loading}
          days={days}
          sort={usageSort}
          onSortChange={setUsageSort}
          className="sm:col-span-2 xl:col-span-8"
        />
        <WaitingOnYouCard
          dashboard={data}
          scope={effectiveScope}
          link={link}
          requestsForMe={overview.data?.governance.requestsForMe}
          onDecided={() => {
            void dashboard.reload();
            void overview.reload();
          }}
          className="sm:col-span-2 xl:col-span-4 xl:row-span-2"
        />
        <QualityTrendCard
          quality={data?.quality ?? null}
          days={days}
          loading={dashboard.loading && !data}
          className="sm:col-span-2 xl:col-span-8"
        />
      </div>
    </div>
  );
}
