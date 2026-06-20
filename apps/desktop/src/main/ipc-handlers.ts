import { ipcMain, app } from 'electron';
import { NamespaceRuntime } from './namespace-runtime.js';
import { NamespaceManager } from './namespace-manager.js';
import { AutoUpdater } from './auto-updater.js';

export function registerIpcHandlers(
  runtime: NamespaceRuntime,
  namespaceManager: NamespaceManager,
  updater: AutoUpdater,
): void {
  ipcMain.handle('namespace:list', () => {
    return namespaceManager.list();
  });

  ipcMain.handle('namespace:create', (_event, name: string, remoteUrl?: string) => {
    return namespaceManager.create(name, remoteUrl);
  });

  ipcMain.handle('namespace:delete', async (_event, id: string) => {
    if (runtime.isOpen(id)) {
      await runtime.close(id);
    }
    namespaceManager.delete(id);
  });

  ipcMain.handle('namespace:open', async (_event, id: string) => {
    const entry = await runtime.open(id);
    return { apiPort: entry.apiPort, namespaceId: id };
  });

  ipcMain.handle('namespace:close', async (_event, id: string) => {
    await runtime.close(id);
  });

  ipcMain.handle('namespace:is-open', (_event, id: string) => {
    return runtime.isOpen(id);
  });

  // Tab operations
  ipcMain.handle('tab:switch', (_event, id: string) => {
    runtime.switchToTab(id);
  });

  ipcMain.handle('tab:show-selector', () => {
    console.log('[IPC] tab:show-selector called');
    runtime.showSelector();
    console.log('[IPC] tab:show-selector done, active tab:', runtime.getActiveTabId());
  });

  ipcMain.handle('tab:close', async (_event, id: string) => {
    await runtime.close(id);
  });

  ipcMain.handle('tab:get-state', () => {
    return runtime.getTabState();
  });

  // Update operations
  ipcMain.handle('update:check', async () => {
    await updater.checkForUpdates();
  });

  ipcMain.handle('update:download', async () => {
    await updater.downloadUpdate();
  });

  ipcMain.handle('update:install', () => {
    updater.quitAndInstall();
  });

  ipcMain.handle('runtime:api-port', () => {
    return null;
  });

  ipcMain.handle('runtime:version', () => {
    return app.getVersion();
  });
}
