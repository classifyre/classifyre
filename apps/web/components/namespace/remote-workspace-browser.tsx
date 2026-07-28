"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Globe2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { Namespace } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { useTranslation } from "@/hooks/use-translation";

/** Chromium's "navigation aborted" — a redirect or a user-cancelled load. */
const ERR_ABORTED = -3;

type LoadFailure = { code: number; description: string };

/**
 * A remote Classifyre server, browsed inside the desktop app.
 *
 * The remote serves its own web UI, so nothing here is a second copy of the
 * workspace directory or the dashboard: the guest view loads the remote's
 * origin and the user walks its namespaces exactly as they would in a browser
 * tab — with the remote's own session, and its UI always matching its API. All
 * this component adds is the chrome that a tab would otherwise provide, most
 * importantly the way back to the local workspace directory.
 */
export function RemoteWorkspaceBrowser({
  namespace,
  remoteUrl,
}: {
  namespace: Namespace;
  remoteUrl: string;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const viewRef = React.useRef<ClassifyreWebviewElement | null>(null);
  const [currentUrl, setCurrentUrl] = React.useState(remoteUrl);
  const [loading, setLoading] = React.useState(true);
  const [failure, setFailure] = React.useState<LoadFailure | null>(null);
  const [history, setHistory] = React.useState({ back: false, forward: false });

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const syncHistory = () =>
      setHistory({ back: view.canGoBack(), forward: view.canGoForward() });
    const onNavigate = (event: Event) => {
      const url = (event as Event & { url?: string }).url;
      if (url) setCurrentUrl(url);
      syncHistory();
    };
    const onStart = () => {
      setLoading(true);
      setFailure(null);
    };
    const onStop = () => {
      setLoading(false);
      syncHistory();
    };
    const onFail = (event: Event) => {
      const detail = event as Event & {
        errorCode: number;
        errorDescription: string;
        isMainFrame?: boolean;
      };
      // Sub-resource failures and aborted navigations are normal browsing
      // noise; only a failed main-frame load means the user sees nothing.
      if (detail.errorCode === ERR_ABORTED) return;
      if (detail.isMainFrame === false) return;
      setLoading(false);
      setFailure({
        code: detail.errorCode,
        description: detail.errorDescription,
      });
    };

    view.addEventListener("did-start-loading", onStart);
    view.addEventListener("did-stop-loading", onStop);
    view.addEventListener("did-navigate", onNavigate);
    view.addEventListener("did-navigate-in-page", onNavigate);
    view.addEventListener("did-fail-load", onFail);
    return () => {
      view.removeEventListener("did-start-loading", onStart);
      view.removeEventListener("did-stop-loading", onStop);
      view.removeEventListener("did-navigate", onNavigate);
      view.removeEventListener("did-navigate-in-page", onNavigate);
      view.removeEventListener("did-fail-load", onFail);
    };
  }, []);

  const displayUrl = React.useMemo(() => {
    try {
      const parsed = new URL(currentUrl);
      return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    } catch {
      return currentUrl;
    }
  }, [currentUrl]);

  return (
    <div className="flex h-svh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/")}
          className="shrink-0"
        >
          <ArrowLeft className="mr-2 size-4" />
          {t("workspaces.backToDirectory")}
        </Button>

        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            disabled={!history.back}
            onClick={() => viewRef.current?.goBack()}
            aria-label={t("common.back")}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!history.forward}
            onClick={() => viewRef.current?.goForward()}
            aria-label={t("workspaces.remoteForward")}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => viewRef.current?.reload()}
            aria-label={t("workspaces.remoteReload")}
          >
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-sm border bg-secondary/40 px-3 py-1.5">
          <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-semibold uppercase tracking-[0.06em]">
            {namespace.name}
          </span>
          <span
            className="truncate font-mono text-[11px] text-muted-foreground"
            title={currentUrl}
          >
            {displayUrl}
          </span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          onClick={() => void window.electronAPI?.openExternal(currentUrl)}
          aria-label={t("workspaces.remoteOpenExternal")}
        >
          <ExternalLink className="size-4" />
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        {/* `partition` isolates each remote's cookies from the app and from
            every other remote, and persists them so a signed-in session
            survives a restart. It is fixed at attach time — hence the key. */}
        <webview
          key={namespace.id}
          ref={viewRef}
          src={remoteUrl}
          // eslint-disable-next-line react/no-unknown-property -- Electron's <webview>, not a DOM element the plugin knows
          partition={`persist:remote-${namespace.id}`}
          // Absolute, not `h-full`: the element's own `display: flex` makes it
          // collapse to zero height inside a flex parent.
          className="absolute inset-0"
        />

        {failure && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
            <TriangleAlert className="size-8 text-destructive" />
            <div className="space-y-1">
              <p className="font-semibold uppercase tracking-[0.06em]">
                {t("workspaces.remoteUnreachable", { name: namespace.name })}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {failure.description} ({failure.code})
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => viewRef.current?.reload()}
            >
              <RefreshCw className="mr-2 size-3.5" />
              {t("common.retry")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
