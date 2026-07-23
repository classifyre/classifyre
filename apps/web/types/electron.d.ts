/**
 * Ambient typings for the API surface exposed by the Classifyre desktop app's
 * preload script (apps/desktop/src/preload/preload.ts) via contextBridge.
 *
 * These globals are only present when the web app is running inside the
 * Electron desktop shell's BrowserWindow. Always guard access with an
 * optional chain / existence check, e.g. `window.electronAPI?.selectFolder`.
 */
export {};

declare global {
  interface ElectronDesktopAPI {
    /**
     * Opens the native OS folder picker. Resolves with the chosen absolute
     * path, or `path: null` if the user canceled the dialog.
     */
    selectFolder: () => Promise<{ canceled: boolean; path: string | null }>;
    verifyRemoteInstance: (
      remoteUrl: string,
    ) => Promise<{ normalizedUrl: string; namespaceCount: number }>;
    notifyNamespacesChanged: () => void;
    openExternal: (url: string) => Promise<void>;
    showNotification: (payload: Record<string, unknown>) => void;
    onNotificationNavigate: (callback: (url: string) => void) => () => void;
    [key: string]: unknown;
  }

  interface ClassifyreDesktopContext {
    apiBaseUrl: string;
    wsBaseUrl: string;
  }

  interface Window {
    electronAPI?: ElectronDesktopAPI;
    __CLASSIFYRE_DESKTOP__?: ClassifyreDesktopContext;
  }
}
