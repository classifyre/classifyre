"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  formatDate,
  formatRelative,
  formatDateUTC,
  formatShortUTC,
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
  type RunnerDto,
  type RunnerLogEntryDto,
  type SearchAssetsChartsResponseDto,
  type SearchFindingsChartsResponseDto,
  type StartRunnerDto,
} from "@workspace/api-client";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";
import { AssetsTable } from "@/components/assets-table";
import { DetailBackButton } from "@/components/detail-back-button";
import { FindingsTable } from "@/components/findings-table";
import { RunnerLogViewer } from "@/components/runner-log-viewer";
import {
  getRunnerStatusBadgeLabel,
  getRunnerStatusBadgeTone,
  isRunnerStatusRunning,
} from "@/lib/runner-status-badge";
import { getSourceIcon } from "@/lib/source-type-icon";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Spinner,
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

function calculateProgress(runner: RunnerDto): number {
  if (runner.status !== "RUNNING" || !runner.startedAt) return 0;
  const processed = runner.assetsCreated + runner.assetsUpdated;
  return processed > 0
    ? Math.min(95, Math.round((processed / Math.max(processed, 100)) * 100))
    : 10;
}

function formatDuration(ms?: number | null) {
  if (!ms) return "N/A";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

export default function RunnerDetailPage() {
  const { t } = useTranslation();
  const params = useParams();
  const router = useRouter();
  const runnerId = params.id as string;

  const [runner, setRunner] = useState<RunnerDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [assetsCharts, setAssetsCharts] =
    useState<SearchAssetsChartsResponseDto>(EMPTY_ASSETS_CHARTS);
  const [findingsCharts, setFindingsCharts] =
    useState<SearchFindingsChartsResponseDto>(EMPTY_FINDINGS_CHARTS);
  const [isOverviewRefreshing, setIsOverviewRefreshing] = useState(false);

  const [isStopping, setIsStopping] = useState(false);
  const [isRunningAgain, setIsRunningAgain] = useState(false);

  const [logEntries, setLogEntries] = useState<RunnerLogEntryDto[]>([]);
  const [logsCursor, setLogsCursor] = useState("0");
  const [logsHasMore, setLogsHasMore] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsLoadingMore, setLogsLoadingMore] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);

  const fetchOverview = useCallback(async (currentRunner: RunnerDto) => {
    try {
      setIsOverviewRefreshing(true);
      setOverviewError(null);

      const [nextAssetsCharts, nextFindingsCharts] = await Promise.all([
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
      ]);

      setAssetsCharts(nextAssetsCharts ?? EMPTY_ASSETS_CHARTS);
      setFindingsCharts(nextFindingsCharts ?? EMPTY_FINDINGS_CHARTS);
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

  const fetchLogsPage = useCallback(
    async (scanRunnerId: string, cursor?: string, append = false) => {
      try {
        if (append) {
          setLogsLoadingMore(true);
        } else {
          setLogsLoading(true);
        }

        const response = await api.runners.cliRunnerControllerGetRunnerLogs({
          runnerId: scanRunnerId,
          cursor,
          take: 200,
        });

        const entries = response.entries ?? [];
        setLogsCursor(response.cursor || cursor || "0");
        setLogsHasMore(Boolean(response.hasMore));
        setLogEntries((prev) => (append ? [...prev, ...entries] : entries));
      } catch (err) {
        console.error("Failed to fetch logs:", err);
        if (!append) {
          setLogEntries([]);
          setLogsHasMore(false);
          setLogsCursor("0");
        }
      } finally {
        if (append) {
          setLogsLoadingMore(false);
        } else {
          setLogsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const load = async () => {
      const currentRunner = await fetchRunner(true);
      if (!currentRunner) {
        return;
      }
      await Promise.all([
        fetchOverview(currentRunner),
        fetchLogsPage(currentRunner.id),
      ]);
    };

    if (runnerId) {
      void load();
    }
  }, [runnerId, fetchRunner, fetchOverview, fetchLogsPage]);

  const refreshRunnerState = useCallback(async () => {
    const nextRunner = await fetchRunner(false);
    if (!nextRunner) {
      return;
    }
    await fetchOverview(nextRunner);
  }, [fetchOverview, fetchRunner]);

  useEffect(() => {
    if (!autoRefreshEnabled || !runnerId) {
      return;
    }
    if (
      !runner ||
      (runner.status !== "RUNNING" && runner.status !== "PENDING")
    ) {
      return;
    }

    const interval = setInterval(() => {
      void refreshRunnerState();
      if (!logsLoading && !logsLoadingMore) {
        void fetchLogsPage(runnerId, logsCursor, true);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [
    autoRefreshEnabled,
    fetchLogsPage,
    logsCursor,
    logsLoading,
    logsLoadingMore,
    refreshRunnerState,
    runner,
    runnerId,
  ]);

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

  const handleLoadMoreLogs = async () => {
    if (!runnerId || !logsHasMore || logsLoadingMore) {
      return;
    }
    await fetchLogsPage(runnerId, logsCursor, true);
  };

  const handleRefreshLogs = useCallback(async () => {
    if (!runnerId) {
      return;
    }
    await refreshRunnerState();
    if (!logsLoading && !logsLoadingMore) {
      await fetchLogsPage(runnerId, logsCursor, true);
    }
  }, [
    fetchLogsPage,
    logsCursor,
    logsLoading,
    logsLoadingMore,
    refreshRunnerState,
    runnerId,
  ]);

  const handleDownloadAllLogs = useCallback(async (): Promise<
    RunnerLogEntryDto[]
  > => {
    if (!runnerId) {
      return [];
    }

    const aggregated: RunnerLogEntryDto[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined = undefined;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore && pageCount < 1000) {
      const response = await api.runners.cliRunnerControllerGetRunnerLogs({
        runnerId,
        cursor,
        take: 1000,
      });

      for (const entry of response.entries ?? []) {
        if (seen.has(entry.cursor)) {
          continue;
        }
        seen.add(entry.cursor);
        aggregated.push(entry);
      }

      cursor = response.nextCursor || undefined;
      hasMore = Boolean(response.hasMore && cursor);
      pageCount += 1;
    }

    return aggregated;
  }, [runnerId]);

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

  const sourceName = runner.source?.name || "Unknown source";
  const sourceType = runner.source?.type || "CUSTOM";
  const SourceTypeIcon = getSourceIcon(sourceType);
  const sourceDetailsId = runner.sourceId || runner.source?.id;
  const hasActiveRun =
    runner.status === "RUNNING" || runner.status === "PENDING";

  const findingsTotal = findingsCharts.totals.total;
  const assetsTotal = assetsCharts.totals.totalAssets;
  const progress = calculateProgress(runner);

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
                {sourceName} Run
              </h1>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge
                className={`rounded-[4px] border ${getRunnerStatusBadgeTone(runner.status)}`}
                data-testid="scan-status-badge"
              >
                {isRunnerStatusRunning(runner.status) && (
                  <Spinner
                    size="sm"
                    className="gap-0 [&_svg]:size-3"
                    data-icon="inline-start"
                  />
                )}
                {getRunnerStatusBadgeLabel(runner.status)}
              </Badge>
              <Badge variant="outline" className="rounded-[4px]">
                {runner.triggerType}
              </Badge>
              <span>Triggered {formatRelative(runner.triggeredAt)}</span>
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
            Source Details
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-[4px] border-2 border-black"
            onClick={() => router.push(`/sources/${sourceDetailsId}/edit`)}
            disabled={!sourceDetailsId}
          >
            <Pencil className="h-4 w-4" />
            Edit Source
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
          {runner.status === "RUNNING" && (
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
          <TabsTrigger value="findings" className="rounded-[3px]" data-testid="tab-findings">
            Findings
            {findingsTotal > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold">
                {findingsTotal}
              </span>
            )}
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

          {runner.status === "ERROR" && (
            <Card className="border-destructive/30 bg-destructive/5 rounded-[6px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-destructive text-base">
                  Run failed
                </CardTitle>
                {runner.errorMessage && (
                  <CardDescription className="text-destructive/80">
                    {runner.errorMessage}
                  </CardDescription>
                )}
                {runner.errorDetails &&
                  typeof runner.errorDetails === "object" && (
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-destructive/70">
                      {typeof (runner.errorDetails as Record<string, unknown>)
                        .exitCode === "number" && (
                        <span className="font-mono bg-destructive/10 px-1.5 py-0.5 rounded">
                          exit&nbsp;
                          {String(
                            (runner.errorDetails as Record<string, unknown>)
                              .exitCode
                          )}
                        </span>
                      )}
                      {typeof (runner.errorDetails as Record<string, unknown>)
                        .jobName === "string" && (
                        <span className="font-mono bg-destructive/10 px-1.5 py-0.5 rounded truncate max-w-xs">
                          {String(
                            (runner.errorDetails as Record<string, unknown>)
                              .jobName
                          )}
                        </span>
                      )}
                    </div>
                  )}
              </CardHeader>
              {runner.errorDetails &&
                typeof runner.errorDetails === "object" &&
                typeof (runner.errorDetails as Record<string, unknown>)
                  .output === "string" && (
                  <CardContent>
                    <details className="group">
                      <summary className="cursor-pointer text-xs text-destructive/60 hover:text-destructive/80 mb-1 select-none">
                        Show job output
                      </summary>
                      <pre className="text-xs text-destructive/80 bg-destructive/5 p-2 rounded max-h-64 overflow-auto break-all whitespace-pre-wrap">
                        {String(
                          (runner.errorDetails as Record<string, unknown>)
                            .output
                        )}
                      </pre>
                    </details>
                  </CardContent>
                )}
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: "Findings", value: findingsCharts.totals.total },
              {
                label: "Critical + High",
                value:
                  findingsCharts.totals.critical + findingsCharts.totals.high,
              },
              { label: "Assets", value: assetsCharts.totals.totalAssets },
              { label: "Open", value: findingsCharts.totals.open },
              { label: "Resolved", value: findingsCharts.totals.resolved },
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

          {runner.status === "RUNNING" && (
            <Card className="border-2 border-black rounded-[6px]">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Run Progress</CardTitle>
                <CardDescription>
                  Estimated from processed assets
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium">{progress}%</span>
                </div>
                <Progress value={progress} />
                {runner.durationMs != null && (
                  <p className="text-xs text-muted-foreground">
                    Duration so far: {formatDuration(runner.durationMs)}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-2 border-border rounded-[6px]">
              <CardHeader>
                <CardTitle>Run Timeline</CardTitle>
                <CardDescription>Execution timestamps</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Triggered</span>
                  <span className="text-right">
                    {formatDate(runner.triggeredAt)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Started</span>
                  <span className="text-right">
                    {formatDate(runner.startedAt)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Completed</span>
                  <span className="text-right">
                    {formatDate(runner.completedAt)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Duration</span>
                  <span className="text-right">
                    {formatDuration(runner.durationMs)}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-muted-foreground">Triggered By</span>
                  <span className="text-right">
                    {runner.triggeredBy === "pg-boss"
                      ? "Scheduler"
                      : runner.triggeredBy || "System"}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-border rounded-[6px]">
              <CardHeader>
                <CardTitle>Asset Delta</CardTitle>
                <CardDescription>Changes produced by this run</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-semibold">
                    +{assetsCharts.totals.newAssets.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span className="font-semibold">
                    ~{assetsCharts.totals.updatedAssets.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Unchanged</span>
                  <span className="font-semibold">
                    {assetsCharts.totals.unchangedAssets.toLocaleString()}
                  </span>
                </div>
                <div className="pt-1 flex items-center justify-between border-t">
                  <span className="text-muted-foreground">Total Assets</span>
                  <span className="font-semibold">
                    {assetsCharts.totals.totalAssets.toLocaleString()}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-2 border-border rounded-[6px]">
            <CardHeader>
              <CardTitle>Source Context</CardTitle>
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
                  Open Source
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

        <TabsContent value="findings" className="space-y-4">
          <Suspense>
            <FindingsTable
              lockedFilters={{
                runnerId: [runner.id],
                includeResolved: true,
              }}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="assets" className="space-y-4">
          <Suspense>
            <AssetsTable
              scope={{ sourceId: runner.sourceId, runnerId: runner.id }}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <RunnerLogViewer
            runnerId={runnerId}
            entries={logEntries}
            hasMore={logsHasMore}
            loading={logsLoading}
            loadingMore={logsLoadingMore}
            isRunning={
              runner.status === "RUNNING" || runner.status === "PENDING"
            }
            autoRefreshEnabled={autoRefreshEnabled}
            onAutoRefreshChange={setAutoRefreshEnabled}
            onLoadMore={handleLoadMoreLogs}
            onRefreshNow={handleRefreshLogs}
            onDownloadAll={handleDownloadAllLogs}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
