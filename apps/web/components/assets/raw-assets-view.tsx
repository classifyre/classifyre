"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Loader2 } from "lucide-react";
import type * as echarts from "echarts";
import { api, type SearchAssetsChartsResponseDto } from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@workspace/ui/components";
import { nsPath } from "@/lib/ns-path";
import { AssetsTable } from "@/components/assets-table";
import { EChartBox } from "@/components/echart-box";
import { useTranslation } from "@/hooks/use-translation";
import { useChartTheme } from "@/hooks/use-chart-theme";
import { clickedIndex } from "@/lib/chart-click";

const EMPTY: SearchAssetsChartsResponseDto = {
  totals: {
    totalAssets: 0,
    newAssets: 0,
    updatedAssets: 0,
    unchangedAssets: 0,
  },
  topAssetsByFindings: [],
  topSourcesByAssetVolume: [],
};

function severityColor(score: number): string {
  if (score >= 4) return "#FD665F";
  if (score >= 3) return "#FFCE34";
  return "#65B581";
}

/**
 * The Raw assets tab: everything scanned from sources (shared datasets have
 * their own tab), ranked by findings and by source, and the full table.
 */
export function RawAssetsView({ statsToken }: { statsToken: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useChartTheme();
  const [overview, setOverview] =
    useState<SearchAssetsChartsResponseDto>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .searchAssetsCharts({
        assets: { kind: "raw" },
        options: { topAssetsLimit: 15, topSourcesLimit: 10 },
      })
      .then((response) => {
        if (!active) return;
        setOverview(response ?? EMPTY);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load assets chart overview",
        );
        setOverview(EMPTY);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [statsToken]);

  const axis = useMemo(
    () => ({
      nameTextStyle: { color: theme.mutedForeground },
      axisLabel: { color: theme.mutedForeground, fontSize: 10 },
      splitLine: { lineStyle: { color: theme.border } },
    }),
    [theme],
  );
  const categoryAxis = useMemo(
    () => ({
      type: "category" as const,
      inverse: true,
      triggerEvent: true,
      axisLabel: {
        width: 220,
        overflow: "truncate" as const,
        fontSize: 11,
        color: theme.mutedForeground,
      },
    }),
    [theme],
  );

  const topAssetsOption = useMemo<echarts.EChartsCoreOption>(() => {
    const rows = overview.topAssetsByFindings;
    return {
      grid: { containLabel: true, left: 8, right: 16, top: 24, bottom: 16 },
      xAxis: { type: "value", name: t("findings.title"), ...axis },
      yAxis: { ...categoryAxis, data: rows.map((row) => row.assetName) },
      tooltip: { trigger: "item" },
      series: [
        {
          type: "bar",
          cursor: "pointer",
          data: rows.map((row) => ({
            value: row.findingsCount,
            itemStyle: { color: severityColor(row.severityScore) },
          })),
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: "right",
            fontSize: 10,
            color: theme.mutedForeground,
          },
        },
      ],
    };
  }, [overview.topAssetsByFindings, axis, categoryAxis, theme, t]);

  const sourcesOption = useMemo<echarts.EChartsCoreOption>(() => {
    const rows = overview.topSourcesByAssetVolume;
    return {
      color: [theme.foreground],
      grid: { containLabel: true, left: 8, right: 12, top: 24, bottom: 16 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      xAxis: { type: "value", name: t("assets.title"), ...axis },
      yAxis: { ...categoryAxis, data: rows.map((row) => row.sourceName) },
      series: [
        {
          type: "bar",
          cursor: "pointer",
          data: rows.map((row) => row.assetCount),
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: "right",
            fontSize: 10,
            color: theme.mutedForeground,
          },
        },
      ],
    };
  }, [overview.topSourcesByAssetVolume, axis, categoryAxis, theme, t]);

  const hasChartData =
    overview.topAssetsByFindings.length > 0 ||
    overview.topSourcesByAssetVolume.length > 0;

  return (
    <div className="space-y-6" data-testid="raw-assets-view">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="ml-2 text-sm">
            {t("assets.loadingVisualizations")}
          </span>
        </div>
      ) : hasChartData ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="panel-card rounded-[6px]">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-[0.08em]">
                {t("assets.charts.topAssets")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <EChartBox
                option={topAssetsOption}
                className="h-[360px]"
                onChartClick={(event) => {
                  const rows = overview.topAssetsByFindings;
                  const index = clickedIndex(
                    event,
                    rows.map((row) => row.assetName),
                  );
                  const target = rows[index];
                  if (target?.assetId)
                    router.push(nsPath(`/assets/${target.assetId}`));
                }}
              />
            </CardContent>
          </Card>
          <Card className="panel-card rounded-[6px]">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-[0.08em]">
                {t("assets.charts.topSources")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <EChartBox
                option={sourcesOption}
                className="h-[360px]"
                onChartClick={(event) => {
                  const rows = overview.topSourcesByAssetVolume;
                  const index = clickedIndex(
                    event,
                    rows.map((row) => row.sourceName),
                  );
                  const target = rows[index];
                  if (target?.sourceId)
                    router.push(nsPath(`/sources/${target.sourceId}`));
                }}
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        <EmptyState
          icon={Activity}
          title={t("assets.noVisualization")}
          description={t("assets.noVisualizationHint")}
        />
      )}

      <Suspense>
        <AssetsTable kind="raw" preset="all" />
      </Suspense>
    </div>
  );
}
