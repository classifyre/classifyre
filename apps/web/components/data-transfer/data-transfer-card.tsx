"use client";

import * as React from "react";
import { Button, Card, CardContent } from "@workspace/ui/components";
import { Download, History, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  deleteTransferJob,
  downloadArchive,
  formatBytes,
  formatRows,
  isRunning,
  isTerminal,
  listTransferJobs,
  type TransferJob,
} from "@/lib/data-transfer-api";
import { ExportPanel } from "./export-panel";
import { ImportPanel } from "./import-panel";

/**
 * The Data tab: export on the left, import on the right, history underneath.
 *
 * Side by side rather than sub-tabbed because the two are a pair — an operator
 * moving a namespace does both, and seeing that the same scope list governs
 * each of them is most of the explanation the feature needs.
 */
export function DataTransferCard() {
  const { t } = useTranslation();
  const [jobs, setJobs] = React.useState<TransferJob[] | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await listTransferJobs();
        if (!cancelled) setJobs(next);
      } catch {
        if (!cancelled) setJobs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // A transfer started before this page was opened (or from another tab) still
  // has to be watchable, so the panels adopt whatever is in flight.
  const runningExport =
    jobs?.find((job) => job.kind === "EXPORT" && !isTerminal(job.status)) ??
    jobs?.find((job) => job.kind === "EXPORT") ??
    null;
  // A STAGED job is an upload waiting on a scope choice, not a transfer in
  // flight — the import panel owns that state, so it must not be adopted here.
  const runningImport =
    jobs?.find((job) => job.kind === "IMPORT" && isRunning(job.status)) ?? null;

  const history = (jobs ?? []).filter((job) => isTerminal(job.status));

  const handleDownload = async (job: TransferJob) => {
    try {
      await downloadArchive(job);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("dataTransfer.downloadFailed"),
      );
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTransferJob(id);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete");
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="panel-card rounded-[6px]">
          <CardContent className="p-5">
            <ExportPanel activeJob={runningExport} onJobStarted={reload} />
          </CardContent>
        </Card>

        <Card className="panel-card rounded-[6px]">
          <CardContent className="p-5">
            <ImportPanel activeJob={runningImport} onJobStarted={reload} />
          </CardContent>
        </Card>
      </div>

      <Card className="panel-card rounded-[6px]">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-4 w-4" />
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              {t("dataTransfer.historyHeading")}
            </p>
          </div>

          {jobs === null ? (
            <div className="flex justify-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {t("dataTransfer.historyEmpty")}
            </p>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {history.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
                >
                  <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {t(
                      (job.kind === "EXPORT"
                        ? "dataTransfer.kindExport"
                        : "dataTransfer.kindImport") as TranslationKey,
                    )}
                  </span>

                  <span className="min-w-0 flex-1 truncate text-xs">
                    {job.fileName ?? t("dataTransfer.noArchive")}
                  </span>

                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {t("dataTransfer.historyRows", {
                      rows: formatRows(job.processedRows),
                    })}
                  </span>

                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {formatBytes(job.fileSize)}
                  </span>

                  <span className="font-mono text-[11px] text-muted-foreground">
                    {new Date(job.finishedAt ?? job.createdAt).toLocaleString()}
                  </span>

                  <span
                    className={
                      job.status === "COMPLETED"
                        ? "font-mono text-[10px] uppercase tracking-[0.1em] text-emerald-700 dark:text-emerald-500"
                        : "font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"
                    }
                  >
                    {t(`dataTransfer.status.${job.status}` as TranslationKey)}
                  </span>

                  <span className="flex items-center gap-1">
                    {job.downloadAvailable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDownload(job)}
                        aria-label={t("dataTransfer.downloadShort")}
                        className="h-7 w-7 p-0"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDelete(job.id)}
                      aria-label={t("dataTransfer.deleteJob")}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
