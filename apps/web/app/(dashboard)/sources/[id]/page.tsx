"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatDate, formatRelative, formatShortUTC } from "@/lib/date";
import {
  CalendarClock,
  CalendarOff,
  Pencil,
  Play,
  ArrowUpRight,
} from "lucide-react";
import {
  api,
  SearchRunnersSortByEnum,
  SearchRunnersSortOrderEnum,
  type FindingResponseDto,
  type SearchRunnersResponseDto,
  type SourceResponseDto,
  type StartRunnerDto,
  type SearchAssetsChartsResponseDto,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Spinner } from "@workspace/ui/components/spinner";
import { Separator } from "@workspace/ui/components/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { isIngestionSourceType } from "@workspace/ui/components/source-icon";
import { AssetsTable } from "@/components/assets-table";
import { DetailBackButton } from "@/components/detail-back-button";
import { DeleteSourceAction } from "@/components/delete-source-action";
import { FindingsTable } from "@/components/findings-table";
import { getSourceSchema } from "@/lib/schema-loader";
import { getSourceIcon } from "@/lib/source-type-icon";
import {
  getRunnerStatusBadgeLabel,
  getRunnerStatusBadgeTone,
  isRunnerStatusRunning,
} from "@/lib/runner-status-badge";
import { useTranslation } from "@/hooks/use-translation";

const EMPTY_CHARTS: SearchAssetsChartsResponseDto = {
  totals: {
    totalAssets: 0,
    newAssets: 0,
    updatedAssets: 0,
    unchangedAssets: 0,
  },
  topAssetsByFindings: [],
  topSourcesByAssetVolume: [],
};

type DetectorType = FindingResponseDto["detectorType"];

const detectorDotClass: Partial<Record<DetectorType, string>> = {
  SECRETS: "bg-rose-500",
  PII: "bg-amber-500",
  TOXIC: "bg-fuchsia-500",
  NSFW: "bg-cyan-500",
  YARA: "bg-emerald-500",
  BROKEN_LINKS: "bg-orange-500",
  PROMPT_INJECTION: "bg-violet-500",
  HATE_SPEECH: "bg-rose-700",
  AI_GENERATED: "bg-slate-500",
  BIAS: "bg-lime-700",
  CONTENT_QUALITY: "bg-sky-600",
  DUPLICATE: "bg-teal-600",
  DOMAIN_CLASS: "bg-cyan-700",
  CONTENT_TYPE: "bg-blue-700",
  SENSITIVITY_TIER: "bg-yellow-700",
  JURISDICTION_TAG: "bg-violet-700",
  CUSTOM: "bg-indigo-600",
};

const detectorLabels: Partial<Record<DetectorType, string>> = {
  SECRETS: "Secrets",
  PII: "PII",
  TOXIC: "Toxic",
  NSFW: "NSFW",
  YARA: "YARA",
  BROKEN_LINKS: "Broken Links",
  PROMPT_INJECTION: "Prompt Injection",
  HATE_SPEECH: "Hate Speech",
  AI_GENERATED: "AI Generated",
  BIAS: "Bias",
  CONTENT_QUALITY: "Content Quality",
  DUPLICATE: "Duplicate",
  DOMAIN_CLASS: "Domain Class",
  CONTENT_TYPE: "Content Type",
  SENSITIVITY_TIER: "Sensitivity Tier",
  JURISDICTION_TAG: "Jurisdiction Tag",
  CUSTOM: "Custom Detector",
};

const getApiBase = () =>
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL ?? "/api")
    : (process.env.API_URL ?? "http://localhost:8000");

