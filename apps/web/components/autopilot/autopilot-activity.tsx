"use client";

import * as React from "react";
import {
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Copy,
  FlaskConical,
  FolderSearch,
  Loader2,
  Megaphone,
  Moon,
  SlidersHorizontal,
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
import { TechnicalLogViewer } from "@/components/technical-log-viewer";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@workspace/ui/lib/utils";
import { formatRelative } from "@/lib/date";

const POLL_MS = 5000;
const RUNS_PAGE = 15;

function AgentKindIcon({
  kind,
  className,
}: {
  kind: string;
  className?: string;
}) {
  if (kind === "INQUIRY") return <FolderSearch className={className} />;
  if (kind === "DREAM") return <Moon className={className} />;
  if (kind === "DUPLICATES") return <Copy className={className} />;
  if (kind === "CONFIG") return <SlidersHorizontal className={className} />;
  if (kind === "DETECTOR_AUTHOR") return <FlaskConical className={className} />;
  return <Workflow className={className} />;
}

function humanizeKind(kind: string): string {
  return kind
    .toLowerCase()
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * Flight-recorder view of autopilot cycles: a rail of runs on the left, the
 * selected run's decision feed + execution log on the right. The log has two
 * channels — Business (analyst narrative) and Technical (mechanics, prompts,
 * raw model output incl. schema-failure responses).
 */
export function AutopilotActivity({
  focusRunId,
}: {
  /** When provided, pre-selects this run on mount (deep-link from activity). */
  focusRunId?: string;
} = {}) {
  const { t } = useTranslation();
  const [runs, setRuns] = React.useState<AgentRunDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [limit, setLimit] = React.useState(RUNS_PAGE);
  const [loading, setLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    focusRunId ?? null,
  );

  React.useEffect(() => {
    if (focusRunId) setSelectedId(focusRunId);
  }, [focusRunId]);
  const [detail, setDetail] = React.useState<AgentRunDetailDto | null>(null);
  const [logs, setLogs] = React.useState<AgentLogDto[]>([]);
  const [channel, setChannel] = React.useState<"BUSINESS" | "TECHNICAL">("BUSINESS");

  const loadRuns = React.useCallback(async () => {
    try {
      const res = await api.autopilot.autopilotControllerListRuns({ limit });
      setRuns(res.items);
      setTotal(res.total);
      setSelectedId((current) => current ?? res.items[0]?.id ?? null);
    } catch {
      // transient — next poll retries
    } finally {
      setLoading(false);
    }
  }, [limit]);

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
  const STATUS_META: Record<string, { dot: string; label: string }> = React.useMemo(
    () => ({
      PENDING: {
        dot: "bg-amber-500",
        label: t("investigations.autopilot.activity.statusPending"),
      },
      RUNNING: {
        dot: "bg-emerald-500 animate-pulse",
        label: t("investigations.autopilot.activity.statusRunning"),
      },
      COMPLETED: {
        dot: "bg-emerald-500",
        label: t("investigations.autopilot.activity.statusCompleted"),
      },
      FAILED: {
        dot: "bg-red-500",
        label: t("investigations.autopilot.activity.statusFailed"),
      },
      SKIPPED: {
        dot: "bg-stone-400",
        label: t("investigations.autopilot.activity.statusSkipped"),
      },
      CANCELLED: {
        dot: "bg-stone-400",
        label: t("investigations.autopilot.activity.statusCancelled"),
      },
    }),
    [t],
  );

  const agentKindLabel = React.useCallback(
    (kind: string) => {
      switch (kind) {
        case "INQUIRY": return t("investigations.autopilot.activity.agentInquiry");
        case "CASE": return t("investigations.autopilot.activity.agentCase");
        case "DREAM": return t("investigations.autopilot.activity.agentDream");
        case "DUPLICATES": return t("investigations.autopilot.activity.agentDuplicates");
        default: return humanizeKind(kind);
      }
    },
    [t],
  );

  const hasActive = runs.some((r) => r.status === "RUNNING" || r.status === "PENDING");
  React.useEffect(() => {
    if (!hasActive) return;
    const pollId = setInterval(() => {
      void loadRuns();
      if (selectedId) void loadDetail(selectedId);
    }, POLL_MS);
    return () => clearInterval(pollId);
  }, [hasActive, selectedId, loadRuns, loadDetail]);

  const shownLogs = logs.filter((l) => l.channel === channel);

  const technicalEntries = React.useMemo(
    () =>
      shownLogs.map((l) => ({
        id: l.id,
        timestamp: new Date(l.createdAt).toLocaleTimeString(),
        level: l.level,
        message: l.message,
        payload: l.payload,
      })),
    [shownLogs],
  );

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />{t("investigations.autopilot.activity.loading")}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title={t("investigations.autopilot.activity.emptyTitle")}
        description={t("investigations.autopilot.activity.emptyDesc")}
      />
    );
  }

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
                  <AgentKindIcon
                    kind={run.agentKind}
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="font-mono text-[11px] uppercase tracking-wide">
                    {agentKindLabel(run.agentKind)}
                  </span>
                  {run.trigger === "manual" && (
                    <Badge
                      variant="outline"
                      className="ml-auto border-[#d97706]/50 px-1 text-[9px] uppercase tracking-wider text-[#d97706]"
                    >
                      {t("investigations.autopilot.activity.labelSteered")}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {run.summary ?? run.error ?? STATUS_META[run.status]?.label}
                </p>
                <p className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground/70">
                  {formatRelative(run.createdAt)} · {t("investigations.autopilot.activity.decisionCount", { count: run.decisionCount })}
                </p>
              </button>
            </li>
          );
        })}
        {runs.length < total && (
          <li>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setLimit((l) => l + RUNS_PAGE)}
            >
              {t("investigations.autopilot.activity.loadMore", {
                count: total - runs.length,
              })}
            </Button>
          </li>
        )}
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
                {agentKindLabel(detail.agentKind)}
              </p>
              <Badge variant="outline" className="text-[10px] uppercase">
                {STATUS_META[detail.status]?.label ?? detail.status}
              </Badge>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {detail.trigger === "manual" ? t("investigations.autopilot.activity.labelManualRun") : t("investigations.autopilot.activity.labelAfterScan")} ·{" "}
                {formatRelative(detail.createdAt)}
                {detail.attempts > 1 ? ` · ${t("investigations.autopilot.activity.labelAttempt", { count: detail.attempts })}` : ""}
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
                {t("investigations.autopilot.activity.decisions")}
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
                {t("investigations.autopilot.activity.executionLog")}
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
                    {c === "BUSINESS" ? t("investigations.autopilot.activity.logBusiness") : t("investigations.autopilot.activity.logTechnical")}
                  </button>
                ))}
              </div>
            </div>

            {shownLogs.length === 0 ? (
              <p className="rounded-[4px] border border-dashed border-border px-4 py-4 text-center text-xs text-muted-foreground">
                {t("investigations.autopilot.activity.noLogEntries", { channel: channel.toLowerCase() })}
              </p>
            ) : channel === "TECHNICAL" ? (
              <TechnicalLogViewer
                entries={technicalEntries}
                maxHeight="max-h-[420px]"
              />
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
          <ChevronRight className="h-4 w-4" />{t("investigations.autopilot.activity.selectCycle")}
        </div>
      )}
    </div>
  );
}

