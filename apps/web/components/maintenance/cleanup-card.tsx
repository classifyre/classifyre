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
  Button,
  Card,
  CardContent,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components";
import { api } from "@workspace/api-client";
import type {
  MaintenanceCleanupProgress,
  MaintenanceDatasetStat,
  MaintenanceOverview,
} from "@workspace/api-client";
import { AlertTriangle, Database, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import type { TranslationKey } from "@/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useServerConfig } from "@/components/server-config-provider";
import { useInstanceSettings } from "@/components/instance-settings-provider";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "–";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function formatRows(rows: number): string {
  return `~${rows.toLocaleString()}`;
}

/**
 * Per-dataset note in the confirm dialog. `warn` (amber box, same colors as
 * the paused-workspace banner) means irreversible loss or features that stay
 * broken until you act; otherwise a plain informational line. Datasets with
 * neither need no note — their table description already says what happens.
 */
const DIALOG_NOTES: Partial<
  Record<string, { key: TranslationKey; warn: boolean }>
> = {
  scans: { key: "settings.cleanup.datasets.scans.destructive", warn: true },
  harness: {
    key: "settings.cleanup.datasets.harness.destructive",
    warn: true,
  },
  duplicates: { key: "settings.cleanup.datasets.duplicates.impact", warn: false },
  embeddings: { key: "settings.cleanup.datasets.embeddings.impact", warn: true },
};

/**
 * Storage & cleanup for the Settings → Cleanup tab.
 *
 * Two tables share one row renderer: cleanable datasets first (live row
 * estimates and byte sizes, confirm dialog, background wipe with live
 * progress), then the protected investigation itself — sources, findings,
 * assets, cases, inquiries, glossary — with a Kept badge and no action,
 * because the API has no cleanup path for them at all.
 */
export function CleanupCard() {
  const { t } = useTranslation();
  const serverConfig = useServerConfig();
  const { settings } = useInstanceSettings();
  const demoMode = serverConfig.demoMode || settings.demoMode;

  // Dataset keys come from the API overview; the translation dictionary
  // covers every key the API can send, with the key itself as fallback.
  const datasetName = (key: string) =>
    t(`settings.cleanup.datasets.${key}.name` as TranslationKey);
  const datasetDesc = (key: string) =>
    t(`settings.cleanup.datasets.${key}.desc` as TranslationKey);

  const [overview, setOverview] = React.useState<MaintenanceOverview | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const [confirmKey, setConfirmKey] = React.useState<string | null>(null);
  // Latest polled snapshot of the running wipe, if any (one at a time).
  const [runState, setRunState] =
    React.useState<MaintenanceCleanupProgress | null>(null);
  const cleaningKey = runState && runState.status === "running" ? runState.key : null;
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setOverview(await api.maintenance.overview());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const confirmDataset = confirmKey
    ? overview?.datasets.find((d) => d.cleanupKey === confirmKey) ?? null
    : null;

  const cleanableDatasets =
    overview?.datasets.filter((d) => d.cleanable) ?? [];
  const protectedDatasets =
    overview?.datasets.filter((d) => !d.cleanable) ?? [];
  const dialogNote = confirmKey ? DIALOG_NOTES[confirmKey] : undefined;

  const renderDatasetTable = (list: MaintenanceDatasetStat[]) => (
    <div className="overflow-x-auto rounded-[4px] border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("settings.cleanup.colDataset")}</TableHead>
            <TableHead className="w-28 text-right">
              {t("settings.cleanup.colRows")}
            </TableHead>
            <TableHead className="w-28 text-right">
              {t("settings.cleanup.colSize")}
            </TableHead>
            <TableHead className="w-32 text-right">
              {t("settings.cleanup.colAction")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((dataset) => {
            const key = dataset.key;
            const name = datasetName(key);
            const desc = datasetDesc(key);
            const busy = cleaningKey === dataset.cleanupKey;
            const progress =
              busy && runState && runState.status === "running"
                ? runState
                : null;
            const total = progress?.totalEstimate ?? null;
            const percent =
              progress && total && total > 0
                ? Math.min(99, Math.round((progress.processed / total) * 100))
                : undefined;
            return (
              <TableRow key={key}>
                <TableCell>
                  <p className="text-sm font-medium">{name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
                  {progress ? (
                    <div className="mt-2 w-52 max-w-full">
                      <Progress value={percent} className="h-1.5" />
                      <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                        {progress.currentTable
                          ? total && total > 0
                            ? t("settings.cleanup.progress", {
                                processed:
                                  progress.processed.toLocaleString(),
                                total: total.toLocaleString(),
                                table: progress.currentTable,
                              })
                            : t("settings.cleanup.progressNoEstimate", {
                                processed:
                                  progress.processed.toLocaleString(),
                                table: progress.currentTable,
                              })
                          : t("settings.cleanup.progressFinishing")}
                      </p>
                    </div>
                  ) : null}
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  title={dataset.tables.join(", ")}
                >
                  {formatRows(dataset.rowsEstimate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatBytes(dataset.sizeBytes)}
                </TableCell>
                <TableCell className="text-right">
                  {dataset.cleanable && dataset.cleanupKey ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-[4px]"
                      disabled={busy || demoMode || cleaningKey !== null}
                      onClick={() => setConfirmKey(dataset.cleanupKey)}
                    >
                      {busy ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      {busy
                        ? t("settings.cleanup.cleaning")
                        : t("settings.cleanup.clean")}
                    </Button>
                  ) : (
                    <span
                      title={t("settings.cleanup.keptNote")}
                      className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
                    >
                      <Lock className="size-3 shrink-0" />
                      {t("settings.cleanup.kept")}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  // Poll one run until it leaves `running` (or vanishes: an API restart
  // drops the in-memory runs, so a 404 means "look at the overview").
  const pollRun = async (
    runId: string,
  ): Promise<MaintenanceCleanupProgress | null> => {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (!mountedRef.current) return null;
      let snapshot: MaintenanceCleanupProgress;
      try {
        snapshot = await api.maintenance.cleanupProgress(runId);
      } catch {
        return null;
      }
      if (mountedRef.current) setRunState(snapshot);
      if (snapshot.status !== "running") return snapshot;
    }
  };

  const runCleanup = async () => {
    if (!confirmKey || runState || demoMode) return;
    const key = confirmKey;
    setConfirmKey(null);
    let runId: string;
    try {
      const started = await api.maintenance.startCleanup(key);
      runId = started.runId;
    } catch (cleanupError) {
      toast.error(
        cleanupError instanceof Error
          ? cleanupError.message
          : t("settings.cleanup.failed"),
      );
      return;
    }
    if (mountedRef.current) {
      setRunState({
        runId,
        key,
        status: "running",
        totalEstimate: null,
        processed: 0,
        currentTable: null,
        tablesTotal: 0,
        tablesDone: 0,
      });
    }
    const final = await pollRun(runId);
    if (mountedRef.current) setRunState(null);
    if (!final) {
      // No result to report — the overview reload still shows the effect.
      toast.message(t("settings.cleanup.runGone"));
    } else if (final.status === "done" && final.result) {
      const result = final.result;
      const removed = Object.values(result.deleted).reduce((a, n) => a + n, 0);
      const skipped = Object.values(result.skipped).reduce((a, n) => a + n, 0);
      const name = datasetName(key);
      toast.success(
        t("settings.cleanup.success", {
          name,
          rows: removed.toLocaleString(),
          seconds: (result.durationMs / 1000).toFixed(1),
        }) + (skipped > 0 ? ` · ${t("settings.cleanup.successSkipped", { count: skipped })}` : ""),
      );
    } else {
      toast.error(
        final.error
          ? t("settings.cleanup.runFailed", { error: final.error })
          : t("settings.cleanup.failed"),
      );
    }
    if (mountedRef.current) await load();
  };

  return (
    <Card className="panel-card rounded-[6px]">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Database className="h-4 w-4" />
          <p className="text-xs font-mono uppercase tracking-[0.14em]">
            {t("settings.cleanup.title")}
          </p>
          {overview && !loading ? (
            <p className="ml-auto text-xs text-muted-foreground">
              {t("settings.cleanup.totalData", {
                size: formatBytes(overview.schemaSizeBytes),
              })}
              {overview.bossSchemaSizeBytes > 0
                ? ` · ${t("settings.cleanup.totalQueues", {
                    size: formatBytes(overview.bossSchemaSizeBytes),
                  })}`
                : ""}
            </p>
          ) : null}
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          {t("settings.cleanup.description")}
        </p>
        {overview && !loading && overview.activeJobs > 0 ? (
          <div className="flex items-start gap-2 rounded-[4px] border border-amber-600/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t("settings.cleanup.activeJobsHint", { count: overview.activeJobs })}</span>
          </div>
        ) : null}

        {loading && !overview ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.cleanup.loading")}
          </div>
        ) : failed || !overview ? (
          <div className="flex flex-wrap items-center gap-3 py-4">
            <p className="text-sm text-muted-foreground">
              {t("settings.cleanup.loadFailed")}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-[4px]"
              onClick={() => void load()}
            >
              {t("settings.cleanup.retry")}
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t("settings.cleanup.cleanableTitle")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings.cleanup.cleanableSubtitle")}
              </p>
            </div>
            {renderDatasetTable(cleanableDatasets)}
            <div className="space-y-1 pt-3">
              <p className="text-sm font-medium">
                {t("settings.cleanup.protectedTitle")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings.cleanup.protectedSubtitle")}
              </p>
            </div>
            {renderDatasetTable(protectedDatasets)}
            <p className="text-xs text-muted-foreground">
              {t("settings.cleanup.estimatesNote")}{" "}
              {t("settings.cleanup.unlisted", {
                count: overview.unlistedTables.length,
                size: formatBytes(overview.unlistedSizeBytes),
              })}
            </p>
          </>
        )}
      </CardContent>

      <AlertDialog
        open={confirmKey !== null}
        onOpenChange={(open) => {
          if (!open && cleaningKey === null) setConfirmKey(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDataset
                ? t("settings.cleanup.confirmTitle", {
                    name: datasetName(confirmDataset.cleanupKey as string),
                  })
                : ""}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                {confirmDataset
                  ? datasetDesc(confirmDataset.cleanupKey as string)
                  : ""}
              </span>
              {dialogNote?.warn ? (
                <span className="flex items-start gap-2 rounded-[4px] border border-amber-600/40 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t(dialogNote.key)}</span>
                </span>
              ) : dialogNote ? (
                <span className="block text-muted-foreground">
                  {t(dialogNote.key)}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleaningKey !== null}>
              {t("settings.cleanup.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={cleaningKey !== null}
              onClick={(event) => {
                event.preventDefault();
                void runCleanup();
              }}
            >
              {cleaningKey !== null ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t("settings.cleanup.confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
