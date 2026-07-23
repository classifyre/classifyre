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

contextBridge.exposeInMainWorld('electronAPI', {
  verifyRemoteInstance: (remoteUrl: string) =>
    ipcRenderer.invoke('remote:verify', remoteUrl),
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
