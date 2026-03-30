"use client";

import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SeverityBadge,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Shield,
  XCircle,
} from "lucide-react";
import { api, type FindingsDiscoveryResponseDto } from "@workspace/api-client";
import { useRouter } from "next/navigation";
import { cn } from "@workspace/ui/lib/utils";
import { FINDING_SEVERITY_COLOR_BY_LEVEL } from "@workspace/ui/lib/finding-severity";
import { formatRelative } from "@/lib/date";
import { useTranslation } from "@/hooks/use-translation";

type DiscoveryWindowDays = 7 | 30 | 90;

type RecentRun = FindingsDiscoveryResponseDto["recentRuns"][number];

const severityLevels = ["critical", "high", "medium", "low", "info"] as const;

const severityAccentColor: Record<
  (typeof severityLevels)[number] | "none",
  string
> = {
  critical: "#ff2b2b",
  high: "#d97706",
  medium: "#a16207",
  low: "#0369a1",
  info: "#4b5563",
  none: "#111827",
};

const panelCardBaseClass =
  "min-w-0 rounded-[10px] panel-card bg-card p-4 sm:p-6 text-card-foreground";
const panelInsetCardClass =
  "rounded-[4px] border-2 border-border bg-background px-3 py-2";

function PanelCard({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={cn(panelCardBaseClass, className)} style={style}>
      {children}
    </div>
  );
}

function toSeverityBadgeValue(
  severity?: string | null,
): "critical" | "high" | "medium" | "low" | "info" {
  switch ((severity || "").toUpperCase()) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    case "LOW":
      return "low";
    default:
      return "info";
  }
}

function RunStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "RUNNING":
      return (
        <Spinner
          size="sm"
          className="gap-0 text-[#b7ff00] [&_svg]:size-3.5"
          data-icon="inline-start"
        />
      );
    case "COMPLETED":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "ERROR":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    default:
      return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

// Shared ghost nav button used consistently across both cards
function NavButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors border-2 border-border rounded-[4px] px-2.5 py-1.5 hover:bg-secondary/40"
    >
      {children}
    </button>
  );
}

