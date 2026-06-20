import { app } from 'electron';
import type { WebContentsView } from 'electron';

type UpdateStatus =
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available' }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string };

export class AutoUpdater {
  private tabBarView: WebContentsView | null = null;
  private autoUpdater: any = null;

  async init(): Promise<void> {
    if (!app.isPackaged) return;

    try {
      const { autoUpdater } = await import('electron-updater');
      this.autoUpdater = autoUpdater;

      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;

      autoUpdater.on('checking-for-update', () => {
        this.sendStatus({ status: 'checking' });
      });

      autoUpdater.on('update-available', (info: { version: string }) => {
        this.sendStatus({ status: 'available', version: info.version });
      });

      autoUpdater.on('update-not-available', () => {
        this.sendStatus({ status: 'not-available' });
      });

      autoUpdater.on('download-progress', (progress: { percent: number }) => {
        this.sendStatus({ status: 'downloading', percent: progress.percent });
      });

      autoUpdater.on('update-downloaded', (info: { version: string }) => {
        this.sendStatus({ status: 'ready', version: info.version });
      });

      autoUpdater.on('error', (err: Error) => {
        this.sendStatus({ status: 'error', message: err.message });
      });
    } catch {
      // electron-updater not available (dev mode or not installed)
    }
  }

  setTabBarView(view: WebContentsView): void {
    this.tabBarView = view;
  }

  async checkForUpdates(): Promise<void> {
    if (!this.autoUpdater) return;
    try {
      await this.autoUpdater.checkForUpdates();
    } catch {
      // Network error or no releases — silent
    }
  }

  async downloadUpdate(): Promise<void> {
    if (!this.autoUpdater) return;
    await this.autoUpdater.downloadUpdate();
  }

  quitAndInstall(): void {
    if (!this.autoUpdater) return;
    this.autoUpdater.quitAndInstall();
  }

  private sendStatus(status: UpdateStatus): void {
    if (!this.tabBarView) return;
    this.tabBarView.webContents.send('update:status', status);
  }
}
