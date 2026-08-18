"use client";

import * as React from "react";
import { AlertTriangle, ExternalLink, Loader2, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { api, getNamespacedApiBaseUrl } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { useTranslation } from "@/hooks/use-translation";

interface NotebookSessionPanelProps {
  /** Undefined until the source has been saved once. */
  sourceId?: string;
  disabled?: boolean;
}

type SessionStatus = "STARTING" | "READY" | "FAILED";

interface SessionState {
  id: string;
  status: SessionStatus;
  path: string;
  error?: string;
}

const POLL_INTERVAL_MS = 3000;

/**
 * The notebook half of a CUSTOM source: current revision, and the interactive
 * marimo editor.
 *
 * The editor is iframed against an API path rather than the session's own
 * address. That path is proxied to whatever is actually running the editor - a
 * pod IP under Kubernetes, a loopback port on the desktop - so this component
 * never has to know which runtime it is in.
 */
export function NotebookSessionPanel({
  sourceId,
  disabled = false,
}: NotebookSessionPanelProps) {
  const { t } = useTranslation();
  const [session, setSession] = React.useState<SessionState | null>(null);
  const [revision, setRevision] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refreshSession = React.useCallback(async () => {
    if (!sourceId) return;
    try {
      const current = (await api.customSources.customSourcesControllerGetSession(
        { sourceId },
      )) as SessionState | null;
      setSession(current && current.id ? current : null);
    } catch {
      setSession(null);
    }
  }, [sourceId]);

  const refreshNotebook = React.useCallback(async () => {
    if (!sourceId) return;
    try {
      const notebook =
        await api.customSources.customSourcesControllerGetNotebook({ sourceId });
      setRevision(notebook.isStarter ? null : notebook.revision);
    } catch {
      setRevision(null);
    }
  }, [sourceId]);

  React.useEffect(() => {
    void refreshSession();
    void refreshNotebook();
  }, [refreshSession, refreshNotebook]);

  // Poll only while the editor is coming up. Once it is READY the iframe owns
  // the connection and polling would be noise.
  React.useEffect(() => {
    if (session?.status !== "STARTING") return;
    const timer = setInterval(() => void refreshSession(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [session?.status, refreshSession]);

  // A session that has just ended is also the moment a new revision landed.
  React.useEffect(() => {
    if (session === null) void refreshNotebook();
  }, [session, refreshNotebook]);

  const start = async () => {
    if (!sourceId) return;
    setBusy(true);
    try {
      const started =
        (await api.customSources.customSourcesControllerStartSession({
          sourceId,
        })) as SessionState;
      setSession(started);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("sources.custom.sessionFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!sourceId) return;
    setBusy(true);
    try {
      await api.customSources.customSourcesControllerStopSession({ sourceId });
      setSession(null);
      await refreshNotebook();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not stop");
    } finally {
      setBusy(false);
    }
  };

  const editorUrl = session?.path
    ? `${getNamespacedApiBaseUrl().replace(/\/+$/, "")}${session.path}/`
    : null;

  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {t("sources.custom.notebookTitle")}
            </CardTitle>
            <CardDescription>
              {t("sources.custom.notebookHelp")}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {revision !== null && (
              <Badge variant="outline">
                {t("sources.custom.currentRevision", { revision })}
              </Badge>
            )}
            {session && session.status !== "FAILED" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={stop}
                disabled={busy || disabled}
                data-testid="btn-stop-notebook-session"
              >
                <Square className="mr-2 h-4 w-4" />
                {t("sources.custom.stopSession")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={start}
                disabled={busy || disabled || !sourceId}
                data-testid="btn-start-notebook-session"
              >
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {t("sources.custom.startSession")}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-muted-foreground">
            {t("sources.custom.executionWarning")}
          </p>
        </div>

        {!sourceId && (
          <p className="text-sm text-muted-foreground">
            {t("sources.custom.saveFirst")}
          </p>
        )}

        {sourceId && !session && revision === null && (
          <p className="text-sm text-muted-foreground">
            {t("sources.custom.noNotebook")}
          </p>
        )}

        {session?.status === "STARTING" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("sources.custom.sessionStarting")}
          </div>
        )}

        {session?.status === "FAILED" && (
          <p className="text-sm font-medium text-destructive">
            {session.error || t("sources.custom.sessionFailed")}
          </p>
        )}

        {session?.status === "READY" && editorUrl && (
          <div className="space-y-2">
            <div className="flex justify-end">
              <a
                href={editorUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                {t("sources.custom.openInNewTab")}
              </a>
            </div>
            <iframe
              src={editorUrl}
              title={t("sources.custom.notebookTitle")}
              className="h-[70vh] w-full rounded-md border border-input bg-background"
              // allow-same-origin is required: marimo stores editor state and
              // opens a websocket back to its own origin. The content is the
              // user's own notebook on their own instance.
              sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-forms"
              data-testid="notebook-editor-frame"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
