"use client";

import * as React from "react";
import { Button } from "@workspace/ui/components";
import { Download, Loader2, PackageOpen, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { useTranslation } from "@/hooks/use-translation";
import { useTransferJob } from "@/hooks/use-transfer-job";
import {
  cancelTransferJob,
  downloadArchive,
  formatBytes,
  isRunning,
  listTransferScopes,
  startExport,
  type TransferJob,
  type TransferScopeId,
} from "@/lib/data-transfer-api";
import { ScopePicker, scopeRowsFromCatalogue, type ScopeRow } from "./scope-picker";
import { SecretsNotice } from "./secrets-notice";
import { Stat, TransferProgressPanel } from "./transfer-progress";

/** Heavy scopes stay unchecked until the operator asks for them. */
const DEFAULT_OFF: TransferScopeId[] = ["sourceFiles", "scanData"];

export function ExportPanel({
  activeJob,
  onJobStarted,
}: {
  /** A running export adopted from the job list, so a reload keeps watching it. */
  activeJob: TransferJob | null;
  onJobStarted: () => void;
}) {
  const { t } = useTranslation();
  const [scopes, setScopes] = React.useState<ScopeRow[] | null>(null);
  const [selected, setSelected] = React.useState<Set<TransferScopeId>>(new Set());
  const [starting, setStarting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [jobId, setJobId] = React.useState<string | null>(activeJob?.id ?? null);

  const { job, refresh } = useTransferJob(jobId);
  const current = job ?? activeJob;

  React.useEffect(() => {
    if (activeJob && activeJob.id !== jobId) setJobId(activeJob.id);
  }, [activeJob, jobId]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const catalogue = await listTransferScopes();
        if (cancelled) return;
        const rows = scopeRowsFromCatalogue(catalogue);
        setScopes(rows);
        setSelected(
          new Set(
            rows
              .filter(
                (row) =>
                  (row.rows ?? 0) > 0 && !DEFAULT_OFF.includes(row.id),
              )
              .map((row) => row.id),
          ),
        );
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : t("dataTransfer.scopesFailed"),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const handleStart = async () => {
    setStarting(true);
    try {
      const started = await startExport([...selected]);
      setJobId(started.id);
      onJobStarted();
      toast.success(t("dataTransfer.exportStarted"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("dataTransfer.exportFailed"),
      );
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!current) return;
    setCancelling(true);
    try {
      await cancelTransferJob(current.id);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel");
    } finally {
      setCancelling(false);
    }
  };

  const running =
    current !== null && current.kind === "EXPORT" && isRunning(current.status);

  const finished =
    current !== null && current.kind === "EXPORT" && !running;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <PackageOpen className="mt-0.5 h-4 w-4" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-mono uppercase tracking-[0.14em]">
            {t("dataTransfer.exportHeading")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("dataTransfer.exportDesc")}
          </p>
        </div>
      </div>

      <SecretsNotice />

      {scopes === null ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <ScopePicker
          scopes={scopes}
          selected={selected}
          onChange={setSelected}
          disabled={running || starting}
        />
      )}

      {current && (running || finished) ? (
        <TransferProgressPanel
          job={current}
          onCancel={handleCancel}
          cancelling={cancelling}
        >
          <Stat
            label={t("dataTransfer.archiveSize")}
            value={formatBytes(current.fileSize)}
          />
        </TransferProgressPanel>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={handleStart}
          disabled={starting || running || selected.size === 0}
          className="h-9 gap-1.5 text-xs"
        >
          {starting || running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PackageOpen className="h-3.5 w-3.5" />
          )}
          {running ? t("dataTransfer.exporting") : t("dataTransfer.startExport")}
        </Button>

        {current?.downloadAvailable ? (
          <Button
            variant="outline"
            disabled={downloading}
            onClick={() => {
              setDownloading(true);
              void downloadArchive(current)
                .catch((error: unknown) =>
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : t("dataTransfer.downloadFailed"),
                  ),
                )
                .finally(() => setDownloading(false));
            }}
            className="h-9 gap-1.5 border-2 text-xs"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {t("dataTransfer.download", {
              size: formatBytes(current.fileSize),
            })}
          </Button>
        ) : null}

        {current?.status === "COMPLETED" && current.expiresAt ? (
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" />
            {t("dataTransfer.expiresAt", {
              when: new Date(current.expiresAt).toLocaleString(),
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
