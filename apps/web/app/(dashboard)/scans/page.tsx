"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as echarts from "echarts";
import { Activity, Loader2, Play } from "lucide-react";
import {
  api,
  type SearchRunnersChartsResponseDto,
  type SearchRunnersFiltersInputDto,
  type SearchRunnersStatus,
} from "@workspace/api-client";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { ScanWizard } from "@/components/scan-wizard";
import { EChartBox } from "@/components/echart-box";
import { RunnersTable } from "@/components/runners-table";
import { useTranslation } from "@/hooks/use-translation";

type StatusPanelKey = "TOTAL" | SearchRunnersStatus;

const EMPTY_CHARTS: SearchRunnersChartsResponseDto = {
  totals: {
    totalRuns: 0,
    running: 0,
    queued: 0,
    completed: 0,
    failed: 0,
  },
  timeline: [],
  topSources: [],
};

export default function ScansPage() {
  const router = useRouter();
  const { t } = useTranslation();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [windowDays, setWindowDays] = useState("30");
  const [selectedStatuses, setSelectedStatuses] = useState<
    SearchRunnersStatus[]
  >([]);
  const [tableFilters, setTableFilters] = useState<
    SearchRunnersFiltersInputDto | undefined | null
  >(null);

  const [baseCharts, setBaseCharts] =
    useState<SearchRunnersChartsResponseDto>(EMPTY_CHARTS);
  const [chartData, setChartData] =
    useState<SearchRunnersChartsResponseDto>(EMPTY_CHARTS);
  const [isBaseLoading, setIsBaseLoading] = useState(true);
  const [isChartsLoading, setIsChartsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const windowDaysValue =
    windowDays === "7" ? 7 : windowDays === "90" ? 90 : 30;

  useEffect(() => {
    if (tableFilters === null) {
      return;
    }

    let active = true;

    const run = async () => {
      try {
        setIsBaseLoading(true);
        setError(null);

        const hasStatusFilter =
          Array.isArray(tableFilters?.status) && tableFilters.status.length > 0;
        const filtersWithoutStatus = tableFilters
          ? ({
              ...tableFilters,
              status: undefined,
            } as SearchRunnersFiltersInputDto)
          : undefined;

        const [panelResponse, chartResponse] = await Promise.all([
          api.searchRunnersCharts({
            filters: filtersWithoutStatus,
            windowDays: windowDaysValue,
            options: { topSourcesLimit: 10 },
          }),
          hasStatusFilter
            ? api.searchRunnersCharts({
                filters: tableFilters,
                windowDays: windowDaysValue,
                options: { topSourcesLimit: 10 },
              })
            : Promise.resolve(null),
        ]);

        if (!active) return;
        const panels = panelResponse ?? EMPTY_CHARTS;
        setBaseCharts(panels);
        setChartData(
          hasStatusFilter ? (chartResponse ?? EMPTY_CHARTS) : panels,
        );
      } catch (loadError) {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load scans charts",
        );
        setBaseCharts(EMPTY_CHARTS);
        setChartData(EMPTY_CHARTS);
      } finally {
        if (active) {
          setIsBaseLoading(false);
          setIsChartsLoading(false);
        }
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [tableFilters, windowDaysValue]);

  const panels = useMemo(
    () => [
      {
        key: "TOTAL" as const,
        label: t("scans.totalRuns"),
        value: baseCharts.totals.totalRuns,
      },
      {
        key: "RUNNING" as StatusPanelKey,
        label: t("scans.running"),
        value: baseCharts.totals.running,
      },
      {
        key: "PENDING" as StatusPanelKey,
        label: t("scans.queued"),
        value: baseCharts.totals.queued,
      },
      {
        key: "COMPLETED" as StatusPanelKey,
        label: t("scans.completed"),
        value: baseCharts.totals.completed,
      },
      {
        key: "ERROR" as StatusPanelKey,
        label: t("scans.failed"),
        value: baseCharts.totals.failed,
      },
    ],
    [baseCharts, t],
  );

  const trendOption = useMemo<echarts.EChartsCoreOption>(
    () => ({
      color: ["#f59e0b", "#3b82f6", "#22c55e", "#ef4444"],
      grid: { left: 8, right: 12, top: 24, bottom: 20, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
      },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      xAxis: {
        type: "category",
        data: chartData.timeline.map((row) => row.date),
        axisLabel: { fontSize: 10 },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "#e5e7eb" } },
      },
      series: [
        {
          name: t("scans.queued"),
          type: "bar",
          stack: "runs",
          data: chartData.timeline.map((row) => row.queued),
        },
        {
          name: t("scans.running"),
          type: "bar",
          stack: "runs",
          data: chartData.timeline.map((row) => row.running),
        },
        {
          name: t("scans.completed"),
          type: "bar",
          stack: "runs",
          data: chartData.timeline.map((row) => row.completed),
        },
        {
          name: t("scans.failed"),
          type: "bar",
          stack: "runs",
          data: chartData.timeline.map((row) => row.failed),
        },
      ],
    }),
    [chartData.timeline, t],
  );

  const topSourcesOption = useMemo<echarts.EChartsCoreOption>(
    () => ({
      color: ["#111827", "#ef4444"],
      grid: { left: 8, right: 20, top: 24, bottom: 16, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
      },
      legend: { top: 0, textStyle: { fontSize: 11 } },
      xAxis: {
        type: "value",
        splitLine: { lineStyle: { color: "#e5e7eb" } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        triggerEvent: true,
        data: chartData.topSources.map((row) => row.sourceName),
        axisLabel: {
          width: 220,
          overflow: "truncate",
          fontSize: 11,
          cursor: "pointer",
        },
      },
      series: [
        {
          name: "Runs",
          type: "bar",
          data: chartData.topSources.map((row) => row.runs),
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          cursor: "pointer",
          label: {
            show: true,
            position: "right",
            fontSize: 10,
          },
        },
        {
          name: "Findings",
          type: "bar",
          data: chartData.topSources.map((row) => row.findings),
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          cursor: "pointer",
          label: {
            show: true,
            position: "right",
            fontSize: 10,
          },
        },
      ],
    }),
    [chartData.topSources],
  );

  const hasChartData =
    chartData.timeline.length > 0 || chartData.topSources.length > 0;
  const isLoading = isBaseLoading && baseCharts === EMPTY_CHARTS;

  const handleTableFiltersChange = useCallback(
    (filters: SearchRunnersFiltersInputDto | undefined) => {
      setTableFilters(filters);
      setIsChartsLoading(true);
    },
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
            {t("scans.title")}
          </h1>
          <p className="text-muted-foreground">
            Search run history and filter by operational status from one
            surface.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setWizardOpen(true)}>
            <Play className="mr-2 h-4 w-4" />
            Create Scan
          </Button>
        </div>
        <ScanWizard open={wizardOpen} onOpenChange={setWizardOpen} />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="ml-2 text-sm">Loading scans visualizations...</span>
        </div>
      ) : (
        <>
          <div className="relative grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {panels.map((panel) => {
              const isActive =
                panel.key === "TOTAL"
                  ? selectedStatuses.length === 0
                  : selectedStatuses.includes(panel.key as SearchRunnersStatus);
              return (
                <button
                  key={panel.key}
                  type="button"
                  className="group text-left cursor-pointer transition-transform hover:-translate-y-px focus-visible:outline-none"
                  onClick={() => {
                    if (panel.key === "TOTAL") {
                      setSelectedStatuses([]);
                    } else {
                      setSelectedStatuses([panel.key as SearchRunnersStatus]);
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
                        {isBaseLoading ? (
                          <span className="inline-block h-8 w-16 animate-pulse rounded bg-current opacity-20" />
                        ) : (
                          panel.value.toLocaleString()
                        )}
                      </p>
                    </CardContent>
                  </Card>
                </button>
              );
            })}

            {isBaseLoading && baseCharts !== EMPTY_CHARTS && (
              <div className="pointer-events-none absolute inset-0 z-10 rounded-[6px] bg-background/30 backdrop-blur-[1px]" />
            )}
          </div>

          <div className="relative">
            {hasChartData ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <Card className="panel-card rounded-[6px]">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                      <CardTitle className="text-sm uppercase tracking-[0.08em]">
                        Run Trend
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Status distribution over the selected timeline.
                      </p>
                    </div>
                    <Select value={windowDays} onValueChange={setWindowDays}>
                      <SelectTrigger className="h-8 w-[104px] text-xs border-2 border-border rounded-[4px] font-mono">
                        <SelectValue placeholder="Window" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7">7 days</SelectItem>
                        <SelectItem value="30">30 days</SelectItem>
                        <SelectItem value="90">90 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </CardHeader>
                  <CardContent>
                    <EChartBox option={trendOption} className="h-[300px]" />
                  </CardContent>
                </Card>

                <Card className="panel-card rounded-[6px]">
                  <CardHeader>
                    <CardTitle className="text-sm uppercase tracking-[0.08em]">
                      Top Sources by Run Volume
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <EChartBox
                      option={topSourcesOption}
                      className="h-[300px]"
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
                            : chartData.topSources.findIndex(
                                (item) => item.sourceName === axisValue,
                              );
                        const target =
                          chartData.topSources[
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
                title={t("scans.noRuns")}
                description={t("scans.noRunsHint")}
              />
            )}

            {isChartsLoading && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[6px] bg-background/55 backdrop-blur-[1px]">
                <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Updating charts...
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div>
        <RunnersTable
          statuses={selectedStatuses}
          onFiltersChange={handleTableFiltersChange}
        />
      </div>
    </div>
  );
}
