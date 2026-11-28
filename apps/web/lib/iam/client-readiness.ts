"use client";

let checking: Promise<boolean> | null = null;

/**
 * Checks `/auth/ready/` from the browser and redirects to the auto-refreshing
 * `/auth/starting/` page when the deployment is still starting up (503).
 * Deduplicated so concurrent failing requests only probe once.
 */
export function redirectIfStarting(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.location.pathname.startsWith("/auth/starting")) {
    return Promise.resolve(true);
  }
  checking ??= (async () => {
    try {
      const response = await fetch("/auth/ready/", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 503) {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        window.location.assign(
          `/auth/starting/?returnTo=${encodeURIComponent(returnTo)}`,
        );
        return true;
      }
    } catch {
      // Ignore transient fetch errors and let normal UI error handling proceed.
    }
    return false;
  })().finally(() => {
    checking = null;
  });
  return checking;
}
