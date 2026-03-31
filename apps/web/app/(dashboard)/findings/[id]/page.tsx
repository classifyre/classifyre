"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  formatDate,
  formatRelative,
  formatDateUTC,
  formatShortUTC,
} from "@/lib/date";
import { toast } from "sonner";
import {
  Activity,
  Clock,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  ShieldAlert,
} from "lucide-react";
import { api, type FindingResponseDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { EmptyState } from "@workspace/ui/components/empty-state";
import {
  FindingDetailDrawer,
  type FindingDrawerSaveData,
  type FindingDrawerSeverity,
  type FindingDrawerStatus,
} from "@workspace/ui/components/finding-detail-drawer";
import { Progress } from "@workspace/ui/components/progress";
import { Separator } from "@workspace/ui/components/separator";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { Spinner } from "@workspace/ui/components/spinner";
import { StatusBadge } from "@workspace/ui/components/status-badge";
import { SourceIcon } from "@workspace/ui/components/source-icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { FINDING_SEVERITY_COLOR_BY_LEVEL } from "@workspace/ui/lib/finding-severity";
import { DetailBackButton } from "@/components/detail-back-button";
import { MatchedContentBlock } from "@/components/matched-content-block";
import { FindingExtractionCard } from "@/components/finding-extraction-card";
import { FindingMetadataCard } from "@/components/finding-metadata-card";
import { useTranslation } from "@/hooks/use-translation";

type FindingHistoryEntry = NonNullable<FindingResponseDto["history"]>[number];
type DetectorType = FindingResponseDto["detectorType"];
type HistoryEventType = FindingHistoryEntry["eventType"];

const detectorLabels: Partial<Record<DetectorType, string>> = {
  SECRETS: "Secrets",
  PII: "PII",
  TOXIC: "Toxic Content",
  NSFW: "NSFW",
  YARA: "YARA",
  BROKEN_LINKS: "Broken Links",
  HATE_SPEECH: "Hate Speech",
  AI_GENERATED: "AI Generated",
  BIAS: "Bias",
  CONTENT_QUALITY: "Content Quality",
  DUPLICATE: "Duplicate",
  DOMAIN_CLASS: "Domain Class",
  CONTENT_TYPE: "Content Type",
  SENSITIVITY_TIER: "Sensitivity Tier",
  JURISDICTION_TAG: "Jurisdiction Tag",
};

const historyEventLabels: Partial<Record<HistoryEventType, string>> = {
  DETECTED: "Detected",
  RE_DETECTED: "Re-detected",
  RESOLVED: "Resolved",
  STATUS_CHANGED: "Status changed",
  SEVERITY_CHANGED: "Severity changed",
  RE_OPENED: "Re-opened",
};

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function toSeverityBadgeValue(severity?: string | null) {
  switch ((severity || "").toUpperCase()) {
    case "CRITICAL":
      return "critical" as const;
    case "HIGH":
      return "high" as const;
    case "MEDIUM":
      return "medium" as const;
    case "LOW":
      return "low" as const;
    default:
      return "info" as const;
  }
}

function toStatusBadgeValue(status?: string | null) {
  switch ((status || "").toUpperCase()) {
    case "FALSE_POSITIVE":
      return "false_positive" as const;
    case "RESOLVED":
      return "resolved" as const;
    case "IGNORED":
      return "ignored" as const;
    case "NEW":
      return "new" as const;
    default:
      return "open" as const;
  }
}

function formatConfidence(value?: number | string | null) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numeric)) return { percent: 0, label: "0%" };
  const clamped = Math.min(1, Math.max(0, numeric));
  return {
    percent: Math.round(clamped * 100),
    label: `${Math.round(clamped * 100)}%`,
  };
}

// ── DateCell helper ────────────────────────────────────────────────────────────

