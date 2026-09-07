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
  Sparkles,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { api, type AutopilotStatsDto } from "@workspace/api-client";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { formatRelative } from "@/lib/date";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { AutopilotActivity } from "@/components/autopilot/autopilot-activity";
import { AutopilotMemory } from "@/components/autopilot/autopilot-memory";
import { RunAutopilotDialog } from "@/components/autopilot/run-autopilot-dialog";
import { HarnessActivity } from "./harness-activity";
import { SupervisorPanel } from "./supervisor/supervisor-panel";
import { HarnessAgents } from "./harness-agents";
import { HarnessBrief } from "./harness-brief";
import { HarnessConfig } from "./harness-config";
import { EmbeddingSettingsCard } from "@/components/embedding-settings-card";
import { HarnessStatTile } from "./harness-stat-tile";
import { HarnessUsage, formatCost, formatTokens } from "./harness-usage";

type View =
  | "activity"
  | "supervisor"
  | "runs"
  | "usage"
  | "agents"
  | "memory"
  | "brief"
  | "config"
  | "embedding";

const POLL_MS = 8000;

/**
 * Harness AI control plane. A mission-control header (live counters), a steer
 * trigger, and six observability surfaces: the decision activity timeline, the
 * per-run flight recorder (ReAct), the agent roster and their missions,
 * learned memory, the living system brief, and configuration.
 */
export function HarnessShell() {
  const { t } = useTranslation();
  const { settings } = useInstanceSettings();
  const [view, setView] = React.useState<View>("activity");
  const [runOpen, setRunOpen] = React.useState(false);
  const [stats, setStats] = React.useState<AutopilotStatsDto | null>(null);
  const [focusRunId, setFocusRunId] = React.useState<string | undefined>();
  const [epoch, setEpoch] = React.useState(0);
  const harnessReady = !!settings.harnessAiProviderConfigId;

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
    { value: "supervisor", label: t("harness.nav.supervisor"), icon: Bot },
    { value: "runs", label: t("harness.nav.runs"), icon: Workflow },
    { value: "usage", label: t("harness.nav.usage"), icon: BarChart3 },
    { value: "agents", label: t("harness.nav.agents"), icon: Users },
    { value: "memory", label: t("harness.nav.memory"), icon: Brain },
    { value: "brief", label: t("harness.nav.brief"), icon: BookOpen },
    { value: "config", label: t("harness.nav.config"), icon: SlidersHorizontal },
    // Embeddings sit here rather than in Settings because they are the
    // retrieval half of the same AI stack: the model chosen here is what the
    // agents' evidence lookups run against.
    { value: "embedding", label: t("harness.nav.embedding"), icon: Sparkles },
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
          </div>
        </div>
        <Button
          onClick={() => setRunOpen(true)}
          className="shrink-0"
          disabled={!harnessReady}
          title={!harnessReady ? t("harness.config.requiresAi") : undefined}
        >
          <Play className="h-3.5 w-3.5" />
          {t("harness.steer")}
        </Button>
      </div>

      {/* ── Live counters ── */}
      <StatStrip stats={stats} />

      <Tabs
        value={view}
        onValueChange={(next) => setView(next as View)}
        urlParam="tab"
        className="gap-5"
      >
        {/* ── Sub-nav ── */}
        <TabsList
          variant="line"
          className="h-auto w-full flex-wrap justify-start gap-1 border-b-2 border-border p-0"
        >
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className={cn(
                "flex-none rounded-none border-b-2 border-transparent px-3 py-2 font-mono text-[11px] uppercase tracking-wider",
                "data-[state=active]:border-[#d97706] data-[state=active]:after:opacity-0",
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Views ── */}
        <TabsContent value="supervisor">
          <SupervisorPanel />
        </TabsContent>

        <TabsContent value="activity">
          <HarnessActivity onOpenRun={openRun} />
        </TabsContent>
        <TabsContent value="runs">
          <AutopilotActivity key={`runs-${epoch}`} focusRunId={focusRunId} />
        </TabsContent>
        <TabsContent value="usage">
          <HarnessUsage />
        </TabsContent>
        <TabsContent value="agents">
          <HarnessAgents />
        </TabsContent>
        <TabsContent value="memory">
          <AutopilotMemory />
        </TabsContent>
        <TabsContent value="brief">
          <HarnessBrief key={`brief-${epoch}`} />
        </TabsContent>
        <TabsContent value="embedding">
          <EmbeddingSettingsCard />
        </TabsContent>
        <TabsContent value="config">
          <HarnessConfig />
        </TabsContent>
      </Tabs>

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
