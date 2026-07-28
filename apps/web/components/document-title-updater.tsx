"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTranslation } from "@/hooks/use-translation";
import { useOptionalNamespace } from "@/components/namespace-provider";

const ROUTE_TITLE_KEYS: Record<string, string> = {
  "/discovery": "discovery.title",
  "/findings": "findings.title",
  "/assets": "assets.title",
  "/sources": "sources.title",
  "/sources/new": "sources.new.title",
  "/detectors": "detectors.title",
  "/detectors/new": "detectors.new.title",
  "/scans": "scans.title",
  "/notifications": "notifications.title",
  "/settings": "settings.title",
  "/investigations": "nav.investigations",
  "/fingerprints": "nav.fingerprints",
  "/glossary": "glossary.title",
  "/harness": "nav.harness",
};

function getTitleKey(pathname: string): string | null {
  // Exact match first
  if (ROUTE_TITLE_KEYS[pathname]) {
    return ROUTE_TITLE_KEYS[pathname];
  }

  // Dynamic routes
  if (pathname.startsWith("/sources/") && pathname.endsWith("/edit")) {
    return "sources.editSource";
  }
  if (
    pathname.startsWith("/sources/") &&
    !pathname.endsWith("/new") &&
    !pathname.endsWith("/edit")
  ) {
    return "sources.detail.title";
  }
  if (pathname.startsWith("/assets/")) {
    return "assets.detail.title";
  }
  if (pathname.startsWith("/findings/")) {
    return "findings.detail.title";
  }
  if (pathname.startsWith("/scans/")) {
    return "scans.detail.title";
  }
  if (pathname.startsWith("/detectors/")) {
    return "detectors.detail.title";
  }
  if (pathname.startsWith("/harness/")) {
    return "nav.harness";
  }

  return null;
}

export function DocumentTitleUpdater() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const namespace = useOptionalNamespace();
  const workspaceName = namespace?.displayName ?? null;

  useEffect(() => {
    // Inside a workspace every route is prefixed with `/<namespaceSlug>`;
    // the title map is keyed on the app-relative path underneath it.
    const appPath = namespace
      ? "/" + pathname.split("/").filter(Boolean).slice(1).join("/")
      : pathname;

    const key = getTitleKey(appPath);
    if (!key) {
      return;
    }

    const pageTitle = t(key as Parameters<typeof t>[0]);
    const appName = t("app.name");
    const desired = workspaceName
      ? `${pageTitle} - ${workspaceName} | ${appName}`
      : `${pageTitle} | ${appName}`;

    document.title = desired;

    // Route metadata is streamed in its own boundary, so React can write the
    // server-rendered <title> *after* this effect has run. Reassert ours until
    // the route changes; setting an identical title is a no-op, so the
    // observer settles immediately instead of looping.
    const observer = new MutationObserver(() => {
      if (document.title !== desired) {
        document.title = desired;
      }
    });
    observer.observe(document.head, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [namespace, pathname, t, workspaceName]);

  return null;
}
