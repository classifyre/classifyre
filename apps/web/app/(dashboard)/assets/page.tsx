"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Loader2 } from "lucide-react";
import * as echarts from "echarts";
import {
  api,
  AssetListItemDtoStatusEnum,
  SearchAssetsFiltersDtoStatusEnum,
  type SearchAssetsChartsResponseDto,
} from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@workspace/ui/components";
import { AssetsTable } from "@/components/assets-table";
import { EChartBox } from "@/components/echart-box";
import { useTranslation } from "@/hooks/use-translation";

type AssetStatusFilter =
  (typeof SearchAssetsFiltersDtoStatusEnum)[keyof typeof SearchAssetsFiltersDtoStatusEnum];
type StatusPanelKey = "TOTAL" | AssetStatusFilter;

const EMPTY_OVERVIEW: SearchAssetsChartsResponseDto = {
  totals: {
    totalAssets: 0,
    newAssets: 0,
    updatedAssets: 0,
    unchangedAssets: 0,
  },
  topAssetsByFindings: [],
  topSourcesByAssetVolume: [],
};

function getSeverityChartColor(score: number): string {
  if (score >= 5) return "#FD665F";
  if (score >= 4) return "#FD665F";
  if (score >= 3) return "#FFCE34";
  return "#65B581";
}

