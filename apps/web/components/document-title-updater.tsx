"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTranslation } from "@/hooks/use-translation";

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

  return null;
}

export function DocumentTitleUpdater() {
  const { t } = useTranslation();
  const pathname = usePathname();

  useEffect(() => {
    const key = getTitleKey(pathname);
    if (key) {
      const pageTitle = t(key as Parameters<typeof t>[0]);
      const appName = t("app.name");
      document.title = `${pageTitle} | ${appName}`;
    }
  }, [pathname, t]);

  return null;
}
