"use client";

import * as React from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  FolderSearch,
  Loader2,
  Megaphone,
  Terminal,
  Workflow,
  XCircle,
} from "lucide-react";
import {
  api,
  type AgentDecisionDto,
  type AgentLogDto,
  type AgentRunDetailDto,
  type AgentRunDto,
} from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { cn } from "@workspace/ui/lib/utils";
import { formatRelative } from "@/lib/date";

const POLL_MS = 5000;

const STATUS_META: Record<string, { dot: string; label: string }> = {
  PENDING: { dot: "bg-stone-400", label: "Pending" },
  RUNNING: { dot: "bg-amber-500 animate-pulse", label: "Running" },
  COMPLETED: { dot: "bg-green-600", label: "Completed" },
  FAILED: { dot: "bg-red-600", label: "Failed" },
  SKIPPED: { dot: "bg-stone-300", label: "Skipped" },
};

const OUTCOME_META: Record<string, { icon: React.ReactNode; className: string }> = {
  APPLIED: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    className: "border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400",
  },
  SKIPPED_OBSERVE_ONLY: {
    icon: <CircleDashed className="h-3.5 w-3.5" />,
    className: "border-border bg-muted/40 text-muted-foreground",
  },
  FAILED: {
    icon: <XCircle className="h-3.5 w-3.5" />,
    className: "border-red-600/40 bg-red-600/10 text-red-700 dark:text-red-400",
  },
};

const LEVEL_COLOR: Record<string, string> = {
  DEBUG: "text-stone-400",
  INFO: "text-emerald-400",
  WARN: "text-amber-400",
  ERROR: "text-red-400",
};

function actionLabel(action: string): string {
  return action.replaceAll("_", " ").toLowerCase();
}

/**
 * Flight-recorder view of autopilot cycles: a rail of runs on the left, the
 * selected run's decision feed + execution log on the right. The log has two
 * channels — Business (analyst narrative) and Technical (mechanics, prompts,
 * raw model output incl. schema-failure responses).
 */