export default function AssetsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [selectedStatuses, setSelectedStatuses] = useState<AssetStatusFilter[]>(
    [],
  );
  const [baseOverview, setBaseOverview] =
    useState<SearchAssetsChartsResponseDto>(EMPTY_OVERVIEW);
  const [chartOverview, setChartOverview] =
    useState<SearchAssetsChartsResponseDto>(EMPTY_OVERVIEW);
  const [isBaseLoading, setIsBaseLoading] = useState(true);
  const [isChartsLoading, setIsChartsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        setIsBaseLoading(true);
        setError(null);

        const response = await api.searchAssetsCharts({
          options: {
            topAssetsLimit: 15,
            topSourcesLimit: 10,
          },
        });

        if (!active) return;
        const overview = response ?? EMPTY_OVERVIEW;
        setBaseOverview(overview);
        setChartOverview(overview);
      } catch (loadError) {
        if (!active) return;
        console.error("Failed to load assets chart overview:", loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load assets chart overview",
        );
        setBaseOverview(EMPTY_OVERVIEW);
        setChartOverview(EMPTY_OVERVIEW);
      } finally {
        if (active) {
          setIsBaseLoading(false);
        }
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedStatuses.length === 0) {
      setChartOverview(baseOverview);
      setIsChartsLoading(false);
      return;
    }

    let active = true;

    const run = async () => {
      try {
        setIsChartsLoading(true);
        setError(null);

        const response = await api.searchAssetsCharts({
          assets: { status: selectedStatuses },
          options: { topAssetsLimit: 15, topSourcesLimit: 10 },
        });

        if (!active) return;
        setChartOverview(response ?? EMPTY_OVERVIEW);
      } catch (loadError) {
        if (!active) return;
        console.error(
          "Failed to load filtered assets chart overview:",
          loadError,
        );
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load filtered assets chart overview",
        );
        setChartOverview(EMPTY_OVERVIEW);
      } finally {
        if (active) setIsChartsLoading(false);
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, [selectedStatuses, baseOverview]);

  const panels = useMemo(
    () => [
      {
        key: "TOTAL" as const,
        label: t("assets.totalAssets"),
        value: baseOverview.totals.totalAssets,
      },
      {
        key: AssetListItemDtoStatusEnum.New as StatusPanelKey,
        label: t("assets.newAssets"),
        value: baseOverview.totals.newAssets,
      },
      {
        key: AssetListItemDtoStatusEnum.Updated as StatusPanelKey,
        label: t("assets.updatedAssets"),
        value: baseOverview.totals.updatedAssets,
      },
      {
        key: AssetListItemDtoStatusEnum.Unchanged as StatusPanelKey,
        label: t("assets.unchangedAssets"),
        value: baseOverview.totals.unchangedAssets,
      },
    ],
    [baseOverview],
  );

  const topAssetsOption = useMemo<echarts.EChartsCoreOption>(() => {
    const source = [
      ["score", "amount", "asset", "severity"],
      ...chartOverview.topAssetsByFindings.map((asset) => [
        asset.severityScore,
        asset.findingsCount,
        asset.assetName,
        asset.highestSeverity,
      ]),
    ];

    return {
      dataset: {
        source,
      },
      grid: {
        containLabel: true,
        left: 8,
        right: 16,
        top: 24,
        bottom: 16,
      },
      xAxis: {
        type: "value",
        name: "Findings",
        splitLine: {
          lineStyle: {
            color: "#e5e7eb",
          },
        },
      },
      yAxis: {
        type: "category",
        inverse: true,
        triggerEvent: true,
        axisLabel: {
          width: 220,
          overflow: "truncate",
          fontSize: 11,
          cursor: "pointer",
        },
      },
      tooltip: {
        trigger: "item",
      },
      series: [
        {
          type: "bar",
          encode: {
            x: "amount",
            y: "asset",
          },
          itemStyle: {
            borderRadius: [0, 4, 4, 0],
            color: (params: unknown) => {
              const row =
                typeof params === "object" &&
                params !== null &&
                "data" in params
                  ? (params as { data?: unknown }).data
                  : undefined;
              const score = Array.isArray(row) ? Number(row[0] ?? 1) : 1;
              return getSeverityChartColor(score);
            },
          },
          cursor: "pointer",
          label: {
            show: true,
            position: "right",
            fontSize: 10,
          },
        },
      ],
    };
  }, [chartOverview.topAssetsByFindings]);

  const sourceOption = useMemo<echarts.EChartsCoreOption>(() => {
    const sourceRows = chartOverview.topSourcesByAssetVolume;

    return {
      color: ["#111827"],
      grid: {
        left: 8,
        right: 12,
        top: 24,
        bottom: 16,
        containLabel: true,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
      },
      xAxis: {
        type: "value",
        name: "Assets",
        splitLine: {
          lineStyle: {
            color: "#e5e7eb",
          },
        },
      },
      yAxis: {
        type: "category",
        inverse: true,
        triggerEvent: true,
        data: sourceRows.map((row) => row.sourceName),
        axisLabel: {
          width: 220,
          overflow: "truncate",
          fontSize: 11,
          cursor: "pointer",
        },
      },
      series: [
        {
          type: "bar",
          data: sourceRows.map((row) => row.assetCount),
          itemStyle: {
            borderRadius: [0, 4, 4, 0],
          },
          cursor: "pointer",
          label: {
            show: true,
            position: "right",
            fontSize: 10,
          },
        },
      ],
    };
  }, [chartOverview.topSourcesByAssetVolume]);

  const hasChartData =
    chartOverview.topAssetsByFindings.length > 0 ||
    chartOverview.topSourcesByAssetVolume.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("assets.title")}
        </h1>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {isBaseLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="ml-2 text-sm">
            {t("assets.loadingVisualizations")}
          </span>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {panels.map((panel) => {
              const isActive =
                panel.key === "TOTAL"
                  ? selectedStatuses.length === 0
                  : selectedStatuses.includes(panel.key as AssetStatusFilter);
              return (
                <button
                  key={panel.key}
                  type="button"
                  className="group text-left cursor-pointer transition-transform hover:-translate-y-px focus-visible:outline-none"
                  onClick={() => {
                    if (panel.key === "TOTAL") {
                      setSelectedStatuses([]);
                    } else {
                      setSelectedStatuses([panel.key as AssetStatusFilter]);
                    }
                  }}
                >
                  <Card
                    className={
                      isActive
                        ? "overflow-hidden border-2 border-[#b7ff00]/30 bg-[#0b0f0a] text-[#b7ff00] rounded-[6px]"
                        : "border-2 border-border rounded-[6px] transition-all group-hover:bg-secondary/40"
                    }
                  >
                    <CardContent className="p-4">
                      <p
                        className={
                          isActive
                            ? "text-[11px] font-mono uppercase tracking-[0.16em] text-[#b7ff00]/80"
                            : "text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground"
                        }
                      >
                        {panel.label}
                      </p>
                      <p
                        className="mt-1 text-3xl font-black"
                        style={{ fontFamily: "var(--font-hero)" }}
                      >
                        {panel.value.toLocaleString()}
                      </p>
                    </CardContent>
                  </Card>
                </button>
              );
            })}
          </div>

          <div className="relative">
            {hasChartData ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <Card className="panel-card rounded-[6px]">
                  <CardHeader>
                    <CardTitle className="text-sm uppercase tracking-[0.08em]">
                      Top assets by findings
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <EChartBox
                      option={topAssetsOption}
                      className="h-[360px]"
                      onChartClick={(event) => {
                        const directIndex =
                          typeof event === "object" &&
                          event !== null &&
                          "dataIndex" in event &&
                          typeof (event as { dataIndex?: unknown })
                            .dataIndex === "number"
                            ? (event as { dataIndex: number }).dataIndex
                            : -1;
                        const axisValue =
                          typeof event === "object" &&
                          event !== null &&
                          "componentType" in event &&
                          (event as { componentType?: unknown })
                            .componentType === "yAxis" &&
                          "value" in event &&
                          typeof (event as { value?: unknown }).value ===
                            "string"
                            ? (event as { value: string }).value
                            : null;
                        const axisIndex =
                          axisValue === null
                            ? -1
                            : chartOverview.topAssetsByFindings.findIndex(
                                (item) => item.assetName === axisValue,
                              );
                        const target =
                          chartOverview.topAssetsByFindings[
                            directIndex >= 0 ? directIndex : axisIndex
                          ];
                        if (target?.assetId) {
                          router.push(`/assets/${target.assetId}`);
                        }
                      }}
                    />
                  </CardContent>
                </Card>
                <Card className="panel-card rounded-[6px]">
                  <CardHeader>
                    <CardTitle className="text-sm uppercase tracking-[0.08em]">
                      Top sources by asset volume
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <EChartBox
                      option={sourceOption}
                      className="h-[360px]"
                      onChartClick={(event) => {
                        const directIndex =
                          typeof event === "object" &&
                          event !== null &&
                          "dataIndex" in event &&
                          typeof (event as { dataIndex?: unknown })
                            .dataIndex === "number"
                            ? (event as { dataIndex: number }).dataIndex
                            : -1;
                        const axisValue =
                          typeof event === "object" &&
                          event !== null &&
                          "componentType" in event &&
                          (event as { componentType?: unknown })
                            .componentType === "yAxis" &&
                          "value" in event &&
                          typeof (event as { value?: unknown }).value ===
                            "string"
                            ? (event as { value: string }).value
                            : null;
                        const axisIndex =
                          axisValue === null
                            ? -1
                            : chartOverview.topSourcesByAssetVolume.findIndex(
                                (item) => item.sourceName === axisValue,
                              );
                        const target =
                          chartOverview.topSourcesByAssetVolume[
                            directIndex >= 0 ? directIndex : axisIndex
                          ];
                        if (target?.sourceId) {
                          router.push(`/sources/${target.sourceId}`);
                        }
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

            {isChartsLoading && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[6px] bg-background/55 backdrop-blur-[1px]">
                <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("assets.loading")}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <Suspense>
        <AssetsTable
          assetStatuses={selectedStatuses}
          onAssetStatusesChange={setSelectedStatuses}
        />
      </Suspense>
    </div>
  );
}
