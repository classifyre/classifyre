"use client";

import * as React from "react";
import Link from "next/link";
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
  Switch,
} from "@workspace/ui/components";
import {
  api,
  type MaintenanceCleanupProgress,
  type WorkspaceFeatureKey,
  type WorkspaceFeatureState,
} from "@workspace/api-client";
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  Pause,
  Power,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { TranslationKey } from "@/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useWorkspaceFeatures } from "@/hooks/use-workspace-features";
import { useServerConfig } from "@/components/server-config-provider";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { useNsPath } from "@/lib/ns-path";
import { formatDate } from "@/lib/date";
import { emitStorageChanged } from "@/lib/storage-events";
import { STATUS_TONE, statusBadgeClass } from "@/lib/status-tone";

/** Where each feature is configured (as opposed to switched). */
const CONFIGURE_PATH: Record<WorkspaceFeatureKey, string> = {
  embeddings: "/harness?tab=embedding",
  duplicates: "/duplicates/tune",
};

/** "While it is off" bullets per feature, in order. */
const STOP_KEYS = ["stop1", "stop2", "stop3", "stop4"] as const;

const POLL_MS = 1500;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
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

/** The chosen/unchosen mark on the two ways of turning a feature off. */
function RadioDot({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex size-3 shrink-0 items-center justify-center rounded-full border ${
        checked ? "border-foreground" : "border-muted-foreground/50"
      }`}
    >
      {checked ? (
        <span className="size-1.5 rounded-full bg-foreground" />
      ) : null}
    </span>
  );
}

type Pending =
  | { kind: "off"; feature: WorkspaceFeatureState }
  | { kind: "on"; feature: WorkspaceFeatureState }
  | { kind: "delete"; feature: WorkspaceFeatureState };

/**
 * Settings → Cleanup › Features: whether the two storage-heavy engines run.
 *
 * Every change goes through a dialog that says what the change costs, because
 * none of them is free: off stops work the rest of the product reads, delete
 * is irreversible, and on can mean an hour of worker time. Turning off asks
 * how — keep the data (a pause) or delete it (frees the storage now) — which
 * is the choice the old embeddings toggle made for you by always deleting.
 */
export function FeatureSwitchesCard() {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const serverConfig = useServerConfig();
  const { settings } = useInstanceSettings();
  const demoMode = serverConfig.demoMode || settings.demoMode;
  const { features, loading, failed, refresh } = useWorkspaceFeatures();

  const [pending, setPending] = React.useState<Pending | null>(null);
  const [deleteChoice, setDeleteChoice] = React.useState(false);
  const [saving, setSaving] = React.useState<WorkspaceFeatureKey | null>(null);
  // Live progress of a data wipe, per feature (one run each at most).
  const [runs, setRuns] = React.useState<
    Partial<Record<WorkspaceFeatureKey, MaintenanceCleanupProgress>>
  >({});
  const polling = React.useRef(new Set<string>());
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const name = React.useCallback(
    (key: WorkspaceFeatureKey) =>
      t(`features.items.${key}.name` as TranslationKey),
    [t],
  );

  /** Follow a wipe to the end, then re-measure everything on the page. */
  const follow = React.useCallback(
    async (key: WorkspaceFeatureKey, runId: string) => {
      if (polling.current.has(runId)) return;
      polling.current.add(runId);
      try {
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          if (!mounted.current) return;
          let snapshot: MaintenanceCleanupProgress;
          try {
            snapshot = await api.maintenance.cleanupProgress(runId);
          } catch {
            // The run aged out or the API restarted: the refreshed switch
            // state below still shows where things stand.
            break;
          }
          setRuns((current) => ({ ...current, [key]: snapshot }));
          if (snapshot.status === "running") continue;
          if (snapshot.status === "done" && snapshot.result) {
            const rows = Object.values(snapshot.result.deleted).reduce(
              (sum, n) => sum + n,
              0,
            );
            toast.success(
              t("features.toast.deleted", {
                name: name(key),
                rows: rows.toLocaleString(),
                seconds: (snapshot.result.durationMs / 1000).toFixed(1),
              }),
            );
          } else if (snapshot.status === "failed") {
            toast.error(
              t("features.toast.deleteFailed", {
                name: name(key),
                error: snapshot.error ?? "",
              }),
            );
          }
          break;
        }
      } finally {
        polling.current.delete(runId);
        if (mounted.current) {
          setRuns((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          });
          await refresh();
          emitStorageChanged();
        }
      }
    },
    [name, refresh, t],
  );

  // A wipe started elsewhere (the dataset table, another tab, before a
  // reload) is followed here too, so the row never looks idle mid-delete.
  React.useEffect(() => {
    for (const feature of features ?? []) {
      if (feature.cleanupRunId) void follow(feature.key, feature.cleanupRunId);
    }
  }, [features, follow]);

  const apply = async () => {
    if (!pending || demoMode) return;
    const { kind, feature } = pending;
    const key = feature.key;
    const deleteData = kind === "delete" || (kind === "off" && deleteChoice);
    setPending(null);
    setSaving(key);
    try {
      const result = await api.maintenance.setFeature(key, {
        enabled: kind === "on",
        ...(deleteData ? { deleteData: true } : {}),
      });
      if (kind === "on") {
        toast.success(
          result.recomputeScheduled
            ? t("features.toast.recompute", { name: name(key) })
            : t("features.toast.turnedOn", { name: name(key) }),
        );
      } else if (kind === "off") {
        toast.success(t("features.toast.turnedOff", { name: name(key) }));
      }
      await refresh();
      emitStorageChanged();
      if (result.cleanupRunId) void follow(key, result.cleanupRunId);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("features.toast.failed", { name: name(key) }),
      );
    } finally {
      if (mounted.current) setSaving(null);
    }
  };

  const stateBadge = (feature: WorkspaceFeatureState) => {
    const neverChosen =
      !feature.enabled &&
      feature.changedAt === null &&
      feature.deploymentDefault === false;
    const [label, tone] = feature.enabled
      ? [t("features.stateOn"), STATUS_TONE.active]
      : neverChosen
        ? [t("features.stateDefaultOff"), STATUS_TONE.idle]
        : feature.disabledMode === "deleted"
          ? [t("features.stateOffDeleted"), STATUS_TONE.idle]
          : [t("features.stateOffKept"), STATUS_TONE.progress];
    return (
      <Badge
        variant="outline"
        data-testid={`feature-state-${feature.key}`}
        className={`${statusBadgeClass} ${tone}`}
        title={neverChosen ? t("features.defaultOffHint") : undefined}
      >
        {label}
      </Badge>
    );
  };

  const renderRow = (feature: WorkspaceFeatureState) => {
    const key = feature.key;
    const run = runs[key];
    const deleting = Boolean(run || feature.cleanupRunId);
    const busy = saving === key || deleting;
    const canDeleteKept =
      !feature.enabled &&
      feature.disabledMode !== "deleted" &&
      feature.dataBytes > 0;
    return (
      <div
        key={key}
        data-testid={`feature-row-${key}`}
        className="flex items-start justify-between gap-4 rounded-[4px] border border-border p-4"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{name(key)}</p>
            {stateBadge(feature)}
            {feature.changedAt ? (
              <span className="text-[11px] text-muted-foreground">
                {t("features.since", { when: formatDate(feature.changedAt) })}
              </span>
            ) : null}
          </div>
          <p className="max-w-prose text-xs text-muted-foreground">
            {t(`features.items.${key}.desc` as TranslationKey)}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="tabular-nums">
              {feature.dataBytes > 0
                ? t("features.dataSize", {
                    size: formatBytes(feature.dataBytes),
                    rows: feature.dataRows.toLocaleString(),
                  })
                : t("features.noData")}
            </span>
            <Link
              href={nsPath(CONFIGURE_PATH[key])}
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:no-underline"
            >
              {t(`features.items.${key}.configure` as TranslationKey)}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>
          {feature.heldQueues.length > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-amber-800 dark:text-amber-300">
              <Pause className="h-3 w-3 shrink-0" aria-hidden />
              <span className="font-mono">
                {t("features.workersPaused", {
                  queues: feature.heldQueues.join(", "),
                })}
              </span>
              <Link
                href={nsPath("/settings?tab=workers")}
                className="underline underline-offset-2 hover:no-underline"
              >
                {t("features.viewWorkers")}
              </Link>
            </p>
          ) : null}
          {deleting ? (
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              <span className="tabular-nums">
                {run?.note ??
                  t("features.deleting", {
                    rows: (run?.processed ?? 0).toLocaleString(),
                  })}
              </span>
            </p>
          ) : canDeleteKept ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-1 h-7 gap-1 rounded-[4px] text-[11px]"
              disabled={demoMode || busy}
              onClick={() => setPending({ kind: "delete", feature })}
            >
              <Trash2 className="h-3 w-3" aria-hidden />
              {t("features.deleteData")}
            </Button>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {saving === key ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : null}
          <Switch
            checked={feature.enabled}
            disabled={demoMode || busy}
            aria-label={t("features.switchLabel", { name: name(key) })}
            data-testid={`feature-switch-${key}`}
            onCheckedChange={(checked) => {
              setDeleteChoice(false);
              setPending({ kind: checked ? "on" : "off", feature });
            }}
          />
        </div>
      </div>
    );
  };

  // Radix keeps a dialog mounted through its close animation, so reading
  // `pending` directly made the contents flash empty ("Turn off ?") on the
  // way out. Render from the last thing that was open instead.
  const lastPending = React.useRef<Pending | null>(null);
  if (pending) lastPending.current = pending;
  const dialogFeature = (pending ?? lastPending.current)?.feature;
  const dialogName = dialogFeature ? name(dialogFeature.key) : "";
  const size = dialogFeature ? formatBytes(dialogFeature.dataBytes) : "";

  return (
    <Card id="features" className="panel-card scroll-mt-24 rounded-[6px]">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Power className="h-4 w-4" />
          <p className="text-xs font-mono uppercase tracking-[0.14em]">
            {t("features.title")}
          </p>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          {t("features.subtitle")}
        </p>

        {loading && !features ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("features.loading")}
          </div>
        ) : !features ? (
          <div className="flex flex-wrap items-center gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              {failed ? t("features.loadFailed") : t("features.loading")}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-[4px]"
              onClick={() => void refresh()}
            >
              {t("features.retry")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">{features.map(renderRow)}</div>
        )}
      </CardContent>

      {/* Turn off: what stops, then keep or delete. */}
      <AlertDialog
        open={pending?.kind === "off"}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent className="max-w-xl rounded-[6px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-lg font-black uppercase tracking-[0.06em]">
              {t("features.off.title", { name: dialogName })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-xs text-muted-foreground">
                <div className="space-y-1">
                  <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-foreground">
                    {t("features.off.stops")}
                  </p>
                  <ul className="list-disc space-y-1 pl-4">
                    {dialogFeature
                      ? STOP_KEYS.map((stop) => (
                          <li key={stop}>
                            {t(
                              `features.off.${dialogFeature.key}.${stop}` as TranslationKey,
                            )}
                          </li>
                        ))
                      : null}
                  </ul>
                </div>
                <div className="grid gap-2" role="radiogroup">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!deleteChoice}
                    data-testid="feature-off-keep"
                    onClick={() => setDeleteChoice(false)}
                    className={`rounded-[4px] border-2 p-3 text-left transition-colors ${
                      !deleteChoice
                        ? "border-foreground/60 bg-muted/40"
                        : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-foreground">
                      <RadioDot checked={!deleteChoice} />
                      {t("features.off.keepLabel")}
                    </span>
                    <span className="mt-1 block">{t("features.off.keepDesc")}</span>
                    {dialogFeature ? (
                      <span className="mt-1 block">
                        {t(
                          `features.off.${dialogFeature.key}.keep` as TranslationKey,
                        )}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={deleteChoice}
                    data-testid="feature-off-delete"
                    onClick={() => setDeleteChoice(true)}
                    className={`rounded-[4px] border-2 p-3 text-left transition-colors ${
                      deleteChoice
                        ? "border-amber-600/70 bg-amber-500/10"
                        : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] text-foreground">
                      <RadioDot checked={deleteChoice} />
                      <Trash2 className="h-3 w-3" aria-hidden />
                      {t("features.off.deleteLabel", { size })}
                    </span>
                    <span className="mt-1 block">
                      {t("features.off.deleteDesc")}
                    </span>
                    {dialogFeature ? (
                      <span className="mt-1 flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>
                          {t(
                            `features.off.${dialogFeature.key}.delete` as TranslationKey,
                          )}
                        </span>
                      </span>
                    ) : null}
                  </button>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-[4px] text-xs">
              {t("features.off.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="feature-off-confirm"
              className={`rounded-[4px] text-xs ${
                deleteChoice
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : ""
              }`}
              onClick={(event) => {
                event.preventDefault();
                void apply();
              }}
            >
              {deleteChoice
                ? t("features.off.confirmDelete")
                : t("features.off.confirmKeep")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Turn on: what catching up costs. */}
      <AlertDialog
        open={pending?.kind === "on"}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent className="rounded-[6px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-lg font-black uppercase tracking-[0.06em]">
              {t("features.enable.title", { name: dialogName })}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              {dialogFeature?.key === "duplicates"
                ? t("features.enable.duplicates")
                : dialogFeature?.disabledMode === "deleted"
                  ? t("features.enable.embeddingsDeleted")
                  : t("features.enable.embeddingsKept")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-[4px] text-xs">
              {t("features.enable.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="feature-on-confirm"
              className="rounded-[4px] text-xs"
              onClick={(event) => {
                event.preventDefault();
                void apply();
              }}
            >
              {t("features.enable.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete what a paused feature kept. */}
      <AlertDialog
        open={pending?.kind === "delete"}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent className="rounded-[6px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-lg font-black uppercase tracking-[0.06em]">
              {t("features.deleteKept.title", { name: dialogName })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>
                  {t("features.deleteKept.desc", { name: dialogName, size })}
                </p>
                {dialogFeature ? (
                  <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      {t(
                        `features.off.${dialogFeature.key}.delete` as TranslationKey,
                      )}
                    </span>
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-[4px] text-xs">
              {t("features.deleteKept.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="feature-delete-confirm"
              className="rounded-[4px] bg-destructive text-xs text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void apply();
              }}
            >
              {t("features.deleteKept.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
