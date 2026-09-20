"use client";

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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

import Link from "next/link";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { useServerConfig } from "@/components/server-config-provider";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { FEATURE_SWITCHES_PATH } from "@/components/feature-off-notice";
import { useNsPath } from "@/lib/ns-path";

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
  const [purgeTarget, setPurgeTarget] =
    React.useState<WorkerQueueDto | null>(null);
  const [purging, setPurging] = React.useState(false);

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
      } catch (error) {
        // A held queue answers 409 with a message naming the feature; show
        // it rather than a generic failure.
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t("settings.workers.pauseFailedToast"),
        );
      } finally {
        setPending(null);
      }
    },
    [load, t],
  );

  const runPurge = async () => {
    if (!purgeTarget || purging || demoMode) return;
    const target = purgeTarget;
    setPurging(true);
    try {
      const result = await api.workerQueues.workerQueuesControllerPurgeQueued(
        { queue: target.queue },
      );
      toast.success(
        t("settings.workers.purgeSuccess", {
          count: result.droppedQueued,
          queue: target.queue,
        }),
      );
      setPurgeTarget(null);
      await load();
    } catch {
      toast.error(t("settings.workers.purgeFailed"));
    } finally {
      setPurging(false);
    }
  };

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
          <div className="overflow-x-auto rounded-[4px] border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.workers.queue")}</TableHead>
                  <TableHead>{t("settings.workers.state")}</TableHead>
                  <TableHead className="text-right">
                    {t("settings.workers.backlog")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("settings.workers.runs")}
                  </TableHead>
                  <TableHead>{t("settings.workers.workers")}</TableHead>
                  <TableHead className="text-right">
                    {t("settings.workers.colAction")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.queues.map((queue) => (
                  <QueueRow
                    key={queue.queue}
                    queue={queue}
                    demoMode={demoMode}
                    pending={pending === queue.queue}
                    onTogglePause={() => void togglePause(queue)}
                    onPurge={() => setPurgeTarget(queue)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("settings.workers.cancelNote")}
        </p>
      </CardContent>

      <AlertDialog
        open={purgeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !purging) setPurgeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {purgeTarget
                ? t("settings.workers.purgeConfirmTitle", {
                    count: purgeTarget.queuedCount,
                    queue: purgeTarget.queue,
                  })
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.workers.purgeConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purging}>
              {t("settings.workers.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={purging}
              onClick={(event) => {
                event.preventDefault();
                void runPurge();
              }}
            >
              {purging ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t("settings.workers.purgeConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function QueueRow({
  queue,
  demoMode,
  pending,
  onTogglePause,
  onPurge,
}: {
  queue: WorkerQueueDto;
  demoMode: boolean;
  pending: boolean;
  onTogglePause: () => void;
  onPurge: () => void;
}) {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  // Paused by a feature switch (Settings → Cleanup), not by an operator: it
  // cannot be resumed here, only by turning the feature back on.
  const heldBy = queue.heldBy
    ? t(`features.items.${queue.heldBy}.name` as TranslationKey)
    : null;
  const elapsed = queue.instances
    .map((instance) => instance.elapsedMs)
    .filter((value): value is number => value != null)
    .sort((a, b) => b - a)[0];
  const lastDuration = queue.instances
    .map((instance) => instance.lastDurationMs)
    .filter((value): value is number => value != null)[0];
  // pg-boss housekeeping queues can never be purged (the API refuses with
  // 400), so offer the button only for real queues with a backlog.
  const purgable = queue.queuedCount > 0 && !queue.queue.startsWith("__");

  return (
    <TableRow key={queue.queue}>
      <TableCell>
        <div className="font-mono text-xs">{queue.queue}</div>
        {queue.lastError ? (
          <div
            className="mt-1 max-w-[280px] truncate text-[11px] text-destructive"
            title={queue.lastError}
          >
            {t("settings.workers.lastError")}: {queue.lastError}
          </div>
        ) : null}
      </TableCell>
      <TableCell>
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
          {heldBy ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  data-testid={`queue-held-${queue.queue}`}
                  className="rounded-[3px] border-amber-500/40 bg-transparent px-1.5 text-[10px] font-mono uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400"
                >
                  {t("features.workers.heldBy", { feature: heldBy })}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-xs">
                {t("features.workers.heldHint", { feature: heldBy })}
              </TooltipContent>
            </Tooltip>
          ) : queue.paused ? (
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
      </TableCell>
      <TableCell className="text-right tabular-nums text-xs">
        {t("settings.workers.queued", {
          count: queue.queuedCount.toLocaleString(),
        })}
      </TableCell>
      <TableCell className="text-right tabular-nums text-xs">
        <div>{queue.runCount.toLocaleString()}</div>
        {queue.failureCount > 0 ? (
          <div className="text-[11px] text-destructive">
            {t("settings.workers.failures", { count: queue.failureCount })}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="text-[11px] text-muted-foreground">
        {queue.instances.length === 0 ? (
          "—"
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="max-w-[200px] cursor-default truncate font-mono">
                {queue.instances.map((i) => i.instanceId).join(", ")}
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-[340px] text-xs">
              <div className="space-y-1">
                {queue.instances.map((instance) => (
                  <div
                    key={instance.instanceId}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="break-all font-mono">
                      {instance.instanceId}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {instance.status}
                    </span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1.5">
          {purgable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-[4px] text-[11px]"
              disabled={demoMode}
              onClick={onPurge}
            >
              {t("settings.workers.purge")}
            </Button>
          ) : null}
          {heldBy ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-7 rounded-[4px] text-[11px]"
            >
              <Link href={nsPath(FEATURE_SWITCHES_PATH)}>
                <Play className="mr-1 h-3 w-3" />
                {t("features.workers.turnOn")}
              </Link>
            </Button>
          ) : (
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
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
