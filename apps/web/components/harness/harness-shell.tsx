"use client";

import * as React from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  Play,
  SlidersHorizontal,
  Users,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { api, type AutopilotStatsDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { formatRelative } from "@/lib/date";
import { AutopilotActivity } from "@/components/autopilot/autopilot-activity";
import { AutopilotMemory } from "@/components/autopilot/autopilot-memory";
import { RunAutopilotDialog } from "@/components/autopilot/run-autopilot-dialog";
import { HarnessActivity } from "./harness-activity";
import { HarnessAgents } from "./harness-agents";
import { HarnessTools } from "./harness-tools";
import { HarnessBrief } from "./harness-brief";
import { HarnessConfig } from "./harness-config";
import { HarnessStatTile } from "./harness-stat-tile";
import { HarnessUsage, formatCost, formatTokens } from "./harness-usage";

type View =
  | "activity"
  | "runs"
  | "usage"
  | "agents"
  | "tools"
  | "memory"
  | "brief"
  | "config";

const POLL_MS = 8000;

/**
 * Harness AI control plane. A mission-control header (live counters), a steer
 * trigger, and six observability surfaces: the decision activity timeline, the
 * per-run flight recorder (ReAct), the capability map (tools + missions),
 * learned memory, the living system brief, and configuration.
 */
export function HarnessShell() {
  const { t } = useTranslation();
  const [view, setView] = React.useState<View>("activity");
  const [runOpen, setRunOpen] = React.useState(false);
  const [stats, setStats] = React.useState<AutopilotStatsDto | null>(null);
  const [focusRunId, setFocusRunId] = React.useState<string | undefined>();
  const [epoch, setEpoch] = React.useState(0);

  const loadStats = React.useCallback(async () => {
    try {
      setStats(await api.autopilot.autopilotControllerGetStats());
    } catch {
      // transient
    }
  }, []);

  React.useEffect(() => {
    void loadStats();
  }, [loadStats, epoch]);

  React.useEffect(() => {
    const id = setInterval(() => void loadStats(), POLL_MS);
    return () => clearInterval(id);
  }, [loadStats]);

  const openRun = React.useCallback((runId: string) => {
    setFocusRunId(runId);
    setView("runs");
  }, []);

  const tabs: { value: View; label: string; icon: LucideIcon }[] = [
    { value: "activity", label: t("harness.nav.activity"), icon: Activity },
    { value: "runs", label: t("harness.nav.runs"), icon: Workflow },
    { value: "usage", label: t("harness.nav.usage"), icon: BarChart3 },
    { value: "agents", label: t("harness.nav.agents"), icon: Users },
    { value: "tools", label: t("harness.nav.tools"), icon: Wrench },
    { value: "memory", label: t("harness.nav.memory"), icon: Brain },
    { value: "brief", label: t("harness.nav.brief"), icon: BookOpen },
    { value: "config", label: t("harness.nav.config"), icon: SlidersHorizontal },
  ];

  return (
    <div className="space-y-5">
      {/* ── Masthead ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[6px] border-2 border-border bg-card shadow-[3px_3px_0_var(--color-border)]">
            <Bot className="h-5 w-5 text-[#d97706]" />
          </span>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {t("harness.subtitle")}
            </p>
            <h1 className="font-serif text-3xl font-black uppercase tracking-[0.03em]">
              {t("harness.title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("harness.description")}
            </p>
          </div>
        </div>
        <Button onClick={() => setRunOpen(true)} className="shrink-0">
          <Play className="h-3.5 w-3.5" />
          {t("harness.steer")}
        </Button>
      </div>

      {/* ── Live counters ── */}
      <StatStrip stats={stats} />

      {/* ── Sub-nav ── */}
      <div className="flex flex-wrap items-center gap-1 border-b-2 border-border pb-px">
        {tabs.map((tab) => {
          const active = view === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => setView(tab.value)}
              className={cn(
                "-mb-[2px] inline-flex items-center gap-1.5 border-b-2 px-3 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors",
                active
                  ? "border-[#d97706] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Views ── */}
      <div>
        {view === "activity" && <HarnessActivity onOpenRun={openRun} />}
        {view === "runs" && (
          <AutopilotActivity key={`runs-${epoch}`} focusRunId={focusRunId} />
        )}
        {view === "usage" && <HarnessUsage />}
        {view === "agents" && <HarnessAgents />}
        {view === "tools" && <HarnessTools />}
        {view === "memory" && <AutopilotMemory />}
        {view === "brief" && <HarnessBrief key={`brief-${epoch}`} />}
        {view === "config" && <HarnessConfig />}
      </div>

      <RunAutopilotDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        onTriggered={() => {
          setView("runs");
          setFocusRunId(undefined);
          setEpoch((e) => e + 1);
        }}
      />
    </div>
  );
}

function StatStrip({ stats }: { stats: AutopilotStatsDto | null }) {
  const { t } = useTranslation();
  const cells: { label: string; value: React.ReactNode; accent?: boolean }[] = [
    {
      label: t("harness.stats.active"),
      value: stats?.activeRuns ?? "—",
      accent: (stats?.activeRuns ?? 0) > 0,
    },
    { label: t("harness.stats.runs24h"), value: stats?.runsLast24h ?? "—" },
    { label: t("harness.stats.applied"), value: stats?.decisionsApplied ?? "—" },
    { label: t("harness.stats.skipped"), value: stats?.decisionsSkipped ?? "—" },
    { label: t("harness.stats.failed"), value: stats?.decisionsFailed ?? "—" },
    { label: t("harness.stats.memory"), value: stats?.memoryCount ?? "—" },
    {
      label: t("harness.stats.tokens24h"),
      value: stats ? formatTokens(stats.tokensLast24h) : "—",
    },
    ...(stats?.costLast24h != null
      ? [
          {
            label: t("harness.stats.cost24h"),
            value: formatCost(stats.costLast24h),
          },
        ]
      : []),
    {
      label: t("harness.stats.brief"),
      value: stats ? stats.briefVersion : "—",
    },
    {
      label: t("harness.stats.lastActivity"),
      value: stats?.lastActivityAt
        ? formatRelative(stats.lastActivityAt)
        : t("harness.stats.never"),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((cell, i) => (
        <HarnessStatTile
          key={i}
          label={cell.label}
          value={cell.value}
          accent={cell.accent ? "emerald" : "none"}
          pulse={cell.accent}
        />
      ))}
    </div>
  );
}
