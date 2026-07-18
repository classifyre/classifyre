import { contextBridge, ipcRenderer } from 'electron';

const apiPort = process.argv
  .find((arg) => arg.startsWith('--api-port='))
  ?.split('=')[1];

const namespaceId = process.argv
  .find((arg) => arg.startsWith('--namespace-id='))
  ?.split('=')[1];

if (apiPort) {
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

  contextBridge.exposeInMainWorld('__CLASSIFYRE_DESKTOP__', {
    apiBaseUrl,
    wsBaseUrl: apiBaseUrl,
    namespaceId,
  });
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Namespace operations
  listNamespaces: () => ipcRenderer.invoke('namespace:list'),
  createNamespace: (name: string, remoteUrl?: string) =>
    ipcRenderer.invoke('namespace:create', name, remoteUrl),
  deleteNamespace: (id: string) =>
    ipcRenderer.invoke('namespace:delete', id),
  updateNamespace: (id: string, patch: Record<string, unknown>) =>
    ipcRenderer.invoke('namespace:update', id, patch),
  openNamespace: (id: string, options?: { activate?: boolean }) =>
    ipcRenderer.invoke('namespace:open', id, options),
  closeNamespace: (id: string) =>
    ipcRenderer.invoke('namespace:close', id),
  isNamespaceOpen: (id: string) =>
    ipcRenderer.invoke('namespace:is-open', id),
  getNamespaceThumbnail: (id: string) =>
    ipcRenderer.invoke('namespace:thumbnail', id),
  // Real open-lifecycle progress (db → schema → migrate → api → interface →
  // done/error), including opens started from the tray, menu, or session
  // restore — the selector cards animate from these instead of guessing.
  onOpenProgress: (cb: (data: { namespaceId: string; stage: string }) => void) => {
    ipcRenderer.on('namespace:open-progress', (_event, data) => cb(data));
  },

  // Tab operations
  switchTab: (id: string) => ipcRenderer.invoke('tab:switch', id),
  showSelector: () => ipcRenderer.invoke('tab:show-selector'),
  closeTab: (id: string) => ipcRenderer.invoke('tab:close', id),
  getTabState: () => ipcRenderer.invoke('tab:get-state'),
  onTabsUpdate: (cb: (data: unknown) => void) => {
    ipcRenderer.on('tabs:update', (_event, data) => cb(data));
  },

  // Global settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Record<string, unknown>) =>
    ipcRenderer.invoke('settings:update', patch),

  // Update operations
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openDownloadPage: () => ipcRenderer.invoke('update:open-download-page'),
  onUpdateStatus: (cb: (data: unknown) => void) => {
    ipcRenderer.on('update:status', (_event, data) => cb(data));
  },

  // Runtime info
  getApiPort: (namespaceId?: string) => ipcRenderer.invoke('runtime:api-port', namespaceId),
  getAppVersion: () => ipcRenderer.invoke('runtime:version'),

  // Native dialogs
  selectFolder: (): Promise<{ canceled: boolean; path: string | null }> =>
    ipcRenderer.invoke('dialog:select-folder'),

  // Native OS notifications: the web app forwards freshly-received in-app
  // notifications here; main renders the toast and, on click, deep-links the
  // originating workspace tab back through onNotificationNavigate.
  showNotification: (payload: Record<string, unknown>) =>
    ipcRenderer.send('notification:show', payload),
  onNotificationNavigate: (cb: (url: string) => void) => {
    ipcRenderer.on('desktop-notification:navigate', (_event, url: string) => cb(url));
  },
});
