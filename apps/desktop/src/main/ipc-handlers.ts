import { ipcMain, app, dialog, BrowserWindow } from 'electron';
import { NamespaceRuntime } from './namespace-runtime.js';
import { NamespaceManager, type NamespaceUpdate } from './namespace-manager.js';
import { SettingsManager, type AppSettings } from './settings-manager.js';
import { UpdateChecker } from './update-checker.js';
import { PostgresManager } from './postgres-manager.js';

export function registerIpcHandlers(
  runtime: NamespaceRuntime,
  namespaceManager: NamespaceManager,
  settingsManager: SettingsManager,
  updateChecker: UpdateChecker,
  pg: PostgresManager,
): void {
  ipcMain.handle('namespace:list', () => {
    return namespaceManager.list();
  });

  ipcMain.handle('namespace:create', (_event, name: string, remoteUrl?: string) => {
    return namespaceManager.create(name, remoteUrl);
  });

  ipcMain.handle('namespace:delete', async (_event, id: string) => {
    const ns = namespaceManager.get(id);
    if (runtime.isOpen(id)) {
      await runtime.close(id);
    }
    namespaceManager.delete(id);
    // Drop the workspace's data so deleting actually frees the database.
    if (ns && ns.type === 'local' && pg.isRunning()) {
      try {
        await pg.dropSchema(ns.schemaName);
      } catch (err) {
        console.error(`Failed to drop schema ${ns.schemaName}:`, err);
      }
    }
  });

  ipcMain.handle('namespace:update', (_event, id: string, patch: NamespaceUpdate) => {
    return namespaceManager.update(id, patch);
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

  // Global app settings
  ipcMain.handle('settings:get', () => {
    return settingsManager.get();
  });

  ipcMain.handle('settings:update', (_event, patch: Partial<AppSettings>) => {
    return settingsManager.update(patch);
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

  ipcMain.handle('tab:get-state', () => {
    return runtime.getTabState();
  });

  // Update operations
  ipcMain.handle('update:check', async () => {
    await updateChecker.checkForUpdates();
  });

  ipcMain.handle('update:open-download-page', () => {
    updateChecker.openDownloadPage();
  });

  ipcMain.handle('runtime:api-port', () => {
    return null;
  });

  ipcMain.handle('runtime:version', () => {
    return app.getVersion();
  });

  // Native folder picker (used by LOCAL_FOLDER source config forms)
  ipcMain.handle(
    'dialog:select-folder',
    async (event): Promise<{ canceled: boolean; path: string | null }> => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const result = await (win
        ? dialog.showOpenDialog(win, {
            properties: ['openDirectory', 'createDirectory'],
          })
        : dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
          }));
      return {
        canceled: result.canceled,
        path: result.filePaths[0] ?? null,
      };
    },
  );
}