function RunCard({ run, onClick }: { run: RecentRun; onClick: () => void }) {
  const { t: runCardT } = useTranslation();
  const isRunning = run.status === "RUNNING";
  const hasError = run.status === "ERROR";
  const ago = formatRelative(run.triggeredAt);
  const sourceName = run.source?.name ?? run.source?.id ?? "Unknown source";

  const inner = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-[4px] border-2 px-3 py-2.5 transition-all cursor-pointer hover:-translate-y-px",
        isRunning
          ? "border-[#b7ff00]/30 bg-[#0b0f0a] hover:bg-[#111a09]"
          : hasError
            ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
            : "border-border bg-background hover:bg-secondary/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <RunStatusIcon status={run.status} />
          <span
            className={cn(
              "text-[11px] font-mono uppercase tracking-[0.1em] truncate",
              isRunning
                ? "text-[#b7ff00]"
                : hasError
                  ? "text-destructive"
                  : "text-foreground",
            )}
          >
            {sourceName}
          </span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">
          {ago}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[10px] font-mono text-muted-foreground uppercase tracking-[0.1em]">
        {run.totalFindings > 0 && (
          <span>
            <span className="text-foreground font-semibold">
              {run.totalFindings}
            </span>{" "}
            {runCardT("discovery.findingsLabel")}
          </span>
        )}
        {run.assetsCreated > 0 && (
          <span>
            +
            <span className="text-foreground font-semibold">
              {run.assetsCreated}
            </span>{" "}
            {runCardT("discovery.assetsLabel")}
          </span>
        )}
        {run.assetsUpdated > 0 && (
          <span>
            ~
            <span className="text-foreground font-semibold">
              {run.assetsUpdated}
            </span>{" "}
            {runCardT("discovery.updatedLabel")}
          </span>
        )}
        {run.durationMs != null && (
          <span className="ml-auto">{(run.durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>
    </button>
  );

  if (hasError && run.errorMessage) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent
          side="left"
          className="max-w-[280px] font-mono text-xs break-words"
        >
          {run.errorMessage}
        </TooltipContent>
      </Tooltip>
    );
  }

  return inner;
}

export default function DiscoveryPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [windowDays, setWindowDays] = useState("30");
  const [overview, setOverview] = useState<FindingsDiscoveryResponseDto | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const windowDaysValue: DiscoveryWindowDays =
    windowDays === "7" ? 7 : windowDays === "90" ? 90 : 30;

  useEffect(() => {
    const fetchOverview = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response =
          await api.findings.findingsControllerGetDiscoveryOverview({
            windowDays: windowDaysValue,
          });
        setOverview(response);
      } catch (err) {
        console.error("Failed to fetch discovery overview:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load discovery overview",
        );
        setOverview(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchOverview();
  }, [windowDaysValue]);

  const totals = overview?.totals;
  const severityCounts = totals?.bySeverity ?? {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const statusCounts = totals?.byStatus ?? {
    open: 0,
    falsePositive: 0,
    resolved: 0,
    ignored: 0,
  };
  const newActivity = overview?.activity ?? { today: 0, week: 0, month: 0 };
  const totalFindings = totals?.total ?? 0;
  const recentRuns = overview?.recentRuns ?? [];
  const runningCount = recentRuns.filter((r) => r.status === "RUNNING").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
              Overview
            </h1>
            <p className="text-destructive">{t("discovery.errorPrefix", { message: error })}</p>
          </div>
          <Button onClick={() => window.location.reload()}>{t("discovery.retry")}</Button>
        </div>
      </div>
    );
  }

  const criticalHigh = severityCounts.critical + severityCounts.high;
  const topAssets = overview?.topAssets ?? [];
  const attentionLevel =
    severityLevels.find((severity) => severityCounts[severity] > 0) ?? "none";
  const attentionCount =
    attentionLevel === "none" ? 0 : severityCounts[attentionLevel];
  const attentionCardBackground = severityAccentColor[attentionLevel];
  const attentionLabelBySeverity: Record<
    (typeof severityLevels)[number] | "none",
    string
  > = {
    critical: t("discovery.criticalFindings"),
    high: t("discovery.highFindings"),
    medium: t("discovery.mediumFindings"),
    low: t("discovery.lowFindings"),
    info: t("discovery.infoFindings"),
    none: t("discovery.noFindings"),
  };
  const attentionLabel = attentionLabelBySeverity[attentionLevel];
  const attentionSummary =
    attentionLevel === "critical" || attentionLevel === "high"
      ? t("discovery.requireReview", { count: criticalHigh })
      : attentionLevel === "none"
        ? t("discovery.noFindingsInWindow")
        : t("discovery.currentHighest", { count: attentionCount, level: attentionLevel });

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden">
      {/* ── Bento Grid ─────────────────────────────────────────── */}
      <div className="min-w-0 grid auto-rows-[minmax(120px,auto)] grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5 xl:grid-cols-12">
        {/* ── HERO: Total Findings ─── */}
        <PanelCard className="flex flex-col justify-between sm:col-span-2 sm:p-8 xl:col-span-5 xl:row-span-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-4 w-4 text-foreground" />
              <span className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground font-mono font-semibold">
                {t("discovery.securityBrief")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-mono mt-0.5">
                {t("discovery.allFindings", { days: windowDaysValue })}
              </p>
              <Select value={windowDays} onValueChange={setWindowDays}>
                <SelectTrigger className="h-7 w-[100px] text-[10px] bg-background border-2 border-border text-foreground rounded-[4px] font-mono">
                  <SelectValue placeholder="Window" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">{t("findings.window.7days")}</SelectItem>
                  <SelectItem value="30">{t("findings.window.30days")}</SelectItem>
                  <SelectItem value="90">{t("findings.window.90days")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <span
              className="text-[clamp(4rem,13vw,7.5rem)] font-bold leading-[0.78] text-foreground block tracking-[0.02em] pb-5"
              style={{ fontFamily: "var(--font-hero)" }}
            >
              {totalFindings.toLocaleString()}
            </span>
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-mono mt-1 block">
              {t("discovery.findingsToReview")}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-4 sm:grid-cols-4">
            {[
              { label: t("discovery.open"), value: statusCounts.open },
              { label: t("discovery.resolved"), value: statusCounts.resolved },
              { label: t("discovery.falsePositive"), value: statusCounts.falsePositive },
              { label: t("discovery.ignored"), value: statusCounts.ignored },
            ].map(({ label, value }) => (
              <div key={label} className={`${panelInsetCardClass} min-w-0`}>
                <span className="text-[9px] leading-tight uppercase tracking-[0.15em] text-muted-foreground font-mono block sm:text-[10px] sm:tracking-[0.2em]">
                  {label}
                </span>
                <span className="font-serif text-lg font-black text-foreground sm:text-xl">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </PanelCard>

        {/* ── SEVERITY BREAKDOWN ─── */}
        <PanelCard
          className="flex flex-col justify-between text-white sm:col-span-2 sm:p-8 xl:col-span-4 xl:row-span-2"
          style={{ backgroundColor: attentionCardBackground }}
        >
          <div className="flex items-end justify-between gap-4">
            <span className="text-[11px] uppercase tracking-[0.25em] text-white/80 font-mono font-semibold">
              {t("discovery.whatNeedsAttention")}
            </span>
            <div className="text-right">
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/70 font-mono">
                {attentionLabel}
              </span>
              <span
                className="text-3xl font-bold block leading-tight"
                style={{ fontFamily: "var(--font-hero)" }}
              >
                {attentionCount}
              </span>
            </div>
          </div>
          <div className="space-y-2.5 mt-4">
            {severityLevels.map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() =>
                  router.push(`/findings?severity=${sev.toUpperCase()}`)
                }
                className="flex items-center justify-between w-full group/sev cursor-pointer hover:translate-x-0.5 transition-transform"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-2.5 h-2.5 rounded-[2px] border border-white/40"
                    style={{
                      backgroundColor: FINDING_SEVERITY_COLOR_BY_LEVEL[sev],
                    }}
                  />
                  <span className="text-sm uppercase tracking-[0.15em] text-white/90 font-mono group-hover/sev:text-white">
                    {sev}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-2xl font-bold"
                    style={{ fontFamily: "var(--font-hero)" }}
                  >
                    {severityCounts[sev]}
                  </span>
                  <ArrowRight className="h-3 w-3 opacity-0 group-hover/sev:opacity-100 transition-opacity" />
                </div>
              </button>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-white/20">
            <p className="text-[10px] text-white/70 font-mono uppercase tracking-[0.15em]">
              {attentionSummary}
            </p>
          </div>
        </PanelCard>

        {/* ── ACTIVITY: Today/Week/Month ─── */}
        <PanelCard className="flex flex-col justify-between overflow-hidden border-[#b7ff00]/30 bg-[#0b0f0a] text-[#b7ff00] shadow-[3px_3px_0_rgba(183,255,0,0.15)] sm:shadow-[6px_6px_0_rgba(183,255,0,0.15)] sm:p-6 xl:col-span-3 xl:row-span-2">
          <span className="text-[11px] uppercase tracking-[0.25em] text-[#b7ff00]/80 font-mono font-semibold">
            {t("discovery.incoming")}
          </span>
          <div className="space-y-5 mt-4 flex-1 flex flex-col justify-center">
            <div>
              <span
                className="text-4xl font-bold block leading-[0.85] sm:text-5xl"
                style={{ fontFamily: "var(--font-hero)" }}
              >
                {newActivity.today}
              </span>
              <span className="text-xs uppercase tracking-[0.15em] text-[#b7ff00]/70 font-mono mt-1 block">
                {t("discovery.newToday")}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
              <div className="min-w-0">
                <span
                  className="text-xl font-bold block sm:text-2xl"
                  style={{ fontFamily: "var(--font-hero)" }}
                >
                  {newActivity.week}
                </span>
                <span className="text-[10px] text-[#b7ff00]/60 uppercase tracking-wide font-mono">
                  {t("discovery.thisWeek")}
                </span>
              </div>
              <div className="min-w-0">
                <span
                  className="text-xl font-bold block sm:text-2xl"
                  style={{ fontFamily: "var(--font-hero)" }}
                >
                  {newActivity.month}
                </span>
                <span className="text-[10px] text-[#b7ff00]/60 uppercase tracking-wide font-mono">
                  {t("discovery.thisMonth")}
                </span>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-[#b7ff00]/40 uppercase tracking-[0.15em] font-mono mt-2">
            {t("discovery.basedOnTimestamps")}
          </p>
        </PanelCard>

        {/* ── TOP ASSETS ─── */}
        <PanelCard className="flex flex-col sm:col-span-2 xl:col-span-8 overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="font-serif text-lg font-black uppercase tracking-[0.06em] text-foreground">
                {t("discovery.whereRiskClusters")}
              </h3>
              <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-[0.15em]">
                {t("discovery.assetsWithMost")}
              </p>
            </div>
            <NavButton onClick={() => router.push("/assets")}>
              {t("discovery.viewAll")} <ArrowRight className="h-3 w-3" />
            </NavButton>
          </div>
          {topAssets.length > 0 ? (
            <div className="grid gap-1.5 flex-1">
              {topAssets.slice(0, 5).map((asset, i) => {
                const lastSeen = asset.lastDetectedAt
                  ? formatRelative(asset.lastDetectedAt)
                  : null;
                const sevKey = toSeverityBadgeValue(asset.highestSeverity);
                const accent = severityAccentColor[sevKey];
                return (
                  <button
                    key={asset.assetId}
                    type="button"
                    onClick={() => router.push(`/assets/${asset.assetId}`)}
                    className="flex w-full min-w-0 cursor-pointer items-start justify-between gap-3 rounded-[4px] border-2 bg-white px-3 py-2 text-left transition-all hover:-translate-y-px hover:bg-white dark:bg-background dark:hover:bg-secondary/40"
                    style={{
                      borderColor: `${accent}33`,
                      boxShadow: `3px 3px 0 0 ${accent}33`,
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 leading-none">
                        <span
                          className="shrink-0 w-4 font-serif text-lg font-black tabular-nums"
                          style={{ color: `${accent}99` }}
                        >
                          {i + 1}
                        </span>
                        <span className="truncate text-xs font-bold text-foreground">
                          {asset.assetName}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 pl-6 text-[10px] font-mono text-muted-foreground uppercase tracking-[0.1em]">
                        <span className="truncate">
                          {asset.sourceName ||
                            asset.sourceType ||
                            asset.assetType ||
                            "—"}
                        </span>
                        <span className="shrink-0 text-border">·</span>
                        <span className="shrink-0">
                          <span className="text-foreground font-semibold">
                            {asset.totalFindings}
                          </span>{" "}
                          {t("discovery.findingsLabel")}
                        </span>
                        {lastSeen && (
                          <>
                            <span className="shrink-0 text-border">·</span>
                            <span className="shrink-0">{lastSeen}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 mt-0.5">
                      <SeverityBadge severity={sevKey}>
                        {asset.highestSeverity}
                      </SeverityBadge>
                      <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center border-2 border-dashed border-border/40 px-4 py-6 text-center rounded-[4px]">
              <div>
                <p className="text-sm text-muted-foreground font-mono uppercase tracking-[0.15em]">
                  {t("discovery.firstScan")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.push("/scans")}
                  className="mt-3 border-2 border-border text-foreground rounded-[4px] font-mono uppercase tracking-[0.1em]"
                >
                  {t("discovery.startScan")}
                </Button>
              </div>
            </div>
          )}
        </PanelCard>

        {/* ── RECENT RUNS ─── */}
        <PanelCard className="flex flex-col sm:col-span-2 xl:col-span-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-serif text-lg font-black uppercase tracking-[0.06em] text-foreground">
                {t("discovery.recentScans")}
              </h3>
              <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-[0.15em]">
                {t("discovery.last10Runs")}
                {runningCount > 0 && (
                  <span className="ml-2 text-[#b7ff00]">
                    · {t("discovery.runningCount", { count: runningCount })}
                  </span>
                )}
              </p>
            </div>
            <NavButton onClick={() => router.push("/scans")}>
              {t("discovery.allScans")} <ArrowRight className="h-3 w-3" />
            </NavButton>
          </div>
          {recentRuns.length > 0 ? (
            <div className="space-y-1.5 flex-1">
              {recentRuns.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  onClick={() => router.push(`/scans/${run.id}`)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center border-2 border-dashed border-border/40 rounded-[4px] px-4 py-6 text-center">
              <div>
                <p className="text-sm text-muted-foreground font-mono uppercase tracking-[0.15em]">
                  {t("discovery.noScansYet")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.push("/scans")}
                  className="mt-3 border-2 border-border rounded-[4px] font-mono uppercase tracking-[0.1em]"
                >
                  {t("discovery.startScan")}
                </Button>
              </div>
            </div>
          )}
        </PanelCard>

        {/* ── RESOLUTION SNAPSHOT ─── */}
        <PanelCard className="flex flex-col justify-between sm:col-span-2 xl:col-span-12">
          <span className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground font-mono font-semibold mb-4 block">
            {t("discovery.resolutionSnapshot")}
          </span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: t("discovery.open"), value: statusCounts.open },
              { label: t("discovery.resolved"), value: statusCounts.resolved },
              { label: t("discovery.falsePositive"), value: statusCounts.falsePositive },
              { label: t("discovery.ignored"), value: statusCounts.ignored },
            ].map(({ label, value }) => (
              <div key={label} className={panelInsetCardClass}>
                <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono block">
                  {label}
                </span>
                <span
                  className="text-2xl font-bold block text-foreground"
                  style={{ fontFamily: "var(--font-hero)" }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => router.push("/findings")}
            className="mt-4 text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer font-mono uppercase tracking-[0.15em]"
          >
            {t("discovery.reviewStatusMix")} <ArrowRight className="h-3 w-3" />
          </button>
        </PanelCard>
      </div>
    </div>
  );
}
