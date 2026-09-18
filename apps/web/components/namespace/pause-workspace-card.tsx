"use client";

import * as React from "react";
import {
  Button,
  Card,
  CardContent,
  Input,
  Label,
} from "@workspace/ui/components";
import { api } from "@workspace/api-client";
import { Loader2, OctagonPause, Play } from "lucide-react";
import { toast } from "sonner";
import { useNamespace } from "@/components/namespace-provider";
import { useTranslation } from "@/hooks/use-translation";
import { useServerConfig } from "@/components/server-config-provider";
import { useInstanceSettings } from "@/components/instance-settings-provider";

/**
 * Workspace-level pause, at the top of the Settings → Workers tab.
 *
 * Per-queue pause (below, in `WorkerQueuesCard`) holds individual queues;
 * this freezes the whole workspace: no runs, no schedules, no harness/dream
 * cycles and no duplicate checks, with mutating API calls rejected as 409.
 * Toggling refreshes the namespace context so the dashboard banner and the
 * directory badge flip without a reload.
 */
export function PauseWorkspaceCard() {
  const { namespace, refresh } = useNamespace();
  const { t } = useTranslation();
  const serverConfig = useServerConfig();
  const { settings } = useInstanceSettings();
  const demoMode = serverConfig.demoMode || settings.demoMode;

  const [reasonDraft, setReasonDraft] = React.useState(
    namespace?.pausedReason ?? "",
  );
  const [busy, setBusy] = React.useState(false);

  // The namespace arrives async and can change underneath (resume from the
  // registry settings page in another tab); the draft follows it until the
  // operator starts typing.
  React.useEffect(() => {
    setReasonDraft(namespace?.pausedReason ?? "");
  }, [namespace?.pausedReason]);

  const setPauseState = async (nextPaused: boolean) => {
    if (!namespace || busy || demoMode) return;
    setBusy(true);
    try {
      await api.namespaces.update(namespace.id, {
        paused: nextPaused,
        // Record a fresh reason when pausing; leave the stored one alone when
        // resuming so it still says why the workspace had been paused.
        ...(nextPaused
          ? { pausedReason: reasonDraft.trim() ? reasonDraft.trim() : null }
          : {}),
      });
      await refresh();
      toast.success(
        t(
          nextPaused
            ? "workspaces.pauseSuccess"
            : "workspaces.resumeSuccess",
          { name: namespace.name },
        ),
      );
    } catch (pauseError) {
      toast.error(
        pauseError instanceof Error
          ? pauseError.message
          : t("workspaces.pauseFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="panel-card rounded-[6px]">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <OctagonPause className="h-4 w-4" />
          <p className="text-xs font-mono uppercase tracking-[0.14em]">
            {t("workspaces.pauseSectionTitle")}
          </p>
          {namespace?.paused ? (
            <span className="rounded-sm border border-amber-600/40 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-400">
              {t("workspaces.pausedBadge")}
            </span>
          ) : null}
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          {t("workspaces.pauseSectionDescription")}
        </p>

        {!namespace ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : namespace.paused ? (
          <div className="flex flex-wrap items-center gap-3">
            {namespace.pausedAt ? (
              <p className="text-xs text-muted-foreground">
                {t("workspaces.pausedSince", {
                  when: new Date(namespace.pausedAt).toLocaleString(),
                })}
                {namespace.pausedReason
                  ? ` — ${namespace.pausedReason}`
                  : ""}
              </p>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-[4px]"
              disabled={busy || demoMode}
              onClick={() => void setPauseState(false)}
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              {busy
                ? t("workspaces.resumingAction")
                : t("workspaces.resumeAction")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="workers-pause-reason">
                {t("workspaces.pauseReasonLabel")}
              </Label>
              <Input
                id="workers-pause-reason"
                value={reasonDraft}
                onChange={(event) => setReasonDraft(event.target.value)}
                placeholder={t("workspaces.pauseReasonPlaceholder")}
                disabled={busy || demoMode}
                maxLength={280}
                className="h-9 rounded-[4px] border-2 border-border"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-9 rounded-[4px] sm:shrink-0"
              disabled={busy || demoMode}
              onClick={() => void setPauseState(true)}
            >
              <OctagonPause className="mr-1.5 h-3.5 w-3.5" />
              {busy
                ? t("workspaces.pausingAction")
                : t("workspaces.pauseAction")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
