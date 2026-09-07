"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useTranslation } from "@/hooks/use-translation";
import { useOptionalNamespace } from "@/components/namespace-provider";
import { stripLocalePrefix } from "@/lib/locale-detection";

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
  "/duplicates": "nav.fingerprints",
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

const EntityTitleContext = React.createContext<
  ((name: string | null) => void) | null
>(null);

/**
 * Announce the display name of the entity a detail page is showing, so the tab
 * title can say "Invoices Q3" rather than "Asset Details".
 *
 * Detail pages must go through this rather than assigning `document.title`
 * themselves: {@link DocumentTitleUpdater} reasserts its own title through a
 * `MutationObserver`, so a direct write is raced and reverted.
 *
 * Never pass detected content (a finding's `matchedContent` is by definition
 * the PII or secret that was found). The title reaches PostHog as `$title`,
 * browser history, window titles and screenshots.
 */
export function useEntityDocumentTitle(name: string | null | undefined): void {
  const setEntityName = React.useContext(EntityTitleContext);
  React.useEffect(() => {
    if (!setEntityName) return;
    setEntityName(name ?? null);
    return () => setEntityName(null);
  }, [setEntityName, name]);
}

export function DocumentTitleUpdater({
  children,
}: {
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const namespace = useOptionalNamespace();
  const workspaceName = namespace?.displayName ?? null;
  const [entityName, setEntityName] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Inside a workspace every route is `/<locale?>/<namespaceSlug>/…`; the
    // title map is keyed on the app-relative path underneath both.
    const { rest } = stripLocalePrefix(pathname);
    const appPath = namespace
      ? "/" + rest.split("/").filter(Boolean).slice(1).join("/")
      : rest;

    const key = getTitleKey(appPath);
    if (!key) {
      return;
    }

    const pageTitle = entityName ?? t(key as Parameters<typeof t>[0]);
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
  }, [entityName, namespace, pathname, t, workspaceName]);

  return (
    <EntityTitleContext.Provider value={setEntityName}>
      {children}
    </EntityTitleContext.Provider>
  );
}