function DecisionCard({ decision }: { decision: AgentDecisionDto }) {
  const { t } = useTranslation();

  const OUTCOME_META: Record<string, { className: string; icon: React.ReactNode; label: string }> = React.useMemo(
    () => ({
      APPLIED: {
        className: "border-emerald-600/50 text-emerald-600",
        icon: <CheckCircle2 className="h-3 w-3" />,
        label: t("investigations.autopilot.activity.outcomeApplied"),
      },
      SKIPPED_OBSERVE_ONLY: {
        className: "border-stone-400/50 text-stone-500",
        icon: <CircleDashed className="h-3 w-3" />,
        label: t("investigations.autopilot.activity.outcomeSkippedObserveOnly"),
      },
      FAILED: {
        className: "border-red-600/50 text-red-600",
        icon: <XCircle className="h-3 w-3" />,
        label: t("investigations.autopilot.activity.outcomeFailed"),
      },
    }),
    [t],
  );

  const actionLabel = React.useCallback(
    (action: string): string => {
      const labels: Record<string, string> = {
        CREATE_INQUIRY: t("investigations.autopilot.activity.actions.CREATE_INQUIRY"),
        UPDATE_INQUIRY: t("investigations.autopilot.activity.actions.UPDATE_INQUIRY"),
        ENRICH_INQUIRY_MATCHERS: t("investigations.autopilot.activity.actions.ENRICH_INQUIRY_MATCHERS"),
        SIGNAL_CASE_READY: t("investigations.autopilot.activity.actions.SIGNAL_CASE_READY"),
        CREATE_CASE: t("investigations.autopilot.activity.actions.CREATE_CASE"),
        UPDATE_CASE: t("investigations.autopilot.activity.actions.UPDATE_CASE"),
        ADD_HYPOTHESIS: t("investigations.autopilot.activity.actions.ADD_HYPOTHESIS"),
        UPDATE_HYPOTHESIS: t("investigations.autopilot.activity.actions.UPDATE_HYPOTHESIS"),
        ADD_EVIDENCE: t("investigations.autopilot.activity.actions.ADD_EVIDENCE"),
        ATTACH_FINDINGS: t("investigations.autopilot.activity.actions.ATTACH_FINDINGS"),
        ADD_NOTE: t("investigations.autopilot.activity.actions.ADD_NOTE"),
        ADD_THREAD_ENTRY: t("investigations.autopilot.activity.actions.ADD_THREAD_ENTRY"),
        CREATE_EDGE: t("investigations.autopilot.activity.actions.CREATE_EDGE"),
        REMOVE_EDGE: t("investigations.autopilot.activity.actions.REMOVE_EDGE"),
        LINK_SUPPORT: t("investigations.autopilot.activity.actions.LINK_SUPPORT"),
        CHANGE_STATUS: t("investigations.autopilot.activity.actions.CHANGE_STATUS"),
        LINK_INQUIRY: t("investigations.autopilot.activity.actions.LINK_INQUIRY"),
        CONSOLIDATE_MEMORY: t("investigations.autopilot.activity.actions.CONSOLIDATE_MEMORY"),
        LINK_DUPLICATE: t("investigations.autopilot.activity.actions.LINK_DUPLICATE"),
        UPDATE_CLUSTER: t("investigations.autopilot.activity.actions.UPDATE_CLUSTER"),
        NO_ACTION: t("investigations.autopilot.activity.actions.NO_ACTION"),
      };
      return labels[action] ?? action.charAt(0).toUpperCase() + action.slice(1).toLowerCase().replace(/_/g, " ");
    },
    [t],
  );

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
          {meta.label}
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
            {t("investigations.autopilot.activity.payload")}
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
  const { t } = useTranslation();
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      {t("investigations.autopilot.activity.labelRefresh")}
    </Button>
  );
}
