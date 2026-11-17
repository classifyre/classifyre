"use client";

import { useMemo } from "react";
import { Gauge, Loader2 } from "lucide-react";
import type * as echarts from "echarts";
import type { DashboardQualityDto } from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { EChartBox } from "@/components/echart-box";
import { useTranslation } from "@/hooks/use-translation";
import { useChartTheme } from "@/hooks/use-chart-theme";
import type { TranslationKey } from "@/i18n";

/**
 * How good the data is: every rule result per day, passing and failing, and
 * the score per quality dimension from each rule's latest result.
 */
export function QualityChartCard({
  quality,
  score,
  days,
  loading,
}: {
  quality: DashboardQualityDto | null;
  score: number | null;
  days: number;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const theme = useChartTheme();
  const perDay = useMemo(() => quality?.perDay ?? [], [quality?.perDay]);
  const dimensions = quality?.dimensions ?? [];
  const results = perDay.reduce((sum, day) => sum + day.passed + day.failed, 0);
  const failed = perDay.reduce((sum, day) => sum + day.failed, 0);
  const dimensionLabel = (dimension: string) => {
    const key = `governance.quality.dimension.${dimension}` as TranslationKey;
    const label = t(key);
    return label === key ? dimension : label;
  };

  const option = useMemo<echarts.EChartsCoreOption>(
    () => ({
      grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: {
        top: 0,
        right: 0,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: theme.mutedForeground, fontSize: 11 },
      },
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
        splitLine: { lineStyle: { color: theme.border, type: "dashed" } },
      },
      series: [
        {
          name: t("assets.governance.quality.passed"),
          type: "bar",
          stack: "results",
          color: theme.positive,
          data: perDay.map((row) => row.passed),
        },
        {
          name: t("assets.governance.quality.failed"),
          type: "bar",
          stack: "results",
          color: theme.negative,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
          data: perDay.map((row) => row.failed),
        },
      ],
    }),
    [perDay, theme, t],
  );

  return (
    <Card className="panel-card rounded-[6px]" data-testid="quality-card">
      <CardHeader className="flex flex-col gap-2 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-sm uppercase tracking-[0.08em]">
            {t("assets.governance.quality.title")}
          </CardTitle>
          <CardDescription>
            {t("assets.governance.quality.lead", { days })}
          </CardDescription>
        </div>
        {score !== null && (
          <span
            className={cn(
              "text-2xl font-black",
              score < 80 ? "text-destructive" : "text-accent-ink",
            )}
            style={{ fontFamily: "var(--font-hero)" }}
          >
            {score}
            <span className="text-base text-muted-foreground">%</span>
          </span>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-[200px] items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : dimensions.length === 0 && results === 0 ? (
          <div className="flex h-[160px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Gauge className="size-6" aria-hidden />
            {t("assets.governance.quality.none")}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                {t("assets.governance.quality.results", {
                  results: results.toLocaleString(),
                  failed: failed.toLocaleString(),
                })}
              </p>
              <EChartBox option={option} className="h-[180px]" />
            </div>
            <div className="space-y-2.5">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {t("assets.governance.quality.dimensions")}
              </p>
              {dimensions.map((dimension) => (
                <div key={dimension.dimension} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate capitalize">
                      {dimensionLabel(dimension.dimension)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {dimension.score === null ? "—" : `${dimension.score}%`}
                      <span className="ml-1 text-[10px]">
                        ({dimension.rules})
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        dimension.score === null
                          ? "bg-muted-foreground/30"
                          : dimension.score < 80
                            ? "bg-destructive"
                            : "bg-accent-ink",
                      )}
                      style={{ width: `${dimension.score ?? 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