export default function SourceViewPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams();
  const sourceId = params.id as string;

  const [source, setSource] = useState<SourceResponseDto | null>(null);
  const [assetCharts, setAssetCharts] =
    useState<SearchAssetsChartsResponseDto>(EMPTY_CHARTS);
  const [recentRunners, setRecentRunners] = useState<
    SearchRunnersResponseDto["items"]
  >([]);
  const [customDetectorsById, setCustomDetectorsById] = useState<
    Record<string, { name: string; key: string }>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isStartingScan, setIsStartingScan] = useState(false);

  const fetchSourceData = useCallback(
    async (showLoading = true) => {
      try {
        if (showLoading) {
          setIsLoading(true);
        }
        setError(null);

        const [sourceResponse, runnersResponse, chartsResponse] =
          await Promise.all([
            api.sources.sourcesControllerGetSource({ id: sourceId }),
            api.searchRunners({
              filters: { sourceId: [sourceId] },
              page: {
                skip: 0,
                limit: 3,
                sortBy: SearchRunnersSortByEnum.TriggeredAt,
                sortOrder: SearchRunnersSortOrderEnum.Desc,
              },
            }),
            api.searchAssetsCharts({ assets: { sourceId } }),
          ]);

        setSource(sourceResponse);
        setRecentRunners(runnersResponse.items ?? []);
        setAssetCharts(chartsResponse ?? EMPTY_CHARTS);
      } catch (err) {
        console.error("Failed to load source view:", err);
        setError(err instanceof Error ? err.message : "Failed to load source");
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [sourceId],
  );

  useEffect(() => {
    if (sourceId) {
      void fetchSourceData();
    }
  }, [fetchSourceData, sourceId]);

  useEffect(() => {
    const configured = (
      source?.config as { custom_detectors?: unknown } | undefined
    )?.custom_detectors;
    const customDetectorIds = Array.isArray(configured)
      ? configured
          .map((entry) => String(entry).trim())
          .filter((entry) => entry.length > 0)
      : [];
    if (customDetectorIds.length === 0) {
      setCustomDetectorsById({});
      return;
    }

    let cancelled = false;
    const idSet = new Set(customDetectorIds);

    async function loadCustomDetectors() {
      try {
        const base = getApiBase();
        const response = await fetch(
          `${base}/custom-detectors?includeInactive=true`,
        );
        if (!response.ok) {
          throw new Error(
            `Failed to load custom detectors: ${response.status}`,
          );
        }
        const payload = (await response.json()) as Array<{
          id: string;
          name: string;
          key: string;
        }>;
        if (cancelled) return;
        const next: Record<string, { name: string; key: string }> = {};
        for (const detector of payload) {
          if (!idSet.has(detector.id)) {
            continue;
          }
          next[detector.id] = { name: detector.name, key: detector.key };
        }
        setCustomDetectorsById(next);
      } catch {
        if (!cancelled) {
          setCustomDetectorsById({});
        }
      }
    }

    void loadCustomDetectors();
    return () => {
      cancelled = true;
    };
  }, [source?.config]);

  const lastRunner = useMemo(() => {
    return recentRunners[0];
  }, [recentRunners]);

  const SourceTypeIcon = getSourceIcon(source?.type);

  const requiredFields = useMemo(() => {
    if (!source?.type || !source?.config) return [];
    if (!isIngestionSourceType(source.type)) return [];
    const schema = getSourceSchema(source.type);
    if (!schema?.properties) return [];

    const requiredSchema = schema.properties.required as
      | { required?: string[] }
      | undefined;
    if (!requiredSchema?.required) return [];

    const requiredConfig = (source.config as Record<string, unknown>)
      .required as Record<string, unknown> | undefined;
    if (!requiredConfig) return [];

    return requiredSchema.required.map((key) => ({
      key,
      label: key.replace(/_/g, " "),
      value: requiredConfig[key],
    }));
  }, [source?.type, source?.config]);

  const enabledDetectors = useMemo(() => {
    if (!source?.config) return [];
    const config = source.config as Record<string, unknown>;
    const builtInDetectors = Array.isArray(config.detectors)
      ? config.detectors
      : [];
    const selectedCustomDetectors = Array.isArray(config.custom_detectors)
      ? config.custom_detectors
          .map((entry) => String(entry).trim())
          .filter((entry) => entry.length > 0)
      : [];

    const builtIn = builtInDetectors
      .filter(
        (
          d,
        ): d is {
          type: DetectorType;
          enabled: boolean;
          config?: Record<string, unknown>;
        } =>
          typeof d === "object" &&
          d !== null &&
          "type" in d &&
          (d as { enabled?: unknown }).enabled !== false &&
          (d as { type?: unknown }).type !== "CUSTOM",
      )
      .map((d) => {
        return {
          id: d.type,
          type: d.type,
          label: detectorLabels[d.type] ?? d.type,
        };
      });

    const custom = selectedCustomDetectors.map((id) => {
      const mapped = customDetectorsById[id];
      return {
        id: `CUSTOM:${id}`,
        type: "CUSTOM" as DetectorType,
        label: mapped?.name ?? "Custom Detector",
      };
    });

    return [...builtIn, ...custom];
  }, [customDetectorsById, source?.config]);

  const formatFieldValue = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return value.toLocaleString();
    if (typeof value === "string")
      return value.length > 140 ? `${value.slice(0, 140)}…` : value;
    if (Array.isArray(value)) {
      if (value.length === 0) return "—";
      const preview = value
        .slice(0, 4)
        .map((e) => String(e))
        .join(", ");
      return value.length > 4
        ? `${preview} +${value.length - 4} more`
        : preview;
    }
    return "—";
  };

  const handleStartScan = async () => {
    if (!sourceId) return;
    setIsStartingScan(true);
    setActionError(null);
    try {
      const startRunnerDto: StartRunnerDto = { triggerType: "MANUAL" };
      const runner = await api.runners.cliRunnerControllerStartRunner({
        sourceId,
        startRunnerDto,
      });
      await fetchSourceData(false);
      if (runner?.id) {
        router.push(`/scans/${runner.id}`);
      }
    } catch (err) {
      console.error("Failed to start scan:", err);
      setActionError(
        err instanceof Error ? err.message : "Failed to start scan",
      );
    } finally {
      setIsStartingScan(false);
    }
  };

  const isSourceRunning = source?.runnerStatus === "RUNNING";

  const { totals } = assetCharts;
  const assetPanels = [
    { key: "total", label: t("sources.totalAssets"), value: totals.totalAssets },
    { key: "new", label: "New", value: totals.newAssets },
    { key: "updated", label: "Updated", value: totals.updatedAssets },
    { key: "unchanged", label: "Unchanged", value: totals.unchangedAssets },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <DetailBackButton fallbackHref="/sources" />
          <div>
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
              Loading source...
            </h1>
          </div>
        </div>
      </div>
    );
  }

  if (error || !source) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <DetailBackButton fallbackHref="/sources" />
          <div>
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
              Source not available
            </h1>
            <p className="text-muted-foreground">
              {error || "We couldn't load this source."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <DetailBackButton fallbackHref="/sources" />
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[4px] border border-border bg-background">
              <SourceTypeIcon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
                {source.name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{source.type} source</span>
                <Badge
                  className={`rounded-[4px] border ${getRunnerStatusBadgeTone(source.runnerStatus)}`}
                >
                  {isRunnerStatusRunning(source.runnerStatus) && (
                    <Spinner
                      size="sm"
                      className="gap-0 [&_svg]:size-3"
                      data-icon="inline-start"
                    />
                  )}
                  {t(getRunnerStatusBadgeLabel(source.runnerStatus))}
                </Badge>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/sources/${sourceId}/edit`)}
            >
              <Pencil className="h-4 w-4" />
              Edit Source
            </Button>
            <DeleteSourceAction sourceId={sourceId} />
            <Button
              size="sm"
              onClick={handleStartScan}
              disabled={isStartingScan || isSourceRunning}
            >
              <Play className="h-4 w-4" />
              {isStartingScan
                ? "Starting..."
                : isSourceRunning
                  ? "Running..."
                  : "Run Scan"}
            </Button>
          </div>
          {actionError && (
            <p className="text-xs text-destructive">{actionError}</p>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="h-auto rounded-[4px] border-2 border-black bg-background p-1">
          <TabsTrigger value="overview" className="rounded-[3px]">
            Overview
          </TabsTrigger>
          <TabsTrigger value="findings" className="rounded-[3px]">
            Findings
          </TabsTrigger>
          <TabsTrigger value="assets" className="rounded-[3px]">
            Assets
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Separator />

          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {assetPanels.map((panel) => (
              <Card
                key={panel.key}
                className="border-2 border-border rounded-[6px]"
              >
                <CardContent className="p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
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
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t("sources.detail.sourceDetails")}</CardTitle>
                <CardDescription>
                  {t("sources.detail.sourceDetailsDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground">
                      {t("common.status")}
                    </p>
                    <Badge
                      className={`rounded-[4px] border ${getRunnerStatusBadgeTone(source.runnerStatus)}`}
                    >
                      {isRunnerStatusRunning(source.runnerStatus) && (
                        <Spinner
                          size="sm"
                          className="gap-0 [&_svg]:size-3"
                          data-icon="inline-start"
                        />
                      )}
                      {t(getRunnerStatusBadgeLabel(source.runnerStatus))}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground">{t("common.type")}</p>
                    <div className="inline-flex items-center gap-2">
                      <SourceTypeIcon className="h-4 w-4 text-muted-foreground" />
                      <Badge variant="outline" className="rounded-[4px]">
                        {source.type ?? "—"}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground">
                      {t("common.created")}
                    </p>
                    <p className="text-sm">{formatDate(source.createdAt)}</p>
                    {source.createdAt && (
                      <p className="text-xs text-muted-foreground">
                        {formatRelative(source.createdAt)}
                        {formatShortUTC(source.createdAt) && (
                          <span className="text-muted-foreground/50">
                            {" "}
                            · {formatShortUTC(source.createdAt)}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground">
                      {t("sources.detail.lastUpdated")}
                    </p>
                    <p className="text-sm">{formatDate(source.updatedAt)}</p>
                    {source.updatedAt && (
                      <p className="text-xs text-muted-foreground">
                        {formatRelative(source.updatedAt)}
                        {formatShortUTC(source.updatedAt) && (
                          <span className="text-muted-foreground/50">
                            {" "}
                            · {formatShortUTC(source.updatedAt)}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground">
                      {t("sources.detail.lastScan")}
                    </p>
                    <p className="text-sm">
                      {lastRunner
                        ? formatDate(lastRunner.triggeredAt)
                        : t("sources.detail.notScannedYet")}
                    </p>
                    {lastRunner && (
                      <p className="text-xs text-muted-foreground">
                        {formatRelative(lastRunner.triggeredAt)}
                        {formatShortUTC(lastRunner.triggeredAt) && (
                          <span className="text-muted-foreground/50">
                            {" "}
                            · {formatShortUTC(lastRunner.triggeredAt)}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground">
                      Last Scan Status
                    </p>
                    {lastRunner ? (
                      <Badge
                        className={`rounded-[4px] border ${getRunnerStatusBadgeTone(lastRunner.status)}`}
                      >
                        {isRunnerStatusRunning(lastRunner.status) && (
                          <Spinner
                            size="sm"
                            className="gap-0 [&_svg]:size-3"
                            data-icon="inline-start"
                          />
                        )}
                        {t(getRunnerStatusBadgeLabel(lastRunner.status))}
                      </Badge>
                    ) : (
                      <p className="text-sm">—</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground">
                      Current Run
                    </p>
                    {source.currentRunnerId ? (
                      <Button
                        variant="link"
                        size="sm"
                        className="px-0"
                        onClick={() =>
                          router.push(`/scans/${source.currentRunnerId}`)
                        }
                      >
                        View Run
                        <ArrowUpRight className="h-3 w-3" />
                      </Button>
                    ) : (
                      <p className="text-sm">None</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground">
                      Last Run Summary
                    </p>
                    {lastRunner ? (
                      <p className="text-sm">
                        {lastRunner.totalFindings.toLocaleString()} findings ·{" "}
                        {(
                          lastRunner.assetsCreated +
                          lastRunner.assetsUpdated +
                          lastRunner.assetsUnchanged
                        ).toLocaleString()}{" "}
                        assets scanned
                      </p>
                    ) : (
                      <p className="text-sm">—</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs uppercase text-muted-foreground">
                      {t("sources.detail.scheduleSection")}
                    </p>
                    {source.scheduleEnabled ? (
                      <div className="flex items-center gap-1.5 text-sm text-[#4a7c00] font-medium">
                        <CalendarClock className="h-4 w-4 shrink-0" />
                        <span className="font-mono text-xs">
                          {source.scheduleCron ?? "—"}
                        </span>
                        {source.scheduleTimezone && (
                          <span className="text-xs text-muted-foreground font-normal">
                            ({source.scheduleTimezone})
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <CalendarOff className="h-4 w-4 shrink-0" />
                        <span>Manual only</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t("sources.detail.requiredDetails")}</CardTitle>
                  <CardDescription>
                    {t("sources.detail.requiredDetailsDesc")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {requiredFields.length > 0 ? (
                    <div className="grid gap-3">
                      {requiredFields.map(({ key, label, value }) => (
                        <div
                          key={key}
                          className="flex items-start justify-between gap-4"
                        >
                          <p className="text-xs uppercase text-muted-foreground capitalize">
                            {label}
                          </p>
                          <p
                            className="text-sm text-right text-foreground/90 line-clamp-2 font-mono"
                            title={String(value)}
                          >
                            {formatFieldValue(value)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No required details available.
                    </p>
                  )}

                  {enabledDetectors.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs uppercase text-muted-foreground">
                        Active Detectors
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {enabledDetectors.map((detector) => (
                          <Badge
                            key={detector.id}
                            variant="outline"
                            className="gap-1.5"
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${detectorDotClass[detector.type] ?? "bg-slate-400"}`}
                            />
                            {detector.label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t("sources.detail.recentRunners")}</CardTitle>
                  <CardDescription>{t("sources.detail.recentRunnersDesc")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {recentRunners.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t("sources.detail.notScannedMessage")}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {recentRunners.map((runner) => (
                        <button
                          key={runner.id}
                          type="button"
                          onClick={() => router.push(`/scans/${runner.id}`)}
                          className="flex w-full items-center justify-between gap-3 rounded-[4px] border px-2.5 py-2 text-left transition-colors hover:bg-muted/40"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge
                                className={`rounded-[4px] border ${getRunnerStatusBadgeTone(runner.status)}`}
                              >
                                {isRunnerStatusRunning(runner.status) && (
                                  <Spinner
                                    size="sm"
                                    className="gap-0 [&_svg]:size-3"
                                    data-icon="inline-start"
                                  />
                                )}
                                {t(getRunnerStatusBadgeLabel(runner.status))}
                              </Badge>
                              <span className="truncate text-xs text-muted-foreground">
                                {formatRelative(runner.triggeredAt)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {runner.totalFindings.toLocaleString()} findings ·{" "}
                              {(
                                runner.assetsCreated +
                                runner.assetsUpdated +
                                runner.assetsUnchanged
                              ).toLocaleString()}{" "}
                              assets
                            </p>
                          </div>
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="findings" className="space-y-4">
          <Suspense>
            <FindingsTable
              lockedFilters={{
                sourceId: [sourceId],
                includeResolved: true,
              }}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="assets" className="space-y-4">
          <Suspense>
            <AssetsTable scope={{ sourceId }} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
