"use client";

import { nsPath } from "@/lib/ns-path";
import { type ReactNode, useEffect, useState } from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  Telescope,
  XCircle,
} from "lucide-react";
import {
  api,
  type CaseworkSummaryDto,
  type FindingsDiscoveryResponseDto,
} from "@workspace/api-client";
import { useRouter } from "next/navigation";
import { cn } from "@workspace/ui/lib/utils";
import { FINDING_SEVERITY_COLOR_BY_LEVEL } from "@workspace/ui/lib/finding-severity";
import { formatRelative } from "@/lib/date";
import { PanelCard } from "@/components/panel-card";
import { useTranslation } from "@/hooks/use-translation";
import { StatsFreshness } from "@/components/stats-freshness";
import { CaseworkCard } from "@/components/discovery/casework-card";
import { ConnectionsCanvas } from "@/components/discovery/connections-canvas";
import type { TranslationKey } from "@/i18n";

type DiscoveryWindowDays = 7 | 30 | 90;

type RecentRun = FindingsDiscoveryResponseDto["recentRuns"][number];

const severityLevels = ["critical", "high", "medium", "low", "info"] as const;

/**
 * Card background for the "what needs attention" panel.
 *
 * The swatches, badges and this background all read as the same scale, so they
 * all come from FINDING_SEVERITY_COLOR_BY_LEVEL; only the empty state, which has
 * no level, needs a colour of its own.
 */
const attentionBackground = (
  level: (typeof severityLevels)[number] | "none",
): string => (level === "none" ? "#111827" : FINDING_SEVERITY_COLOR_BY_LEVEL[level]);


function RunStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "RUNNING":
      return (
        <Spinner
          size="sm"
          className="gap-0 text-accent [&_svg]:size-3.5"
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
          ? "border-accent/30 bg-background hover:bg-accent/10"
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
                ? "text-accent"
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
        {run.findingsCreated > 0 && (
          <span>
            +
            <span className="text-foreground font-semibold">
              {run.findingsCreated}
            </span>{" "}
            {runCardT("discovery.newLabel")}
          </span>
        )}
        {run.findingsResolved > 0 && (
          <span>
            −
            <span className="text-foreground font-semibold">
              {run.findingsResolved}
            </span>{" "}
            {runCardT("discovery.resolvedLabel")}
          </span>
        )}
        {run.findingsCreated === 0 &&
          run.findingsResolved === 0 &&
          run.totalFindings > 0 && (
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
  const [windowDays, setWindowDays] = useState("7");
  const [overview, setOverview] = useState<FindingsDiscoveryResponseDto | null>(
    null,
  );
  const [casework, setCasework] = useState<CaseworkSummaryDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Bumped to re-run the fetch effect after a manual rebuild is queued.
  const [reloadToken, setReloadToken] = useState(0);

  const windowDaysValue: DiscoveryWindowDays =
    windowDays === "30" ? 30 : windowDays === "90" ? 90 : 7;

  useEffect(() => {
    const fetchOverview = async () => {
      try {
        setIsLoading(true);
        setError(null);
        // Casework is a handful of grouped counts and never fails the page: an
        // overview that renders without it is still useful, one that renders
        // without findings is not.
        const [response, caseworkSummary] = await Promise.all([
          api.findings.findingsControllerGetDiscoveryOverview({
            windowDays: windowDaysValue,
          }),
          api.cases
            .caseworkControllerSummary()
            .catch((err: unknown) => {
              console.error("Failed to fetch casework summary:", err);
              return null;
            }),
        ]);
        setOverview(response);
        setCasework(caseworkSummary);
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
  }, [windowDaysValue, reloadToken]);

  // The rebuild is a full pass over every finding, so the endpoint only queues
  // it. Poll the overview until its refreshedAt moves rather than blocking the
  // button on work that runs on a background worker.
  const handleRefreshStats = async () => {
    if (isRefreshing) return;
    const before = overview?.stats?.refreshedAt
      ? new Date(overview.stats.refreshedAt).getTime()
      : 0;
    setIsRefreshing(true);
    try {
      await api.findings.findingsControllerRefreshDiscoveryStats();
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const next =
          await api.findings.findingsControllerGetDiscoveryOverview({
            windowDays: windowDaysValue,
          });
        const after = next.stats?.refreshedAt
          ? new Date(next.stats.refreshedAt).getTime()
          : 0;
        if (after > before) {
          setOverview(next);
          return;
        }
      }
      // Timed out waiting: show whatever is current rather than spinning on.
      setReloadToken((token) => token + 1);
    } catch (err) {
      console.error("Failed to refresh discovery statistics:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const totals = overview?.totals;
  const severityCounts = totals?.bySeverity ?? {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  // `totals.byStatus` only ever counts OPEN rows (the overview filters to it),
  // so the review-state strip reads `statusMix`, which is counted across every
  // status over the same window.
  const statusMix = overview?.statusMix ?? {
    total: 0,
    open: 0,
    falsePositive: 0,
    resolved: 0,
    ignored: 0,
  };
  const reviewStates = [
    { status: "OPEN", label: t("discovery.open"), value: statusMix.open },
    {
      status: "RESOLVED",
      label: t("discovery.resolved"),
      value: statusMix.resolved,
    },
    {
      status: "FALSE_POSITIVE",
      label: t("discovery.falsePositive"),
      value: statusMix.falsePositive,
    },
    {
      status: "IGNORED",
      label: t("discovery.ignored"),
      value: statusMix.ignored,
    },
  ].filter((state, index) => index === 0 || state.value > 0);
  const newActivity = overview?.activity ?? { today: 0, week: 0, month: 0 };
  const totalFindings = totals?.total ?? 0;
  const recentRuns = overview?.recentRuns ?? [];
  const runningCount = recentRuns.filter((r) => r.status === "RUNNING").length;

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-96"
        data-testid="namespace-workspace"
        data-app-state="loading"
      >
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="space-y-6"
        data-testid="namespace-workspace"
        data-app-state="error"
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
              Overview
            </h1>
            <p className="text-destructive">
              {t("discovery.errorPrefix", { message: error })}
            </p>
          </div>
          <Button onClick={() => window.location.reload()}>
            {t("discovery.retry")}
          </Button>
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
  const attentionCardBackground = attentionBackground(attentionLevel);
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
        : t("discovery.currentHighest", {
            count: attentionCount,
            // The translated word, not the enum key — otherwise the German
            // string renders half in English.
            level: attentionLabel.toLocaleLowerCase(),
          });

  return (
    <div
      className="min-w-0 space-y-6 overflow-x-hidden"
      data-testid="namespace-workspace"
      data-app-state="ready"
    >
      {/* ── Bento Grid ─────────────────────────────────────────── */}
      <div className="min-w-0 grid auto-rows-[minmax(120px,auto)] grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5 xl:grid-cols-12">
        {/* ── HERO: Total Findings ─── */}
        <PanelCard className="flex flex-col justify-between sm:col-span-2 sm:p-8 xl:col-span-5 xl:row-span-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Telescope className="h-4 w-4 text-foreground" />
              <span className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground font-mono font-semibold">
                {t("discovery.securityBrief")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-mono mt-0.5">
                {t("discovery.allFindingsWithDays", { days: windowDaysValue })}
              </p>
              <div className="flex items-center gap-2">
                <StatsFreshness
                  refreshedAt={overview?.stats?.refreshedAt}
                  isBuilt={overview?.stats?.isBuilt}
                  source={overview?.stats?.source}
                  onRefresh={handleRefreshStats}
                  isRefreshing={isRefreshing}
                />
                <Select value={windowDays} onValueChange={setWindowDays}>
                  <SelectTrigger className="h-7 w-[100px] text-[10px] bg-background border-2 border-border text-foreground rounded-[4px] font-mono">
                    <SelectValue placeholder={t("common.window")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">
                      {t("findings.window.7days")}
                    </SelectItem>
                    <SelectItem value="30">
                      {t("findings.window.30days")}
                    </SelectItem>
                    <SelectItem value="90">
                      {t("findings.window.90days")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
          {/* Review state is bookkeeping, not the headline — one muted line,
              each segment filtering the findings list. */}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
            {reviewStates.map(({ status, label, value }, index) => (
              <span key={status} className="flex items-center gap-3">
                {index > 0 && (
                  <span aria-hidden className="text-muted-foreground/40">
                    ·
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => router.push(nsPath(`/findings?status=${status}`))}
                  className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
                >
                  <span className="font-semibold text-foreground/70">
                    {value.toLocaleString()}
                  </span>{" "}
                  {label}
                </button>
              </span>
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
                  router.push(nsPath(`/findings?severity=${sev.toUpperCase()}`))
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
                    {t(`findings.severityLabels.${sev.toUpperCase()}` as TranslationKey)}
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
        <PanelCard className="flex flex-col justify-between overflow-hidden border-accent/30 bg-foreground dark:bg-background text-accent shadow-[3px_3px_0_color-mix(in_srgb,var(--color-accent)_15%,transparent)] sm:shadow-[6px_6px_0_color-mix(in_srgb,var(--color-accent)_15%,transparent)] sm:p-6 xl:col-span-3 xl:row-span-2">
          <span className="text-[11px] uppercase tracking-[0.25em] text-accent/80 font-mono font-semibold">
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
              <span className="text-xs uppercase tracking-[0.15em] text-accent/70 font-mono mt-1 block">
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
                <span className="text-[10px] text-accent/60 uppercase tracking-wide font-mono">
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
                <span className="text-[10px] text-accent/60 uppercase tracking-wide font-mono">
                  {t("discovery.thisMonth")}
                </span>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-accent/40 uppercase tracking-[0.15em] font-mono mt-2">
            {t("discovery.basedOnTimestamps")}
          </p>
        </PanelCard>

        {/* ── CASEWORK ─── */}
        <CaseworkCard summary={casework} isLoading={isLoading} />

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
                  <span className="ml-2 text-accent">
                    · {t("discovery.runningCount", { count: runningCount })}
                  </span>
                )}
              </p>
            </div>
            <NavButton onClick={() => router.push(nsPath("/scans"))}>
              {t("discovery.allScans")} <ArrowRight className="h-3 w-3" />
            </NavButton>
          </div>
          {recentRuns.length > 0 ? (
            <div className="space-y-1.5 flex-1">
              {recentRuns.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  onClick={() => router.push(nsPath(`/scans/${run.id}`))}
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
                  onClick={() => router.push(nsPath("/scans"))}
                  className="mt-3 border-2 border-border rounded-[4px] font-mono uppercase tracking-[0.1em]"
                >
                  {t("discovery.startScan")}
                </Button>
              </div>
            </div>
          )}
        </PanelCard>

        {/* ── CONNECTIONS ─── */}
        <ConnectionsCanvas topAssets={topAssets} />
      </div>

    </div>
  );
}