function DateCell({ value }: { value?: Date | string | null }) {
  const utc = formatShortUTC(value);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default">
          {formatDate(value)}
          {utc && (
            <span className="ml-1.5 text-[10px] text-muted-foreground/60">
              {utc}
            </span>
          )}
        </span>
      </TooltipTrigger>
      {formatShortUTC(value) && (
        <TooltipContent side="top">
          <div className="text-xs">{formatDateUTC(value)}</div>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

export default function FindingDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useTranslation();
  const findingId = params.id as string;

  const [finding, setFinding] = useState<FindingResponseDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const fetchFinding = async () => {
      if (!findingId) return;
      try {
        setLoading(true);
        setError(null);
        const response = await api.findings.findingsControllerFindOne({
          id: findingId,
        });
        setFinding(response || null);
        setDrawerOpen(true);
      } catch (err) {
        console.error("Failed to fetch finding:", err);
        setError(err instanceof Error ? err.message : "Failed to load finding");
      } finally {
        setLoading(false);
      }
    };
    fetchFinding();
  }, [findingId]);

  const handleSave = async (data: FindingDrawerSaveData) => {
    if (!finding) return;
    try {
      setIsUpdating(true);
      await api.findings.findingsControllerBulkUpdate({
        bulkUpdateFindingsDto: {
          ids: [finding.id],
          status: data.status,
          severity: data.severity,
          comment: data.comment,
        },
      });
      const updated = await api.findings.findingsControllerFindOne({
        id: finding.id,
      });
      setFinding(updated);
      toast.success(t("findings.updated"));
    } catch (err) {
      console.error("Failed to update finding:", err);
      toast.error(
        err instanceof Error ? err.message : t("findings.failedToUpdate"),
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const summary = useMemo(() => {
    if (!finding) return null;
    const confidence = formatConfidence(finding.confidence);
    return {
      confidence,
      historyCount: finding.history?.length || 0,
      firstDetected: formatDate(finding.firstDetectedAt || finding.detectedAt),
      lastDetected: formatDate(finding.lastDetectedAt || finding.detectedAt),
      lastSeenRelative: formatRelative(
        finding.lastDetectedAt || finding.detectedAt,
      ),
    };
  }, [finding]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner size="lg" label={t("findings.detail.loading")} />
      </div>
    );
  }

  if (error || !finding) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <DetailBackButton fallbackHref="/discovery" />
          <div>
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
              {t("findings.detail.notAvailable")}
            </h1>
            <p className="text-muted-foreground">
              {error || t("findings.detail.couldntLoad")}
            </p>
          </div>
        </div>
        <EmptyState
          icon={ShieldAlert}
          title={t("findings.detail.couldntFetch")}
          description={t("findings.detail.tryAgain")}
          action={{
            label: t("findings.detail.backToDiscovery"),
            onClick: () => router.push("/discovery"),
          }}
          secondaryAction={{
            label: t("findings.detail.goBack"),
            onClick: () => router.back(),
          }}
        />
      </div>
    );
  }

  const severityBadgeValue = toSeverityBadgeValue(finding.severity);
  const severityColor = FINDING_SEVERITY_COLOR_BY_LEVEL[severityBadgeValue];
  const statusBadgeValue = toStatusBadgeValue(finding.status);
  const detectorLabel =
    detectorLabels[finding.detectorType] ||
    (finding.detectorType
      ? formatEnumLabel(finding.detectorType)
      : t("findings.detail.detectedIssue"));
  const assetLabel =
    finding.asset?.name ||
    finding.asset?.externalUrl ||
    finding.location?.path ||
    finding.assetId ||
    t("assets.detail.unknownSource");
  const sourceLabel =
    finding.source?.name ||
    finding.sourceId ||
    t("assets.detail.unknownSource");
  const sourceType = finding.source?.type ?? "filesystem";
  const confidence = summary?.confidence || { percent: 0, label: "0%" };
  const history = finding.history ?? [];
  const sourceHref =
    finding.source?.id || finding.sourceId
      ? `/sources/${finding.source?.id || finding.sourceId}`
      : null;
  const assetHref =
    finding.asset?.id || finding.assetId
      ? `/assets/${finding.asset?.id || finding.assetId}`
      : null;
  const runnerHref = finding.runnerId ? `/scans/${finding.runnerId}` : null;

  const wrapperClass = cn(
    "space-y-6 transition-[padding] duration-200",
    drawerOpen ? "lg:pr-[420px]" : "",
  );

  return (
    <div className={wrapperClass}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <DetailBackButton fallbackHref="/discovery" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
                {t("findings.detail.title")}
              </h1>
              <SeverityBadge severity={severityBadgeValue}>
                {finding.severity?.toString() || "INFO"}
              </SeverityBadge>
              <StatusBadge status={statusBadgeValue}>
                {finding.status?.toString().replace("_", " ") || "OPEN"}
              </StatusBadge>
            </div>
            <p className="text-muted-foreground">
              {detectorLabel} •{" "}
              {finding.findingType || t("findings.detail.detectedIssue")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDrawerOpen((prev) => !prev)}
            aria-label={
              drawerOpen
                ? t("findings.detail.closeDetails")
                : t("findings.detail.openDetails")
            }
          >
            {drawerOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* ── Summary card ── */}
      <Card className="relative overflow-hidden bg-gradient-to-br from-slate-50 to-white dark:from-slate-950/60 dark:to-slate-900/70">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {finding.detectorType || t("findings.detail.detectedIssue")}
            </Badge>
            <Badge variant="outline">
              {finding.category || t("findings.detail.uncategorized")}
            </Badge>
            <Badge variant="outline">
              {finding.findingType || t("findings.detail.findingType")}
            </Badge>
          </div>
          <CardTitle className="text-xl">
            {finding.findingType || t("findings.detail.detectedIssue")}
          </CardTitle>
          {finding.comment && (
            <CardDescription>{finding.comment}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="h-4 w-4" />
              {t("findings.detail.confidence")}
            </div>
            <div className="text-2xl font-semibold">{confidence.label}</div>
            <Progress value={confidence.percent} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {t("findings.detail.firstDetected")}
            </div>
            <div className="text-lg font-semibold">
              {summary?.firstDetected}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("findings.detail.lastSeen", {
                relative: summary?.lastSeenRelative || "—",
              })}
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Layers className="h-4 w-4" />
              {t("findings.detail.historyEntries")}
            </div>
            <div className="text-2xl font-semibold">
              {summary?.historyCount ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("findings.detail.trackedAcrossRuns")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Matched content ── */}
      <MatchedContentBlock
        severity={severityBadgeValue}
        matchedContent={finding.matchedContent}
        redactedContent={finding.redactedContent}
        contextBefore={finding.contextBefore}
        contextAfter={finding.contextAfter}
      />

      {/* ── Extracted data (CUSTOM detector only) ── */}
      {finding.detectorType === "CUSTOM" && (
        <FindingExtractionCard findingId={finding.id} />
      )}

      {/* ── Detection signals (built-in detectors) ── */}
      {finding.detectorType !== "CUSTOM" && (
        <FindingMetadataCard
          detectorType={finding.detectorType}
          metadata={finding.metadata}
        />
      )}

      {/* ── Details + Asset/Source ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("findings.detail.title")}</CardTitle>
            <CardDescription>
              {t("findings.detail.coreMetadata")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-56">
                      {t("findings.detail.field")}
                    </TableHead>
                    <TableHead>{t("findings.detail.value")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-muted-foreground">
                      {t("common.category")}
                    </TableCell>
                    <TableCell>{finding.category}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">
                      {t("findings.detail.detectedIssue")}
                    </TableCell>
                    <TableCell>{detectorLabel}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">
                      {t("findings.detail.location")}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm break-all">
                        {finding.location?.path ||
                          t("findings.detail.unknownPath")}
                      </div>
                      {finding.location?.description && (
                        <div className="mt-0.5 text-xs text-foreground/80">
                          {finding.location.description}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        Line {finding.location?.line ?? "—"} • Column{" "}
                        {finding.location?.start ??
                          finding.location?.column ??
                          "—"}
                        -
                        {finding.location?.end ??
                          finding.location?.column ??
                          "—"}
                      </div>
                    </TableCell>
                  </TableRow>
                  {finding.comment && (
                    <TableRow>
                      <TableCell className="text-muted-foreground">
                        {t("findings.detail.notes")}
                      </TableCell>
                      <TableCell className="text-sm">
                        {finding.comment}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell className="text-muted-foreground">
                      {t("findings.detail.firstDetectedLabel")}
                    </TableCell>
                    <TableCell>
                      <DateCell
                        value={finding.firstDetectedAt || finding.detectedAt}
                      />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">
                      {t("findings.detail.lastDetected")}
                    </TableCell>
                    <TableCell>
                      <DateCell
                        value={finding.lastDetectedAt || finding.detectedAt}
                      />
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-muted-foreground">
                      {t("findings.detail.resolvedAt")}
                    </TableCell>
                    <TableCell>
                      {finding.resolvedAt ? (
                        <DateCell value={finding.resolvedAt} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("findings.detail.assetSource")}</CardTitle>
            <CardDescription>
              {t("findings.detail.assetSourceDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-dashed border-border/60 bg-muted/40 p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <SourceIcon source={sourceType} size="sm" />
                {t("common.source")}
              </div>
              {sourceHref ? (
                <Link
                  href={sourceHref}
                  className="mt-2 block text-base font-semibold underline-offset-4 hover:underline break-words"
                >
                  {sourceLabel}
                </Link>
              ) : (
                <div className="mt-2 text-base font-semibold break-words">
                  {sourceLabel}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {finding.source?.type || t("findings.detail.unknownType")}
              </div>
            </div>
            <Separator />
            <div className="rounded-md border border-dashed border-border/60 bg-muted/40 p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {t("findings.detail.sourceAsset")}
              </div>
              {assetHref ? (
                <Link
                  href={assetHref}
                  className="mt-2 block text-base font-semibold underline-offset-4 hover:underline break-words"
                >
                  {assetLabel}
                </Link>
              ) : (
                <div className="mt-2 text-base font-semibold break-words">
                  {assetLabel}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {finding.asset?.assetType ||
                  finding.asset?.sourceType ||
                  t("findings.detail.unknownAssetType")}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── History ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("findings.detail.history")}</CardTitle>
          <CardDescription>{t("findings.detail.historyDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <EmptyState
              icon={Clock}
              title={t("findings.detail.noHistory")}
              description={t("findings.detail.noHistoryHint")}
            />
          ) : (
            <div className="max-h-[70vh] overflow-auto rounded-[4px] bg-white dark:bg-card">
              <Table className="min-w-[680px]">
                <TableHeader className="sticky top-0 z-20 bg-white/95 dark:bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-card/80">
                  <TableRow>
                    <TableHead className="bg-white/95 text-[10px] uppercase tracking-[0.14em] text-muted-foreground dark:bg-card/95">
                      {t("findings.detail.historyTimestamp")}
                    </TableHead>
                    <TableHead className="bg-white/95 text-[10px] uppercase tracking-[0.14em] text-muted-foreground dark:bg-card/95">
                      {t("findings.detail.historyEvent")}
                    </TableHead>
                    <TableHead className="bg-white/95 text-[10px] uppercase tracking-[0.14em] text-muted-foreground dark:bg-card/95">
                      {t("findings.detail.historyStatus")}
                    </TableHead>
                    <TableHead className="bg-white/95 text-[10px] uppercase tracking-[0.14em] text-muted-foreground dark:bg-card/95">
                      {t("findings.detail.historyScan")}
                    </TableHead>
                    <TableHead className="bg-white/95 text-[10px] uppercase tracking-[0.14em] text-muted-foreground dark:bg-card/95">
                      {t("findings.detail.historyNotes")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((entry: FindingHistoryEntry, index: number) => {
                    const utc = formatShortUTC(entry.timestamp);
                    return (
                      <TableRow
                        key={`${entry.timestamp}-${index}`}
                        className="align-top"
                      >
                        <TableCell className="py-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="cursor-default">
                                <div className="text-sm">
                                  {formatDate(entry.timestamp)}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {formatRelative(entry.timestamp)}
                                </div>
                                {utc && (
                                  <div className="text-[10px] text-muted-foreground/50">
                                    {utc}
                                  </div>
                                )}
                              </div>
                            </TooltipTrigger>
                            {utc && (
                              <TooltipContent side="top">
                                <div className="text-xs">
                                  {formatDateUTC(entry.timestamp)}
                                </div>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge variant="secondary">
                            {historyEventLabels[entry.eventType] ||
                              entry.eventType}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2">
                          <StatusBadge
                            status={toStatusBadgeValue(entry.status)}
                          >
                            {entry.status?.toString().replaceAll("_", " ") ||
                              "OPEN"}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="py-2 text-xs">
                          {entry.runnerId ? (
                            <Link
                              href={`/scans/${entry.runnerId}`}
                              className="underline-offset-4 hover:underline font-mono"
                            >
                              {formatRelative(entry.timestamp)}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">
                              {t("findings.detail.manual")}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-xs text-muted-foreground">
                          {entry.changeReason || entry.changedBy || "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <FindingDetailDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        finding={{
          id: finding.id,
          status: (finding.status || "OPEN") as FindingDrawerStatus,
          severity: (finding.severity || "INFO") as FindingDrawerSeverity,
          confidence: finding.confidence,
          comment: finding.comment,
          detectedAt: finding.detectedAt,
          firstDetectedAt: finding.firstDetectedAt,
          lastDetectedAt: finding.lastDetectedAt,
          resolvedAt: finding.resolvedAt,
          runnerId: finding.runnerId,
          runnerHref,
        }}
        onSave={handleSave}
        isSaving={isUpdating}
      />
    </div>
  );
}