export function AutopilotActivity() {
  const [runs, setRuns] = React.useState<AgentRunDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<AgentRunDetailDto | null>(null);
  const [logs, setLogs] = React.useState<AgentLogDto[]>([]);
  const [channel, setChannel] = React.useState<"BUSINESS" | "TECHNICAL">("BUSINESS");

  const loadRuns = React.useCallback(async () => {
    try {
      const res = await api.autopilot.autopilotControllerListRuns({ limit: 50 });
      setRuns(res.items);
      setSelectedId((current) => current ?? res.items[0]?.id ?? null);
    } catch {
      // transient — next poll retries
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = React.useCallback(async (id: string) => {
    try {
      const [run, logRes] = await Promise.all([
        api.autopilot.autopilotControllerGetRun({ id }),
        api.autopilot.autopilotControllerListLogs({ id }),
      ]);
      setDetail(run);
      setLogs(logRes.items);
    } catch {
      // run may have been deleted; rail refresh will reconcile
    }
  }, []);

  React.useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  React.useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else {
      setDetail(null);
      setLogs([]);
    }
  }, [selectedId, loadDetail]);

  // Live-follow while anything is in flight.
  const hasActive = runs.some((r) => r.status === "RUNNING" || r.status === "PENDING");
  React.useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => {
      void loadRuns();
      if (selectedId) void loadDetail(selectedId);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [hasActive, selectedId, loadRuns, loadDetail]);

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading autopilot activity…
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="No autopilot cycles yet"
        description="Cycles appear here after a scan finishes with autopilot enabled, or when you run the autopilot manually."
      />
    );
  }

  const shownLogs = logs.filter((l) => l.channel === channel);

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      {/* ── Cycle rail ── */}
      <ol className="space-y-2 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
        {runs.map((run) => {
          const meta = STATUS_META[run.status] ?? STATUS_META.PENDING!;
          const selected = run.id === selectedId;
          return (
            <li key={run.id}>
              <button
                onClick={() => setSelectedId(run.id)}
                className={cn(
                  "w-full rounded-[4px] border-2 bg-card px-3 py-2.5 text-left transition-colors",
                  selected
                    ? "border-foreground/50 shadow-[2px_2px_0_var(--color-border)]"
                    : "border-border hover:border-foreground/30",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
                  {run.agentKind === "INQUIRY" ? (
                    <FolderSearch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Workflow className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="font-mono text-[11px] uppercase tracking-wide">
                    {run.agentKind === "INQUIRY" ? "Inquiry agent" : "Case agent"}
                  </span>
                  {run.trigger === "manual" && (
                    <Badge
                      variant="outline"
                      className="ml-auto border-[#d97706]/50 px-1 text-[9px] uppercase tracking-wider text-[#d97706]"
                    >
                      steered
                    </Badge>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {run.summary ?? run.error ?? STATUS_META[run.status]?.label}
                </p>
                <p className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground/70">
                  {formatRelative(run.createdAt)} · {run.decisionCount} decision
                  {run.decisionCount === 1 ? "" : "s"}
                </p>
              </button>
            </li>
          );
        })}
      </ol>

      {/* ── Run detail ── */}
      {detail ? (
        <div className="min-w-0 space-y-4">
          <div className="rounded-[4px] border-2 border-border bg-card px-4 py-3 shadow-[0_1px_3px_rgba(28,25,23,0.04)]">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  (STATUS_META[detail.status] ?? STATUS_META.PENDING!).dot,
                )}
              />
              <p className="font-serif text-base font-black uppercase tracking-[0.03em]">
                {detail.agentKind === "INQUIRY" ? "Inquiry agent" : "Case agent"}
              </p>
              <Badge variant="outline" className="text-[10px] uppercase">
                {STATUS_META[detail.status]?.label ?? detail.status}
              </Badge>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {detail.trigger === "manual" ? "manual run" : "after scan"} ·{" "}
                {formatRelative(detail.createdAt)}
                {detail.attempts > 1 ? ` · attempt ${detail.attempts}` : ""}
              </span>
            </div>
            {detail.instruction && (
              <blockquote className="mt-2 border-l-2 border-[#d97706] bg-[#d97706]/5 px-3 py-2 text-sm italic">
                <Megaphone className="mr-1.5 inline h-3.5 w-3.5 text-[#d97706]" />
                {detail.instruction}
              </blockquote>
            )}
            {detail.summary && (
              <p className="mt-2 text-sm text-muted-foreground">{detail.summary}</p>
            )}
            {detail.error && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{detail.error}</p>
            )}
          </div>

          {/* Decisions */}
          {detail.decisions.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Decisions
              </h3>
              {detail.decisions.map((d) => (
                <DecisionCard key={d.id} decision={d} />
              ))}
            </section>
          )}

          {/* Log */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                Execution log
              </h3>
              <div className="ml-auto flex rounded-[4px] border-2 border-border p-0.5">
                {(["BUSINESS", "TECHNICAL"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setChannel(c)}
                    className={cn(
                      "rounded-[2px] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                      channel === c
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {c === "BUSINESS" ? "Business" : "Technical"}
                  </button>
                ))}
              </div>
            </div>

            {shownLogs.length === 0 ? (
              <p className="rounded-[4px] border border-dashed border-border px-4 py-4 text-center text-xs text-muted-foreground">
                No {channel.toLowerCase()} log entries for this run.
              </p>
            ) : channel === "TECHNICAL" ? (
              <div className="max-h-[420px] overflow-y-auto rounded-[4px] border-2 border-stone-700 bg-stone-900 px-3 py-2 font-mono text-[11px] leading-relaxed text-stone-200">
                {shownLogs.map((l) => (
                  <div key={l.id} className="py-0.5">
                    <span className="text-stone-500">
                      {new Date(l.createdAt).toLocaleTimeString()}{" "}
                    </span>
                    <span className={LEVEL_COLOR[l.level] ?? "text-stone-300"}>
                      [{l.level}]
                    </span>{" "}
                    <span className="whitespace-pre-wrap break-words">{l.message}</span>
                    {l.payload && (
                      <details className="ml-5 mt-0.5">
                        <summary className="cursor-pointer text-stone-500 hover:text-stone-300">
                          <Terminal className="mr-1 inline h-3 w-3" />
                          payload
                        </summary>
                        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-stone-950 p-2 text-[10px] text-stone-300">
                          {JSON.stringify(l.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <ol className="space-y-1.5">
                {shownLogs.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-start gap-2 rounded-[4px] border border-border bg-card px-3 py-2 text-sm"
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                        l.level === "ERROR"
                          ? "bg-red-500"
                          : l.level === "WARN"
                            ? "bg-amber-500"
                            : "bg-stone-300",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="break-words">{l.message}</p>
                      <p className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
                        {formatRelative(l.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
          <ChevronRight className="h-4 w-4" /> Select a cycle to inspect it.
        </div>
      )}
    </div>
  );
}

function DecisionCard({ decision }: { decision: AgentDecisionDto }) {
  const meta = OUTCOME_META[decision.outcome] ?? OUTCOME_META.APPLIED!;
  return (
    <div className="rounded-[4px] border-2 border-border bg-card px-3 py-2.5 shadow-[0_1px_3px_rgba(28,25,23,0.04)]">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide",
            meta.className,
          )}
        >
          {meta.icon}
          {decision.outcome === "SKIPPED_OBSERVE_ONLY" ? "observe only" : decision.outcome.toLowerCase()}
        </span>
        <span className="text-sm font-medium capitalize">{actionLabel(decision.action)}</span>
        {decision.entityType && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {decision.entityType}
            {decision.entityId ? ` · ${decision.entityId.slice(0, 8)}…` : ""}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">{decision.rationale}</p>
      {decision.payload && Object.keys(decision.payload).length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground">
            payload
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[10px]">
            {JSON.stringify(decision.payload, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

export function AutopilotRefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      Refresh
    </Button>
  );
}
