"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Activity, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import type * as echarts from "echarts";
import type { GovernanceUsageDto } from "@workspace/api-client";
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { nsPath } from "@/lib/ns-path";
import { EChartBox } from "@/components/echart-box";
import {
  PanelCard,
  microLabelClass,
  panelHeadingClass,
} from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import { useChartTheme } from "@/hooks/use-chart-theme";
import { clickedIndex } from "@/lib/chart-click";

export type UsageSort = "used" | "rising";

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
 *
 * Reads are the accent (an ink line over an acid wash, acid bars with an ink
 * edge); exports, the rarer and heavier act, are the foreground.
 *
 * `part` splits it in two for a side-by-side row (the assets page's tabs):
 * `trend` is the totals and reads per day, `top` the assets read most.
 */
export function UsageChartCard({
  usage,
  loading,
  days,
  sort,
  onSortChange,
  part = "all",
  className,
}: {
  usage: GovernanceUsageDto | null;
  loading: boolean;
  days: number;
  sort: UsageSort;
  onSortChange: (sort: UsageSort) => void;
  part?: "all" | "trend" | "top";
  className?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useChartTheme();
  const data = usage;

  const total = (data?.reads ?? 0) + (data?.exports ?? 0);
  const previous = data?.previous ?? 0;
  const change = growthLabel(total, previous, t("dashboard.usage.fresh"));
  const up = total >= previous;

  const dailyOption = useMemo<echarts.EChartsCoreOption>(() => {
    const rows = data?.perDay ?? [];
    return {
      grid: { left: 8, right: 8, top: 12, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis" },
      legend: { show: false },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: rows.map((row) => row.day.slice(5)),
        axisLabel: { color: theme.mutedForeground, fontSize: 10 },
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: theme.mutedForeground, fontSize: 10 },
        splitLine: {
          lineStyle: { color: theme.border, type: "dashed", opacity: 0.25 },
        },
      },
      series: [
        {
          name: t("governance.usage.reads"),
          type: "line",
          smooth: 0.3,
          showSymbol: false,
          color: theme.positive,
          lineStyle: { width: 2.5, color: theme.positive },
          areaStyle: { color: theme.accent, opacity: theme.dark ? 0.18 : 0.55 },
          data: rows.map((row) => row.reads),
        },
        {
          name: t("governance.usage.exports"),
          type: "line",
          smooth: 0.3,
          showSymbol: false,
          color: theme.foreground,
          lineStyle: { width: 1.5, type: "dashed", color: theme.foreground },
          data: rows.map((row) => row.exports),
        },
      ],
    };
  }, [data?.perDay, theme, t]);

  const top = useMemo(() => data?.top ?? [], [data?.top]);
  const topOption = useMemo<echarts.EChartsCoreOption>(() => {
    return {
      grid: { left: 8, right: 104, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
      },
      xAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: theme.mutedForeground, fontSize: 10 },
        splitLine: { lineStyle: { color: theme.border, opacity: 0.2 } },
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
        axisLine: { lineStyle: { color: theme.border } },
        axisTick: { show: false },
      },
      series: [
        {
          name: t("governance.usage.reads"),
          type: "bar",
          stack: "use",
          cursor: "pointer",
          barMaxWidth: 18,
          color: theme.accent,
          itemStyle: { borderColor: theme.foreground, borderWidth: 1.5 },
          data: top.map((row) => row.reads),
        },
        {
          name: t("governance.usage.exports"),
          type: "bar",
          stack: "use",
          cursor: "pointer",
          barMaxWidth: 18,
          color: theme.foreground,
          itemStyle: {
            borderColor: theme.foreground,
            borderWidth: 1.5,
            borderRadius: [0, 3, 3, 0],
          },
          data: top.map((row) => row.exports),
          label: {
            show: true,
            position: "right",
            fontSize: 10,
            fontFamily: "monospace",
            color: theme.mutedForeground,
            formatter: (params: { dataIndex: number }) => {
              const row = top[params.dataIndex];
              if (!row) return "";
              const current = row.reads + row.exports;
              return sort === "rising"
                ? growthLabel(current, row.previous, t("dashboard.usage.fresh"))
                : `${current} · ${t("dashboard.usage.readersShort", { count: row.readers })}`;
            },
          },
        },
      ],
    };
  }, [top, theme, sort, t]);

  // Alone in its card (`part="top"`), the ranking fills the card.
  const topChart = (
    <EChartBox
      option={topOption}
      className={
        part === "top" ? "h-full min-h-[320px] w-full flex-1" : "w-full"
      }
      style={
        part === "top"
          ? undefined
          : { height: Math.max(140, top.length * 30 + 24) }
      }
      onChartClick={(event) => {
        const index = clickedIndex(
          event,
          top.map((row) => row.name),
        );
        const target = top[index];
        if (target) router.push(nsPath(`/assets/${target.assetId}`));
      }}
    />
  );

  return (
    <PanelCard className={cn("flex flex-col", className)}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className={panelHeadingClass}>
            {part !== "top"
              ? t("dashboard.usage.title")
              : sort === "rising"
                ? t("dashboard.usage.topRising")
                : t("dashboard.usage.topUsed")}
          </h3>
          <p className={microLabelClass}>
            {t("dashboard.usage.lead", { days })}
          </p>
        </div>
        {part !== "trend" && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={sort}
            onValueChange={(value) => value && onSortChange(value as UsageSort)}
            data-testid="usage-sort"
          >
            <ToggleGroupItem value="used" className="px-3">
              {t("dashboard.usage.used")}
            </ToggleGroupItem>
            <ToggleGroupItem value="rising" className="px-3">
              <TrendingUp className="size-3.5" aria-hidden />
              {t("dashboard.usage.rising")}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>

      {loading && !data ? (
        <div className="flex h-[280px] items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : part === "top" ? (
        top.length === 0 ? (
          <div className="flex h-[200px] flex-col items-center justify-center gap-2 rounded-[4px] border-2 border-dashed border-border/40 text-center text-sm text-muted-foreground">
            <Activity className="size-6" aria-hidden />
            {sort === "rising"
              ? t("dashboard.usage.noneRising")
              : t("dashboard.usage.none", { days })}
          </div>
        ) : (
          topChart
        )
      ) : total === 0 && previous === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center gap-2 rounded-[4px] border-2 border-dashed border-border/40 text-center text-sm text-muted-foreground">
          <Activity className="size-6" aria-hidden />
          {t("dashboard.usage.none", { days })}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span
              className="text-3xl font-bold leading-none"
              style={{ fontFamily: "var(--font-hero)" }}
            >
              {total.toLocaleString()}
            </span>
            <span className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 rounded-[2px] border border-foreground bg-accent"
                />
                {t("dashboard.usage.readsCount", {
                  count: (data?.reads ?? 0).toLocaleString(),
                })}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-0 w-3 border-t-2 border-dashed border-foreground"
                />
                {t("dashboard.usage.exportsCount", {
                  count: (data?.exports ?? 0).toLocaleString(),
                })}
              </span>
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]",
                up ? "text-accent-ink" : "text-destructive",
              )}
              data-testid="usage-change"
            >
              {up ? (
                <TrendingUp className="size-3.5" aria-hidden />
              ) : (
                <TrendingDown className="size-3.5" aria-hidden />
              )}
              {t("dashboard.usage.change", { change, days })}
            </span>
          </div>
          <EChartBox
            option={dailyOption}
            className={part === "trend" ? "h-[300px]" : "h-[140px]"}
          />
          {part === "all" && (
            <div>
              <p className={cn(microLabelClass, "mb-1")}>
                {sort === "rising"
                  ? t("dashboard.usage.topRising")
                  : t("dashboard.usage.topUsed")}
              </p>
              {top.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("dashboard.usage.noneRising")}
                </p>
              ) : (
                topChart
              )}
            </div>
          )}
        </div>
      )}
    </PanelCard>
  );
}
