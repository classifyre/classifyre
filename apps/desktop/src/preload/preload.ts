import { contextBridge, ipcRenderer } from 'electron';

// Single shared API base for the whole app. Namespaces live in the API registry
// and are selected by the web app's `/<slug>/...` routes.
const apiBase = process.argv
  .find((arg) => arg.startsWith('--api-base='))
  ?.split('=')[1];

if (apiBase) {
  contextBridge.exposeInMainWorld('__CLASSIFYRE_DESKTOP__', {
    apiBaseUrl: apiBase,
    wsBaseUrl: apiBase,
  });
}

// The native settings window (src/main/settings-window.ts) is the only page
// allowed to read or change machine-level configuration, so its bridge is
// unlocked by the marker the main process passes to that window alone — the
// web UI, and any remote workspace it embeds, never sees it.
if (process.argv.includes('--settings-window')) {
  contextBridge.exposeInMainWorld('settingsAPI', {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (patch: Record<string, unknown>) =>
      ipcRenderer.invoke('settings:save', patch),
    regenerateReadonly: () => ipcRenderer.invoke('settings:regenerate-readonly'),
    copy: (value: string) => ipcRenderer.send('settings:copy', value),
    close: () => ipcRenderer.send('settings:close'),
  });
}

contextBridge.exposeInMainWorld('electronAPI', {
  verifyRemoteInstance: (remoteUrl: string) =>
    ipcRenderer.invoke('remote:verify', remoteUrl),
  remoteNamespaceCount: (remoteUrl: string) =>
    ipcRenderer.invoke('remote:namespace-count', remoteUrl),
  notifyNamespacesChanged: () => ipcRenderer.send('namespaces:changed'),
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url),

  // Native dialogs
  selectFolder: (): Promise<{ canceled: boolean; path: string | null }> =>
    ipcRenderer.invoke('dialog:select-folder'),

  // Native OS notifications: the web app forwards freshly-received in-app
  // notifications here; main renders the toast and deep-links the shared view
  // through onNotificationNavigate when the user clicks it.
  showNotification: (payload: Record<string, unknown>) =>
    ipcRenderer.send('notification:show', payload),
  onNotificationNavigate: (cb: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => cb(url);
    ipcRenderer.on('desktop-notification:navigate', listener);
    return () =>
      ipcRenderer.removeListener('desktop-notification:navigate', listener);
  },
});
