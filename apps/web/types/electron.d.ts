/**
 * Ambient typings for the API surface exposed by the Classifyre desktop app's
 * preload script (apps/desktop/src/preload/preload.ts) via contextBridge.
 *
 * These globals are only present when the web app is running inside the
 * Electron desktop shell's WebContentsView. Always guard access with an
 * optional chain / existence check, e.g. `window.electronAPI?.selectFolder`.
 */
export {};

declare global {
  interface ElectronNamespace {
    id: string;
    name: string;
    type: "local" | "remote";
    schemaName: string;
    remoteUrl?: string;
    createdAt: string;
    lastOpenedAt: string;
  }

  interface ElectronDesktopAPI {
    /**
     * Opens the native OS folder picker. Resolves with the chosen absolute
     * path, or `path: null` if the user canceled the dialog.
     */
    selectFolder: () => Promise<{ canceled: boolean; path: string | null }>;
    listNamespaces: () => Promise<ElectronNamespace[]>;
    createNamespace: (
      name: string,
      remoteUrl?: string,
    ) => Promise<ElectronNamespace>;
    verifyRemoteInstance: (
      remoteUrl: string,
    ) => Promise<{ normalizedUrl: string; namespaceCount: number }>;
    deleteNamespace: (id: string) => Promise<void>;
    openNamespace: (
      id: string,
      options?: { activate?: boolean },
    ) => Promise<{ apiPort: number; namespaceId: string }>;
    showNotification: (payload: Record<string, unknown>) => void;
    onNotificationNavigate: (callback: (url: string) => void) => () => void;
    showSelector: () => Promise<void>;
    [key: string]: unknown;
  }

  interface ClassifyreDesktopContext {
    apiBaseUrl: string;
    wsBaseUrl: string;
    namespaceId?: string;
  }

  interface Window {
    electronAPI?: ElectronDesktopAPI;
    __CLASSIFYRE_DESKTOP__?: ClassifyreDesktopContext;
  }
}
