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
    /**
     * Live count of the workspaces a registered remote is offering. Read in the
     * main process because the renderer cannot reach another origin's API.
     */
    remoteNamespaceCount: (remoteUrl: string) => Promise<number>;
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

  /**
   * The subset of Electron's `<webview>` element the remote-workspace browser
   * drives (apps/web/components/namespace/remote-workspace-browser.tsx). The
   * tag only exists inside the desktop shell, where the main process enables
   * `webviewTag` and locks down the guest's preferences.
   */
  interface ClassifyreWebviewElement extends HTMLElement {
    src: string;
    getURL(): string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    stop(): void;
  }
}

// React 19 no longer declares a global `JSX` namespace, so the intrinsic
// element is registered through the module's own namespace instead.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<ClassifyreWebviewElement> & {
          src?: string;
          partition?: string;
        },
        ClassifyreWebviewElement
      >;
    }
  }
}
