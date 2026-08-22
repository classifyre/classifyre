"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { api } from "@workspace/api-client";
import type { WorkerOverviewDto, WorkerQueueDto } from "@workspace/api-client";
import {
  AlertTriangle,
  Cpu,
  Loader2,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { useServerConfig } from "@/components/server-config-provider";
import { useInstanceSettings } from "@/components/instance-settings-provider";

const REFRESH_MS = 5_000;

type QueueStatus = WorkerQueueDto["status"];

const STATUS_TONE: Record<QueueStatus, string> = {
  running: "border-sky-500/40 bg-transparent text-sky-600 dark:text-sky-400",
  waiting_slot:
    "border-amber-500/40 bg-transparent text-amber-600 dark:text-amber-400",
  failed:
    "border-destructive/40 bg-transparent text-destructive dark:text-destructive",
  stale: "border-border bg-transparent text-muted-foreground",
  idle: "border-border bg-transparent text-muted-foreground",
};

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 90) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${minutes.toFixed(0)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

/**
 * Live view of the background queues serving this workspace.
 *
 * Worker state is written by the worker processes into a shared table, so this
 * renders correctly even though the pod answering the request usually runs no
 * queue handler of its own.
 */
export function WorkerQueuesCard() {
  const { t } = useTranslation();
  const serverConfig = useServerConfig();
  const { settings } = useInstanceSettings();
  const demoMode = serverConfig.demoMode || settings.demoMode;

  const [overview, setOverview] = React.useState<WorkerOverviewDto | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const next = await api.workerQueues.workerQueuesControllerOverview();
      setOverview(next);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("settings.workers.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const togglePause = React.useCallback(
    async (queue: WorkerQueueDto) => {
      setPending(queue.queue);
      try {
        await api.workerQueues.workerQueuesControllerSetPaused({
          queue: queue.queue,
          setWorkerQueuePausedDto: { paused: !queue.paused },
        });
        toast.success(
          queue.paused
            ? t("settings.workers.resumedToast")
            : t("settings.workers.pausedToast"),
        );
        await load();
      } catch {
        toast.error(t("settings.workers.pauseFailedToast"));
      } finally {
        setPending(null);
      }
    },
    [load, t],
  );

  const concurrencyLabel = overview
    ? overview.concurrencyLimit === 0
      ? t("settings.workers.concurrencyUnlimited")
      : t("settings.workers.concurrency", { limit: overview.concurrencyLimit })
    : "";
  const slotTimeoutLabel = overview
    ? overview.slotWaitTimeoutSeconds === 0
      ? t("settings.workers.slotTimeoutDisabled")
      : t("settings.workers.slotTimeout", {
          seconds: overview.slotWaitTimeoutSeconds,
        })
    : "";

  return (
    <Card className="panel-card rounded-[6px]">
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              <p className="text-xs font-mono uppercase tracking-[0.14em]">
                {t("settings.workers.heading")}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.workers.desc")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-[4px]"
            onClick={() => void load()}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t("settings.workers.refresh")}
          </Button>
        </div>

        {overview ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
            <span>{concurrencyLabel}</span>
            <span>{slotTimeoutLabel}</span>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {loading && !overview ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : null}

        {overview && overview.queues.length === 0 ? (
          <p className="py-6 text-xs text-muted-foreground">
            {t("settings.workers.empty")}
          </p>
        ) : null}

        {overview && overview.queues.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                  <th className="py-2 pr-3 font-normal">
                    {t("settings.workers.queue")}
                  </th>
                  <th className="py-2 pr-3 font-normal">
                    {t("settings.workers.state")}
                  </th>
                  <th className="py-2 pr-3 font-normal">
                    {t("settings.workers.backlog")}
                  </th>
                  <th className="py-2 pr-3 font-normal">
                    {t("settings.workers.runs")}
                  </th>
                  <th className="py-2 pr-3 font-normal">
                    {t("settings.workers.workers")}
                  </th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {overview.queues.map((queue) => (
                  <QueueRow
                    key={queue.queue}
                    queue={queue}
                    demoMode={demoMode}
                    pending={pending === queue.queue}
                    onTogglePause={() => void togglePause(queue)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("settings.workers.cancelNote")}
        </p>
      </CardContent>
    </Card>
  );
}

function QueueRow({
  queue,
  demoMode,
  pending,
  onTogglePause,
}: {
  queue: WorkerQueueDto;
  demoMode: boolean;
  pending: boolean;
  onTogglePause: () => void;
}) {
  const { t } = useTranslation();
  const elapsed = queue.instances
    .map((instance) => instance.elapsedMs)
    .filter((value): value is number => value != null)
    .sort((a, b) => b - a)[0];
  const lastDuration = queue.instances
    .map((instance) => instance.lastDurationMs)
    .filter((value): value is number => value != null)[0];

  return (
    <tr className="border-b border-border/60 align-top last:border-b-0">
      <td className="py-2.5 pr-3">
        <div className="font-mono text-xs">{queue.queue}</div>
        {queue.lastError ? (
          <div
            className="mt-1 max-w-[280px] truncate text-[11px] text-destructive"
            title={queue.lastError}
          >
            {t("settings.workers.lastError")}: {queue.lastError}
          </div>
        ) : null}
      </td>
      <td className="py-2.5 pr-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={`rounded-[3px] px-1.5 text-[10px] font-mono uppercase tracking-[0.12em] ${STATUS_TONE[queue.status]}`}
              >
                {t(`settings.workers.status.${queue.status}` as TranslationKey)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px] text-xs">
              {t(
                `settings.workers.statusHint.${queue.status}` as TranslationKey,
              )}
            </TooltipContent>
          </Tooltip>
          {queue.paused ? (
            <Badge
              variant="outline"
              className="rounded-[3px] border-amber-500/40 bg-transparent px-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400"
            >
              {t("settings.workers.paused")}
            </Badge>
          ) : null}
        </div>
        {elapsed != null ? (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t("settings.workers.elapsed", {
              duration: formatDuration(elapsed),
            })}
          </div>
        ) : lastDuration != null ? (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t("settings.workers.lastRun", {
              duration: formatDuration(lastDuration),
            })}
          </div>
        ) : null}
      </td>
      <td className="py-2.5 pr-3 tabular-nums text-xs">
        {t("settings.workers.queued", {
          count: queue.queuedCount.toLocaleString(),
        })}
      </td>
      <td className="py-2.5 pr-3 tabular-nums text-xs">
        <div>{queue.runCount.toLocaleString()}</div>
        {queue.failureCount > 0 ? (
          <div className="text-[11px] text-destructive">
            {t("settings.workers.failures", { count: queue.failureCount })}
          </div>
        ) : null}
      </td>
      <td className="py-2.5 pr-3 text-[11px] text-muted-foreground">
        {queue.instances.length === 0
          ? "—"
          : queue.instances.map((instance) => (
              <div key={instance.instanceId} className="truncate font-mono">
                {instance.instanceId}
              </div>
            ))}
      </td>
      <td className="py-2.5 text-right">
        <Button
          variant="outline"
          size="sm"
          className="h-7 rounded-[4px] text-[11px]"
          disabled={demoMode || pending}
          onClick={onTogglePause}
        >
          {pending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : queue.paused ? (
            <>
              <Play className="mr-1 h-3 w-3" />
              {t("settings.workers.resume")}
            </>
          ) : (
            <>
              <Pause className="mr-1 h-3 w-3" />
              {t("settings.workers.pause")}
            </>
          )}
        </Button>
      </td>
    </tr>
  );
}
