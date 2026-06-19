import { ipcMain, app } from 'electron';
import { NamespaceRuntime } from './namespace-runtime.js';
import { NamespaceManager } from './namespace-manager.js';

export function registerIpcHandlers(
  runtime: NamespaceRuntime,
  namespaceManager: NamespaceManager,
): void {
  ipcMain.handle('namespace:list', () => {
    return namespaceManager.list();
  });

  ipcMain.handle('namespace:create', (_event, name: string) => {
    return namespaceManager.create(name);
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
    runtime.showSelector();
  });

  ipcMain.handle('tab:close', async (_event, id: string) => {
    await runtime.close(id);
  });

  ipcMain.handle('runtime:api-port', (_event) => {
    return null;
  });

  ipcMain.handle('runtime:version', () => {
    return app.getVersion();
  });
}
