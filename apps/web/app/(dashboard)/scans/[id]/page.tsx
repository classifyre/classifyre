"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRouteId } from "@/lib/use-route-id";
import {
  formatDate,
  formatRelative,
} from "@/lib/date";
import {
  AlertCircle,
  ArrowUpRight,
  FileText,
  Loader2,
  Pencil,
  Play,
  Square,
} from "lucide-react";
import {
  api,
  type RunnerAssetProgressDto,
  type RunnerDto,
  type RunnerLogEntryDto,
  type SearchAssetsChartsResponseDto,
  type SearchFindingsChartsResponseDto,
  type StartRunnerDto,
} from "@workspace/api-client";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";
import { useFormatDuration } from "@/hooks/use-format-duration";
import { RunnerAssetsTable } from "@/components/runner-assets-table";
import { DetailBackButton } from "@/components/detail-back-button";
import { RunnerLogViewer } from "@/components/runner-log-viewer";
import { useServerConfig } from "@/components/dashboard-layout";
import { useRunnerWebSocket } from "@/hooks/use-runner-websocket";
import { RunnerStatusBadge } from "@/components/runner-status-badge";
import { isRunnerStatusRunning } from "@/lib/runner-status-badge";
import { getSourceIcon } from "@/lib/source-type-icon";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components";

const EMPTY_ASSETS_CHARTS: SearchAssetsChartsResponseDto = {
  totals: {
    totalAssets: 0,
    newAssets: 0,
    updatedAssets: 0,
    unchangedAssets: 0,
  },
  topAssetsByFindings: [],
  topSourcesByAssetVolume: [],
};

const EMPTY_FINDINGS_CHARTS: SearchFindingsChartsResponseDto = {
  totals: {
    total: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    open: 0,
    resolved: 0,
  },
  timeline: [],
  topAssets: [],
};

