"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import type * as echarts from "echarts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { nsPath } from "@/lib/ns-path";
import { EChartBox } from "@/components/echart-box";
import { useTranslation } from "@/hooks/use-translation";
import { useChartTheme } from "@/hooks/use-chart-theme";
import { useGovernanceUsage, type DashboardFilters } from "@/lib/governance";
import { clickedIndex } from "./chart-click";

type Sort = "used" | "rising";

/** `+240%`, or `fresh` (translated "new") when nothing came before. */
export function growthLabel(
  current: number,
  previous: number,
  fresh = "new",
): string {
  if (previous === 0) return current > 0 ? fresh : "0%";
  const change = Math.round(((current - previous) / previous) * 100);
  return `${change > 0 ? "+" : ""}${change}%`;
}

/**
 * Who reads the data, over the period: reads and exports per day, and the
 * assets read most — or, *Rising*, those whose use grew most against the
 * period before (where usage spiked: plan for it, or govern it).
 */
export function UsageChartCard({ filters }: { filters: DashboardFilters }) {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useChartTheme();
  const [sort, setSort] = useState<Sort>("used");
  const usage = useGovernanceUsage({ ...filters, sort });
  const data = usage.data;

  const total = (data?.reads ?? 0) + (data?.exports ?? 0);
  const previous = data?.previous ?? 0;
  const change = growthLabel(
    total,
    previous,
    t("assets.governance.usage.fresh"),
  );
  const up = total >= previous;

  const dailyOption = useMemo<echarts.EChartsCoreOption>(() => {
    const rows = data?.perDay ?? [];
    return {
      grid: { left: 8, right: 8, top: 12, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis" },
      legend: { show: false },
      xAxis: {
        type: "category",
        data: rows.map((row) => row.day.slice(5)),
        axisLabel: { color: theme.mutedForeground, fontSize: 10 },
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: theme.mutedForeground, fontSize: 10 },
        splitLine: { lineStyle: { color: theme.border, type: "dashed" } },
      },
      series: [
        {
          name: t("governance.usage.reads"),
          type: "line",
          smooth: true,
          showSymbol: false,
          stack: "use",
          areaStyle: { opacity: 0.25 },
          lineStyle: { width: 2 },
          color: theme.foreground,
          data: rows.map((row) => row.reads),
        },
        {
          name: t("governance.usage.exports"),
          type: "line",
          smooth: true,
          showSymbol: false,
          stack: "use",
          areaStyle: { opacity: 0.35 },
          lineStyle: { width: 2 },
          color: theme.info,
          data: rows.map((row) => row.exports),
        },
      ],
    };
  }, [data?.perDay, theme, t]);

  const top = useMemo(() => data?.top ?? [], [data?.top]);
  const topOption = useMemo<echarts.EChartsCoreOption>(() => {
    return {
      grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
      },
      xAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: theme.mutedForeground, fontSize: 10 },
        splitLine: { lineStyle: { color: theme.border } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        triggerEvent: true,
        data: top.map((row) => row.name),
        axisLabel: {
          width: 180,
          overflow: "truncate",
          fontSize: 11,
          color: theme.mutedForeground,
        },
      },
      series: [
        {
          name: t("governance.usage.reads"),
          type: "bar",
          stack: "use",
          cursor: "pointer",
          color: theme.foreground,
          data: top.map((row) => row.reads),
        },
        {
          name: t("governance.usage.exports"),
          type: "bar",
          stack: "use",
          cursor: "pointer",
          color: theme.info,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          data: top.map((row) => row.exports),
          label: {
            show: true,
            position: "right",
            fontSize: 10,
            color: theme.mutedForeground,
            formatter: (params: { dataIndex: number }) => {
              const row = top[params.dataIndex];
              if (!row) return "";
              const current = row.reads + row.exports;
              return sort === "rising"
                ? growthLabel(
                    current,
                    row.previous,
                    t("assets.governance.usage.fresh"),
                  )
                : `${current} · ${t("assets.governance.usage.readersShort", { count: row.readers })}`;
            },
          },
        },
      ],
    };
  }, [top, theme, sort, t]);

  return (
    <Card className="panel-card rounded-[6px]" data-testid="usage-card">
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-sm uppercase tracking-[0.08em]">
            {t("assets.governance.usage.title")}
          </CardTitle>
          <CardDescription>
            {t("assets.governance.usage.lead", { days: filters.days })}
          </CardDescription>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={sort}
          onValueChange={(value) => value && setSort(value as Sort)}
          data-testid="usage-sort"
        >
          <ToggleGroupItem value="used" className="px-3">
            {t("assets.governance.usage.used")}
          </ToggleGroupItem>
          <ToggleGroupItem value="rising" className="px-3">
            <TrendingUp className="size-3.5" aria-hidden />
            {t("assets.governance.usage.rising")}
          </ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>
      <CardContent className="space-y-4">
        {usage.loading && !data ? (
          <div className="flex h-[280px] items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : total === 0 && previous === 0 ? (
          <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Activity className="size-6" aria-hidden />
            {t("assets.governance.usage.none", { days: filters.days })}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span
                className="text-2xl font-black"
                style={{ fontFamily: "var(--font-hero)" }}
              >
                {total.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("assets.governance.usage.totals", {
                  reads: (data?.reads ?? 0).toLocaleString(),
                  exports: (data?.exports ?? 0).toLocaleString(),
                })}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-semibold",
                  up ? "text-accent-ink" : "text-destructive",
                )}
                data-testid="usage-change"
              >
                {up ? (
                  <TrendingUp className="size-3.5" aria-hidden />
                ) : (
                  <TrendingDown className="size-3.5" aria-hidden />
                )}
                {t("assets.governance.usage.change", {
                  change,
                  days: filters.days,
                })}
              </span>
            </div>
            <EChartBox option={dailyOption} className="h-[120px]" />
            <div>
              <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {sort === "rising"
                  ? t("assets.governance.usage.topRising")
                  : t("assets.governance.usage.topUsed")}
              </p>
              {top.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("assets.governance.usage.noneRising")}
                </p>
              ) : (
                <EChartBox
                  option={topOption}
                  className="w-full"
                  style={{ height: Math.max(140, top.length * 30 + 24) }}
                  onChartClick={(event) => {
                    const index = clickedIndex(
                      event,
                      top.map((row) => row.name),
                    );
                    const target = top[index];
                    if (target)
                      router.push(nsPath(`/assets/${target.assetId}`));
                  }}
                />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
