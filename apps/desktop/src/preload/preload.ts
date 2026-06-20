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
  openNamespace: (id: string) =>
    ipcRenderer.invoke('namespace:open', id),
  closeNamespace: (id: string) =>
    ipcRenderer.invoke('namespace:close', id),
  isNamespaceOpen: (id: string) =>
    ipcRenderer.invoke('namespace:is-open', id),

  // Tab operations
  switchTab: (id: string) => ipcRenderer.invoke('tab:switch', id),
  showSelector: () => ipcRenderer.invoke('tab:show-selector'),
  closeTab: (id: string) => ipcRenderer.invoke('tab:close', id),
  getTabState: () => ipcRenderer.invoke('tab:get-state'),
  onTabsUpdate: (cb: (data: unknown) => void) => {
    ipcRenderer.on('tabs:update', (_event, data) => cb(data));
  },

  // Update operations
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb: (data: unknown) => void) => {
    ipcRenderer.on('update:status', (_event, data) => cb(data));
  },

  // Runtime info
  getApiPort: () => ipcRenderer.invoke('runtime:api-port'),
  getAppVersion: () => ipcRenderer.invoke('runtime:version'),
});
