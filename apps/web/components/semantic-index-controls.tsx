"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, Clock, Layers3, RefreshCw, Sparkles } from "lucide-react";
import { api, type EmbeddingStatusResponseDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { formatDate } from "@/lib/date";
import { useTranslation } from "@/hooks/use-translation";

const POLL_MS = 5000;

function fetchStatus(): Promise<EmbeddingStatusResponseDto> {
  return api.embeddings.embeddingControllerStatus();
}

/**
 * Semantic index health + controls: whether a reindex is running, a
 * recalculation pass is scheduled (queued/debounced) or running, when the
 * last recalculation happened, and buttons to kick each one off.
 * Near-duplicate detection and evidence ranking both depend on this index
 * being current.
 */
export function SemanticIndexControls() {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<EmbeddingStatusResponseDto | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [reindexing, setReindexing] = React.useState(false);
  const [recalibrating, setRecalibrating] = React.useState(false);

  const refresh = React.useCallback(() => {
    fetchStatus()
      .then((s) => {
        setStatus(s);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : t("correlation.semanticIndex.loadFailed"));
      });
  }, [t]);

  React.useEffect(() => refresh(), [refresh]);

  const busy = Boolean(
    status?.backfillRunning || status?.recalibrationScheduled || status?.recalibrationRunning,
  );
  React.useEffect(() => {
    if (!busy) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [busy, refresh]);

  const reindex = async () => {
    if (!status?.workerRegistered) return;
    setReindexing(true);
    try {
      await api.embeddings.embeddingControllerReindex();
      toast.success(t("correlation.semanticIndex.reindexStarted"));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("correlation.semanticIndex.reindexFailed"));
    } finally {
      setReindexing(false);
    }
  };

  const recalibrate = async () => {
    setRecalibrating(true);
    try {
      await api.embeddings.embeddingControllerRecalibrate();
      toast.success(t("correlation.semanticIndex.recalibrateStarted"));
      refresh();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : t("correlation.semanticIndex.recalibrateFailed"),
      );
    } finally {
      setRecalibrating(false);
    }
  };

  const idle =
    status &&
    !status.backfillRunning &&
    !status.recalibrationScheduled &&
    !status.recalibrationRunning;

  return (
    <div className="space-y-3 rounded-[4px] border border-border bg-muted/30 p-3">
      <h3 className="flex items-center gap-1.5 font-serif text-sm font-black uppercase tracking-[0.06em]">
        <Sparkles className="h-3.5 w-3.5" />
        {t("correlation.semanticIndex.title")}
      </h3>

      {loadError ? (
        <p className="text-xs text-destructive">{loadError}</p>
      ) : !status ? (
        <Spinner size="sm" label={t("correlation.semanticIndex.title")} />
      ) : (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {t("correlation.semanticIndex.lastRecalibrated", {
                when: status.lastRecalibratedAt
                  ? formatDate(status.lastRecalibratedAt)
                  : t("correlation.semanticIndex.neverRecalibrated"),
              })}
            </span>
          </div>

          {/* "Scheduled" on its own says nothing about whether the index is
              any good. These are the numbers that do. */}
          <dl className="grid grid-cols-2 gap-1.5 pt-1">
            <Stat
              label={t("review.index.vectors")}
              value={
                status.embeddedRows != null
                  ? status.embeddedRows.toLocaleString()
                  : "—"
              }
            />
            <Stat
              label={t("review.index.queued")}
              value={status.pendingQueueWrites.toLocaleString()}
            />
            <Stat
              label={t("review.index.model")}
              value={`${status.model} · ${status.dimensions}d`}
            />
            <Stat
              label={t("review.index.worker")}
              value={
                status.workerRegistered
                  ? t("review.index.workerUp")
                  : t("review.index.workerDown")
              }
              warn={!status.workerRegistered}
            />
          </dl>

          {/* The reindex runs in the process that owns the embedding queue.
              In a split api/worker deployment that is the worker, so firing it
              from here returns a 500 — better to say so than to let someone
              click a button that cannot work. */}
          {!status.workerRegistered && (
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {t("review.index.workerDownHint")}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {status.backfillRunning && (
              <Badge variant="outline" className="gap-1 text-[10px] uppercase">
                <Layers3 className="h-3 w-3" />
                {t("correlation.semanticIndex.statusBackfillRunning")}
              </Badge>
            )}
            {status.recalibrationScheduled && !status.recalibrationRunning && (
              <Badge variant="outline" className="gap-1 text-[10px] uppercase">
                <Clock className="h-3 w-3" />
                {t("correlation.semanticIndex.statusRecalibrationScheduled")}
              </Badge>
            )}
            {status.recalibrationRunning && (
              <Badge variant="outline" className="gap-1 text-[10px] uppercase">
                <Sparkles className="h-3 w-3" />
                {t("correlation.semanticIndex.statusRecalibrationRunning")}
              </Badge>
            )}
            {idle && (
              <Badge variant="outline" className="text-[10px] uppercase">
                {t("correlation.semanticIndex.statusIdle")}
              </Badge>
            )}
          </div>
          {status.backfillError && (
            <p className="flex items-start gap-1.5 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {t("correlation.semanticIndex.backfillError", { error: status.backfillError })}
            </p>
          )}
          {status.lastRecalibrationError && (
            <p className="flex items-start gap-1.5 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {t("correlation.semanticIndex.recalibrationError", {
                error: status.lastRecalibrationError,
              })}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2 border-t border-border/60 pt-2">
        <div className="space-y-1">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={
              reindexing ||
              status?.backfillRunning ||
              !status?.workerRegistered
            }
            onClick={() => void reindex()}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t("correlation.semanticIndex.reindexButton")}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {t("correlation.semanticIndex.reindexDesc")}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t("correlation.semanticIndex.reindexChainNote")}
          </p>
        </div>
        <div className="space-y-1">
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={
              recalibrating || status?.recalibrationScheduled || status?.recalibrationRunning
            }
            onClick={() => void recalibrate()}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {t("correlation.semanticIndex.recalibrateButton")}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {t("correlation.semanticIndex.recalibrateDesc")}
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-[3px] border border-border bg-background px-2 py-1">
      <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`truncate font-mono text-[11px] ${
          warn ? "text-destructive" : "text-foreground"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
