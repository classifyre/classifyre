"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Globe2 } from "lucide-react";
import {
  api,
  setActiveNamespaceSlug,
  type Namespace,
} from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { RemoteWorkspaceBrowser } from "@/components/namespace/remote-workspace-browser";
import { useTranslation } from "@/hooks/use-translation";
import { isDesktopShell } from "@/lib/desktop";
import { useStaticRouteParam } from "@/lib/use-route-id";

/**
 * Browses a registered remote Classifyre server without leaving the desktop
 * app. The route is keyed by the *local* registry id (the remote's URL is
 * looked up from it), so the address bar never leaks a remote origin into the
 * app shell's own navigation.
 */
export default function RemoteWorkspacePage() {
  const namespaceId = useStaticRouteParam("namespaceId", "remote");
  const router = useRouter();
  const { t } = useTranslation();
  const [namespace, setNamespace] = React.useState<Namespace | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // `<webview>` only exists in the Electron shell. Resolved after mount so the
  // first render matches the static-export shell.
  const [embeddable, setEmbeddable] = React.useState<boolean | null>(null);

  // Outside any namespace: keep registry calls unprefixed.
  React.useEffect(() => {
    setActiveNamespaceSlug(undefined);
    setEmbeddable(isDesktopShell());
  }, []);

  React.useEffect(() => {
    if (!namespaceId) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await api.namespaces.get(namespaceId);
        if (cancelled) return;
        // A local workspace has no remote to embed — send it to its own routes.
        if (loaded.type !== "remote" || !loaded.remoteUrl) {
          router.replace(`/${loaded.slug}`);
          return;
        }
        setNamespace(loaded);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t("workspaces.loadFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [namespaceId, router, t]);

  if (error || (namespace && embeddable === false)) {
    return (
      <div className="flex h-svh flex-col items-center justify-center gap-5 bg-background px-6 text-center">
        <Globe2 className="size-8 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">
          {error ?? t("workspaces.remoteDesktopOnly")}
        </p>
        <div className="flex gap-2">
          {namespace?.remoteUrl && (
            <Button variant="default" asChild>
              <a href={namespace.remoteUrl}>{t("common.open")}</a>
            </Button>
          )}
          <Button variant="outline" onClick={() => router.push("/")}>
            <ArrowLeft className="mr-2 size-4" />
            {t("workspaces.backToDirectory")}
          </Button>
        </div>
      </div>
    );
  }

  if (!namespace || !namespace.remoteUrl || embeddable !== true) {
    return (
      <div className="flex h-svh flex-col bg-background">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
          <Skeleton className="h-8 w-36 bg-muted" />
          <Skeleton className="h-8 flex-1 bg-muted" />
        </div>
        <Skeleton className="min-h-0 flex-1 rounded-none bg-muted/50" />
      </div>
    );
  }

  return (
    <RemoteWorkspaceBrowser
      namespace={namespace}
      remoteUrl={namespace.remoteUrl}
    />
  );
}
