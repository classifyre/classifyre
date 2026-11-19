"use client";

import { useMemo } from "react";
import { Gauge, Loader2 } from "lucide-react";
import type * as echarts from "echarts";
import type { DashboardQualityDto } from "@workspace/api-client";
import { cn } from "@workspace/ui/lib/utils";
import { EChartBox } from "@/components/echart-box";
import {
  PanelCard,
  microLabelClass,
  panelHeadingClass,
} from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import { useChartTheme } from "@/hooks/use-chart-theme";

/**
 * Every quality rule result per day, passing and failing. The score and the
 * per-dimension split live on the quality brief; this is the history behind
 * them.
 */
export function QualityTrendCard({
  quality,
  days,
  loading,
  className,
}: {
  quality: DashboardQualityDto | null;
  days: number;
  loading: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const theme = useChartTheme();
  const perDay = useMemo(() => quality?.perDay ?? [], [quality?.perDay]);
  const results = perDay.reduce((sum, day) => sum + day.passed + day.failed, 0);
  const failed = perDay.reduce((sum, day) => sum + day.failed, 0);

  const option = useMemo<echarts.EChartsCoreOption>(
    () => ({
      grid: { left: 8, right: 8, top: 8, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { show: false },
      xAxis: {
        type: "category",
        data: perDay.map((row) => row.day.slice(5)),
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
          name: t("dashboard.quality.passed"),
          type: "bar",
          stack: "results",
          barMaxWidth: 22,
          color: theme.accent,
          itemStyle: { borderColor: theme.foreground, borderWidth: 1 },
          data: perDay.map((row) => row.passed),
        },
        {
          name: t("dashboard.quality.failed"),
          type: "bar",
          stack: "results",
          barMaxWidth: 22,
          color: theme.negative,
          itemStyle: {
            borderColor: theme.foreground,
            borderWidth: 1,
            borderRadius: [2, 2, 0, 0],
          },
          data: perDay.map((row) => row.failed),
        },
      ],
    }),
    [perDay, theme, t],
  );

  return (
    <PanelCard className={cn("flex flex-col", className)}>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className={panelHeadingClass}>{t("dashboard.quality.title")}</h3>
          <p className={microLabelClass}>
            {t("dashboard.quality.lead", { days })}
          </p>
        </div>
        {results > 0 && (
          <span className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-[2px] border border-foreground bg-accent"
              />
              {t("dashboard.quality.passedCount", {
                count: (results - failed).toLocaleString(),
              })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-[2px] border border-foreground bg-destructive"
              />
              {t("dashboard.quality.failedCount", {
                count: failed.toLocaleString(),
              })}
            </span>
          </span>
        )}
      </div>
      {loading ? (
        <div className="flex h-[180px] items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : results === 0 ? (
        <div className="flex h-[160px] flex-col items-center justify-center gap-2 rounded-[4px] border-2 border-dashed border-border/40 text-center text-sm text-muted-foreground">
          <Gauge className="size-6" aria-hidden />
          {t("dashboard.quality.none", { days })}
        </div>
      ) : (
        <EChartBox option={option} className="h-[180px]" />
      )}
    </PanelCard>
  );
}
