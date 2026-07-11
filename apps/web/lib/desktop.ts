/**
 * Detects whether the web app is currently running inside the Classifyre
 * desktop (Electron) shell, where the Electron preload script stamps
 * `window.__CLASSIFYRE_DESKTOP__` before the page loads (see
 * `apps/web/hooks/use-runner-websocket.ts` for another consumer of this
 * global). Local development is also treated as "desktop" so engineers can
 * see desktop-only source types (e.g. LOCAL_FOLDER) without packaging the
 * Electron app.
 */
export function isDesktopRuntime(): boolean {
  if (typeof window !== "undefined" && !!(window as any).__CLASSIFYRE_DESKTOP__) {
    return true;
  }

  return process.env.NODE_ENV === "development";
}
