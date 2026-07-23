import { ipcMain, dialog, BrowserWindow, shell } from 'electron';
import type { NamespaceStore } from './namespace-store.js';
import { verifyClassifyreRemote } from './remote-instance.js';

export function registerIpcHandlers(namespaceStore: NamespaceStore): void {
  ipcMain.handle('remote:verify', (_event, remoteUrl: string) => {
    return verifyClassifyreRemote(remoteUrl);
  });

  // The web app owns namespace CRUD. This signal only asks native menus to
  // refresh their read-only API snapshot after a mutation.
  ipcMain.on('namespaces:changed', () => {
    void namespaceStore.refresh();
  });

  ipcMain.handle('external:open', async (_event, value: string) => {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Only HTTP(S) URLs can be opened');
    }
    await shell.openExternal(url.toString());
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