export default function RunnerDetailPage() {
  const { t } = useTranslation();
  const formatDuration = useFormatDuration();
  const { s3Configured } = useServerConfig();
  const router = useRouter();
  const runnerId = useRouteId();

  const [runner, setRunner] = useState<RunnerDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [assetsCharts, setAssetsCharts] =
    useState<SearchAssetsChartsResponseDto>(EMPTY_ASSETS_CHARTS);
  const [findingsCharts, setFindingsCharts] =
    useState<SearchFindingsChartsResponseDto>(EMPTY_FINDINGS_CHARTS);
  const [assetProgress, setAssetProgress] =
    useState<RunnerAssetProgressDto | null>(null);
  const [isOverviewRefreshing, setIsOverviewRefreshing] = useState(false);

  const [isStopping, setIsStopping] = useState(false);
  const [isRunningAgain, setIsRunningAgain] = useState(false);
  const [wsLogEntries, setWsLogEntries] = useState<RunnerLogEntryDto[]>([]);

  const fetchOverview = useCallback(async (currentRunner: RunnerDto) => {
    try {
      setIsOverviewRefreshing(true);
      setOverviewError(null);

      const [nextAssetsCharts, nextFindingsCharts, nextAssetProgress] =
        await Promise.all([
          api.searchAssetsCharts({
            assets: {
              sourceId: currentRunner.sourceId,
              runnerId: currentRunner.id,
            },
            findings: {
              runnerId: [currentRunner.id],
              includeResolved: true,
            },
          }),
          api.searchFindingsCharts({
            filters: {
              runnerId: [currentRunner.id],
              includeResolved: true,
            },
            windowDays: 30,
          }),
          api.runners.cliRunnerControllerGetRunnerAssetProgress({
            runnerId: currentRunner.id,
          }),
        ]);

      setAssetsCharts(nextAssetsCharts ?? EMPTY_ASSETS_CHARTS);
      setFindingsCharts(nextFindingsCharts ?? EMPTY_FINDINGS_CHARTS);
      setAssetProgress(nextAssetProgress ?? null);
    } catch (err) {
      console.error("Failed to refresh runner overview:", err);
      setOverviewError(
        err instanceof Error
          ? err.message
          : "Failed to refresh overview metrics",
      );
    } finally {
      setIsOverviewRefreshing(false);
    }
  }, []);

  const fetchRunner = useCallback(
    async (showLoading = false) => {
      try {
        if (showLoading) {
          setLoading(true);
        }
        setError(null);
        const nextRunner = await api.runners.cliRunnerControllerGetRunner({
          runnerId,
        });
        setRunner(nextRunner);
        return nextRunner;
      } catch (err) {
        console.error("Failed to fetch runner:", err);
        setError(err instanceof Error ? err.message : "Failed to load run");
        return null;
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [runnerId],
  );

  const fetchLogsFn = useCallback(
    (params: { cursor?: string; take?: number; search?: string; levels?: string[]; sortOrder?: "asc" | "desc" }) =>
      api.runners.cliRunnerControllerSearchRunnerLogs({
        runnerId,
        searchRunnerLogsBodyDto: {
          cursor: params.cursor,
          take: params.take ?? 200,
          search: params.search,
          levels: params.levels as never[],
          sortOrder: params.sortOrder,
        },
      }),
    [runnerId],
  );

  useEffect(() => {
    const load = async () => {
      const currentRunner = await fetchRunner(true);
      if (!currentRunner) {
        return;
      }
      await fetchOverview(currentRunner);
    };

    if (runnerId) {
      void load();
    }
  }, [runnerId, fetchRunner, fetchOverview]);

  const refreshRunnerState = useCallback(async () => {
    const nextRunner = await fetchRunner(false);
    if (!nextRunner) {
      return;
    }
    await fetchOverview(nextRunner);
  }, [fetchOverview, fetchRunner]);

  const hasActiveRun =
    isRunnerStatusRunning(runner?.status) || runner?.status === "PENDING";

  // Use the stable fetchOverview ref so the WS callback doesn't close over stale state
  const fetchOverviewRef = useRef(fetchOverview);
  fetchOverviewRef.current = fetchOverview;

  const { subscribeToRunner, unsubscribeFromRunner, isConnected } =
    useRunnerWebSocket({
      enabled: true,
      trackRunnersList: false,
      onRunnerUpdate: (updatedRunner) => {
        if (updatedRunner.id !== runnerId) return;
        setRunner(updatedRunner);
        void fetchOverviewRef.current(updatedRunner);
      },
      onRunnerLog: (logRunnerId, entries) => {
        if (logRunnerId !== runnerId) return;
        setWsLogEntries(entries);
      },
    });

  // Subscribe to the specific runner room once connected
  useEffect(() => {
    if (!isConnected || !runnerId) return;
    subscribeToRunner(runnerId);
    return () => unsubscribeFromRunner(runnerId);
  }, [isConnected, runnerId, subscribeToRunner, unsubscribeFromRunner]);


  const handleStop = async () => {
    if (!runner) return;
    try {
      setIsStopping(true);
      await api.runners.cliRunnerControllerStopRunner({ runnerId: runner.id });
      toast.success(t("scans.stopSuccess"));
      await refreshRunnerState();
    } catch (err) {
      console.error("Failed to stop runner:", err);
      toast.error(err instanceof Error ? err.message : t("scans.failedToStop"));
    } finally {
      setIsStopping(false);
    }
  };

  const handleRunAgain = async () => {
    if (!runner?.sourceId) {
      toast.error(t("scans.sourceUnavailable"));
      return;
    }

    try {
      setIsRunningAgain(true);
      const startRunnerDto: StartRunnerDto = { triggerType: "MANUAL" };
      const newRunner = await api.runners.cliRunnerControllerStartRunner({
        sourceId: runner.sourceId,
        startRunnerDto,
      });
      toast.success(t("scans.newRunStarted"));
      if (newRunner?.id) {
        router.push(`/scans/${newRunner.id}`);
      }
    } catch (err) {
      console.error("Failed to start new run:", err);
      toast.error(
        err instanceof Error ? err.message : t("scans.failedToStart"),
      );
    } finally {
      setIsRunningAgain(false);
    }
  };

  const handleDownloadAllLogs = useCallback(async (): Promise<
    RunnerLogEntryDto[]
  > => {
    if (!runnerId) return [];

    const PAGE = 1000;
    const aggregated: RunnerLogEntryDto[] = [];
    let cursor: string | undefined = "0";
    let hasMore = true;

    while (hasMore) {
      const response = await fetchLogsFn({ cursor, take: PAGE, sortOrder: "asc" });
      aggregated.push(...(response.entries ?? []));
      hasMore = Boolean(response.hasMore && response.nextCursor);
      cursor = response.nextCursor ?? undefined;
    }

    return aggregated;
  }, [fetchLogsFn, runnerId]);

  const sourceName = runner?.source?.name || "Unknown source";
  const sourceType = runner?.source?.type || "CUSTOM";
  const SourceTypeIcon = getSourceIcon(sourceType);
  const sourceDetailsId = runner?.sourceId || runner?.source?.id;

  useEffect(() => {
    if (sourceName && runner) {
      document.title = `${t("scans.sourceRun", { source: sourceName })} | ${t("app.name")}`;
    }
  }, [sourceName, runner, t]);

  if (loading && !runner) {
    return (
      <div className="space-y-6">
        <DetailBackButton fallbackHref="/scans" />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error && !runner) {
    return (
      <div className="space-y-6">
        <DetailBackButton fallbackHref="/scans" />
        <Card className="border-2 border-border rounded-[6px]">
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Run Not Found</h3>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button
              variant="outline"
              className="rounded-[4px] border-2 border-black shadow-[3px_3px_0_#000]"
              onClick={() => router.push("/scans")}
            >
              View All Scans
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!runner) {
    return null;
  }

  const assetsTotal = assetsCharts.totals.totalAssets;
  const progressTotal = assetProgress?.total ?? 0;
  const progressFinished =
    (assetProgress?.processed ?? 0) + (assetProgress?.error ?? 0);
  const progressPercent =
    progressTotal > 0
      ? Math.round((progressFinished / progressTotal) * 100)
      : 0;
  const progressSegments =
    progressTotal > 0
      ? [
          {
            key: "processed",
            value: assetProgress?.processed ?? 0,
            className: "bg-accent",
          },
          {
            key: "error",
            value: assetProgress?.error ?? 0,
            className: "bg-destructive",
          },
          {
            key: "processing",
            value: assetProgress?.processing ?? 0,
            className: "bg-accent/40 animate-pulse",
          },
        ]
      : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <DetailBackButton fallbackHref="/scans" />
          <div className="min-w-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-[4px] border border-border bg-background">
                <SourceTypeIcon className="h-5 w-5 text-muted-foreground" />
              </div>
              <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em] truncate">
                {t("scans.sourceRun", { source: sourceName })}
              </h1>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <RunnerStatusBadge
                status={runner.status}
                data-testid="scan-status-badge"
              />
              <Badge variant="outline" className="rounded-[4px]">
                {t(`triggerTypes.${runner.triggerType}`)}
              </Badge>
              <span>{t("scans.runTimeline.triggered")} {formatRelative(runner.triggeredAt)}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            variant="outline"
            size="sm"
            className="rounded-[4px] border-2 border-black"
            onClick={() => router.push(`/sources/${sourceDetailsId}`)}
            disabled={!sourceDetailsId}
          >
            <FileText className="h-4 w-4" />
            {t("sources.detail.sourceDetails")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-[4px] border-2 border-black"
            onClick={() => router.push(`/sources/${sourceDetailsId}/edit`)}
            disabled={!sourceDetailsId}
          >
            <Pencil className="h-4 w-4" />
            {t("sources.editSource")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-[4px] border-2 border-black"
            onClick={handleRunAgain}
            disabled={isRunningAgain || !runner.sourceId || hasActiveRun}
          >
            {isRunningAgain ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isRunningAgain
              ? t("scans.starting")
              : hasActiveRun
                ? t("scans.runningLabel")
                : t("scans.runAgain")}
          </Button>
          {isRunnerStatusRunning(runner.status) && (
            <Button
              variant="destructive"
              size="sm"
              className="rounded-[4px] border-2 border-black"
              onClick={handleStop}
              disabled={isStopping}
            >
              {isStopping ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4" />
              )}
              {isStopping ? t("scans.stopping") : t("scans.stop")}
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="h-auto rounded-[4px] border-2 border-black bg-background p-1">
          <TabsTrigger value="overview" className="rounded-[3px]" data-testid="tab-overview">
            Overview
          </TabsTrigger>
          <TabsTrigger value="assets" className="rounded-[3px]" data-testid="tab-assets">
            Assets
            {assetsTotal > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold">
                {assetsTotal}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="logs" className="rounded-[3px]" data-testid="tab-logs">
            Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {overviewError && (
            <Card className="border-destructive/40 bg-destructive/5 rounded-[6px]">
              <CardContent className="py-3 text-sm text-destructive">
                {overviewError}
              </CardContent>
            </Card>
          )}

          {runner.status === "ERROR" && runner.errorMessage && (
            <Card className="border-destructive/30 bg-destructive/5 rounded-[6px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-destructive text-base">
                  Run failed
                </CardTitle>
                <CardDescription className="text-destructive/80">
                  {runner.errorMessage}
                </CardDescription>
              </CardHeader>
              {runner.errorDetails && (
                <CardContent>
                  <pre className="text-xs text-destructive/80 bg-destructive/5 p-2 rounded max-h-64 overflow-auto break-all whitespace-pre-wrap">
                    {JSON.stringify(runner.errorDetails, null, 2)}
                  </pre>
                </CardContent>
              )}
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: t("scans.stats.findings"), value: findingsCharts.totals.total },
              {
                label: t("scans.stats.criticalHigh"),
                value:
                  findingsCharts.totals.critical + findingsCharts.totals.high,
              },
              { label: t("scans.stats.assets"), value: assetsCharts.totals.totalAssets },
              { label: t("scans.stats.open"), value: findingsCharts.totals.open },
              { label: t("scans.stats.resolved"), value: findingsCharts.totals.resolved },
            ].map((item) => (
              <Card
                key={item.label}
                className="border-2 border-border rounded-[6px]"
                data-testid={`stats-card-${item.label.toLowerCase().replace(/ \+ /g, "-")}`}
              >
                <CardContent className="p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                    {item.label}
                  </p>
                  <p
                    className="mt-1 text-3xl font-black"
                    style={{ fontFamily: "var(--font-hero)" }}
                    data-testid="stats-value"
                  >
                    {item.value.toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {progressTotal > 0 && (
            <Card className="border-2 border-black rounded-[6px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t("scans.runProgress.title")}</CardTitle>
                <CardDescription>
                  {t("scans.runProgress.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("scans.runProgress.finishedOf", {
                      finished: progressFinished.toLocaleString(),
                      total: progressTotal.toLocaleString(),
                    })}
                  </span>
                  <span className="font-medium">
                    {t("scans.runProgress.complete", { percent: progressPercent })}
                  </span>
                </div>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                  {progressSegments.map((segment) =>
                    segment.value > 0 ? (
                      <div
                        key={segment.key}
                        className={`h-full ${segment.className} transition-all`}
                        style={{
                          width: `${(segment.value / progressTotal) * 100}%`,
                        }}
                      />
                    ) : null,
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-accent" />
                    {t("scans.runProgress.processed")}: {(assetProgress?.processed ?? 0).toLocaleString()}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-accent/40" />
                    {t("scans.runProgress.processing")}: {(assetProgress?.processing ?? 0).toLocaleString()}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                    {t("scans.runProgress.pending")}: {(assetProgress?.pending ?? 0).toLocaleString()}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-destructive" />
                    {t("scans.runProgress.errored")}: {(assetProgress?.error ?? 0).toLocaleString()}
                  </span>
                </div>
                {runner.durationMs != null && (
                  <p className="text-xs text-muted-foreground">
                    {t("scans.runProgress.durationSoFar", { duration: formatDuration(runner.durationMs) })}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-2 border-border rounded-[6px]">
              <CardHeader>
                <CardTitle>{t("scans.runTimeline.title")}</CardTitle>
                <CardDescription>{t("scans.runTimeline.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{t("scans.runTimeline.triggered")}</span>
                  <span className="text-right">
                    {formatDate(runner.triggeredAt)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{t("scans.runTimeline.started")}</span>
                  <span className="text-right">
                    {formatDate(runner.startedAt)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{t("scans.runTimeline.completed")}</span>
                  <span className="text-right">
                    {formatDate(runner.completedAt)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{t("scans.runTimeline.duration")}</span>
                  <span className="text-right">
                    {formatDuration(runner.durationMs)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">{t("scans.runTimeline.triggeredBy")}</span>
                  <span className="text-right">
                    {runner.triggeredBy === "pg-boss"
                      ? t("runners.scheduler")
                      : runner.triggeredBy || t("scans.runTimeline.na")}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-border rounded-[6px]">
              <CardHeader>
                <CardTitle>{t("scans.assetDelta.title")}</CardTitle>
                <CardDescription>{t("scans.assetDelta.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("scans.assetDelta.created")}</span>
                  <span className="font-semibold">
                    +{assetsCharts.totals.newAssets.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("scans.assetDelta.updated")}</span>
                  <span className="font-semibold">
                    ~{assetsCharts.totals.updatedAssets.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("scans.assetDelta.unchanged")}</span>
                  <span className="font-semibold">
                    {assetsCharts.totals.unchangedAssets.toLocaleString()}
                  </span>
                </div>
                <div className="pt-1 flex items-center justify-between border-t">
                  <span className="text-muted-foreground">{t("scans.stats.assets")}</span>
                  <span className="font-semibold">
                    {assetsCharts.totals.totalAssets.toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-2 border-border rounded-[6px]">
            <CardHeader>
              <CardTitle>{t("scans.sourceContext.title")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <SourceTypeIcon className="h-4 w-4 text-muted-foreground" />
                <Badge variant="outline" className="rounded-[4px]">
                  {sourceType}
                </Badge>
                <span className="text-sm">{sourceName}</span>
              </div>
              {(runner.sourceId || runner.source?.id) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-[4px] border-2 border-black"
                  onClick={() =>
                    router.push(
                      `/sources/${runner.sourceId || runner.source?.id}`,
                    )
                  }
                >
                  <ArrowUpRight className="h-4 w-4" />
                  {t("scans.sourceContext.openSource")}
                </Button>
              )}
            </CardContent>
          </Card>

          {isOverviewRefreshing && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Updating overview...
            </div>
          )}
        </TabsContent>

        <TabsContent value="assets" className="space-y-4">
          <RunnerAssetsTable runnerId={runner.id} runnerStatus={runner.status} />
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <RunnerLogViewer
            runnerId={runnerId}
            isRunning={hasActiveRun}
            s3Configured={s3Configured}
            isWsConnected={isConnected}
            fetchFn={fetchLogsFn}
            wsEntries={wsLogEntries}
            onDownloadAll={handleDownloadAllLogs}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
