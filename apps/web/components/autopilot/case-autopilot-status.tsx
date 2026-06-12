"use client";

import * as React from "react";
import { Bot, ChevronDown, ChevronUp, Loader2, Square, X } from "lucide-react";
import { toast } from "sonner";
import { api, type AgentLogDto, type AgentRunDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";

const ACTIVE = new Set(["PENDING", "RUNNING"]);
const ACTIVE_POLL_MS = 5_000;
/** A finished run stays visible on the page for this long after it ends. */
const RESULT_TTL_MS = 30 * 60 * 1000;

/**
 * Live visibility for case-focused autopilot runs: an animated "AI is working
 * on this case" banner while a run is active (with its latest narrative line
 * and a stop button), turning into a result banner with the run summary and
 * an expandable business log when it finishes. Polls only while a run is
 * active; `refreshKey` forces an immediate re-check (e.g. right after the
 * operator queues a run).
 */
export function CaseAutopilotStatus({
  caseId,
  refreshKey,
  onFinished,
}: {
  caseId: string;
  refreshKey?: number;
  onFinished?: () => void;
}) {
  const [run, setRun] = React.useState<AgentRunDto | null>(null);
  const [liveLine, setLiveLine] = React.useState<string | null>(null);
  const [logOpen, setLogOpen] = React.useState(false);
  const [logs, setLogs] = React.useState<AgentLogDto[]>([]);
  const [dismissedId, setDismissedId] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const wasActive = React.useRef(false);

  const check = React.useCallback(async () => {
    try {
      const res = await api.autopilot.autopilotControllerListRuns({
        caseId,
        limit: 1,
      });
      const latest = res.items[0] ?? null;
      setRun(latest);

      if (latest && ACTIVE.has(latest.status)) {
        wasActive.current = true;
        // Surface the newest narrative line so the operator sees progress.
        try {
          const log = await api.autopilot.autopilotControllerListLogs({
            id: latest.id,
            channel: "BUSINESS",
          });
          setLiveLine(log.items.at(-1)?.message ?? null);
        } catch {
          /* narrative is best-effort */
        }
      } else if (latest && wasActive.current) {
        // Transition active → finished while the page is open.
        wasActive.current = false;
        setLiveLine(null);
        toast.success(
          latest.status === "COMPLETED"
            ? "AI finished working on this case"
            : `AI run ${latest.status.toLowerCase()}`,
        );
        onFinished?.();
      }
    } catch {
      /* polling must never break the page */
    }
  }, [caseId, onFinished]);

  // Immediate check on mount and whenever the operator queues a run.
  React.useEffect(() => {
    void check();
  }, [check, refreshKey]);

  // Poll while a run is active.
  const active = run !== null && ACTIVE.has(run.status);
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void check(), ACTIVE_POLL_MS);
    return () => clearInterval(t);
  }, [active, check]);

  const toggleLog = async () => {
    if (!run) return;
    if (!logOpen && logs.length === 0) {
      try {
        const res = await api.autopilot.autopilotControllerListLogs({
          id: run.id,
          channel: "BUSINESS",
        });
        setLogs(res.items);
      } catch {
        setLogs([]);
      }
    }
    setLogOpen((v) => !v);
  };

  const stop = async () => {
    if (!run) return;
    setCancelling(true);
    try {
      await api.autopilot.autopilotControllerCancelRun({ id: run.id });
      toast.success("Stop requested — the AI halts before its next step");
      void check();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop the run");
    } finally {
      setCancelling(false);
    }
  };

  if (!run) return null;

  // Finished runs: show the result for a while, dismissible.
  if (!active) {
    const finishedAt = run.finishedAt ? new Date(run.finishedAt).getTime() : 0;
    if (run.id === dismissedId || Date.now() - finishedAt > RESULT_TTL_MS) return null;
    const failed = run.status === "FAILED";
    return (
      <Card
        className={
          failed
            ? "border-red-600/50"
            : "border-[color:var(--color-amber-600,#d97706)]/50"
        }
      >
        <CardContent className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-sm">
              <Bot className="mr-1.5 inline h-4 w-4 text-[color:var(--color-amber-600,#d97706)]" />
              <span className="font-medium">
                AI {run.status === "COMPLETED" ? "finished" : run.status.toLowerCase()}
              </span>
              {run.summary && (
                <span className="text-muted-foreground"> — {run.summary}</span>
              )}
              {failed && run.error && (
                <span className="text-muted-foreground"> — {run.error}</span>
              )}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => void toggleLog()}>
                {logOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                Log
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground"
                aria-label="Dismiss"
                onClick={() => setDismissedId(run.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {logOpen && <RunLog logs={logs} />}
        </CardContent>
      </Card>
    );
  }

  // Active run: working banner.
  return (
    <Card className="border-[color:var(--color-amber-600,#d97706)]/50">
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <span className="relative flex h-4 w-4 items-center justify-center">
                <Bot className="h-4 w-4 text-[color:var(--color-amber-600,#d97706)]" />
                <span className="absolute -right-1 -top-1 h-2 w-2 animate-ping rounded-full bg-[color:var(--color-amber-600,#d97706)]/75" />
              </span>
              AI autopilot is working on this case…
            </p>
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
              <span className="truncate">{liveLine ?? "Starting up…"}</span>
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={cancelling}
            onClick={() => void stop()}
          >
            {cancelling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            Stop
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RunLog({ logs }: { logs: AgentLogDto[] }) {
  if (logs.length === 0) {
    return <p className="text-muted-foreground text-xs">No log entries.</p>;
  }
  return (
    <ol className="max-h-64 space-y-1 overflow-y-auto border-t-2 border-border pt-2">
      {logs.map((l) => (
        <li key={l.id} className="flex items-baseline gap-2 text-xs">
          <span className="text-muted-foreground shrink-0 font-mono text-[10px] tabular-nums">
            {new Date(l.createdAt).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="min-w-0 whitespace-pre-wrap">{l.message}</span>
        </li>
      ))}
    </ol>
  );
}
