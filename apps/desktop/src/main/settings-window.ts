import { BrowserWindow, app, clipboard, dialog, ipcMain, nativeTheme } from 'electron';
import path from 'path';
import { SETTINGS_HTML } from './settings-page.js';
import {
  restartRequired,
  type AppSettings,
  type SettingsManager,
} from './settings-manager.js';
import type { ReadonlyDbInfo } from './postgres-manager.js';

// Machine-level configuration, deliberately native rather than part of the
// in-app (web) settings: it configures the local processes, applies per
// installation rather than per workspace, and has to remain reachable when the
// API is unhealthy — which is exactly when someone needs it.
//
// Like the startup and update windows this is a data-URL page rather than a
// packaged asset, so it cannot be broken by a half-unpacked bundle. Unlike
// them it needs to talk back, so it loads the app's preload with a
// `--settings-window` marker that unlocks the `settingsAPI` bridge.

export interface SettingsWindowDeps {
  settingsManager: SettingsManager;
  /** Ports actually in use, which may differ from the preferred ones. */
  getEffectivePorts: () => { apiPort: number; postgresPort: number };
  getReadonlyInfo: () => Promise<ReadonlyDbInfo | null>;
  regenerateReadonly: () => Promise<ReadonlyDbInfo>;
  /** Called after a successful save so native menus can re-read the values. */
  onSaved: (settings: AppSettings) => void;
}

let settingsWindow: BrowserWindow | null = null;

function preloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

export function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 620,
    height: 760,
    minWidth: 520,
    minHeight: 520,
    title: 'Settings',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f5',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath(),
      additionalArguments: ['--settings-window'],
    },
  });
  settingsWindow = win;
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (settingsWindow === win) settingsWindow = null;
  });
  void win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(SETTINGS_HTML)}`,
  );
}

function closeSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
}

/**
 * Offers the restart the saved values are waiting for.
 *
 * A whole-app relaunch rather than an API-only restart: the database port and
 * the listener the read-only login needs are read by PostgreSQL at boot, so
 * restarting only the API would apply half the settings and quietly leave the
 * other half looking broken. The regular before-quit path still runs, so the
 * database and the API are shut down cleanly first.
 */
async function promptRestart(): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Restart Classifyre?',
    message: 'These settings apply when Classifyre restarts.',
    detail:
      'Restarting interrupts any scan that is running; it can be re-run ' +
      'afterwards. Choosing Later applies the new settings the next time the ' +
      'app starts.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return;
  app.relaunch();
  app.quit();
}

export function registerSettingsHandlers(deps: SettingsWindowDeps): void {
  ipcMain.handle('settings:load', async () => ({
    settings: deps.settingsManager.get(),
    effective: deps.getEffectivePorts(),
    readonly: await deps.getReadonlyInfo(),
  }));

  ipcMain.handle(
    'settings:save',
    async (_event, patch: Partial<AppSettings>) => {
      const before = deps.settingsManager.get();
      let after: AppSettings;
      try {
        after = deps.settingsManager.update(patch);
      } catch (error) {
        // A rejected value is the user's to correct, so it is reported in the
        // window rather than thrown across the bridge as a failed invoke.
        return { error: error instanceof Error ? error.message : String(error) };
      }
      deps.onSaved(after);

      // Answer first: closing the window destroys the renderer that is waiting
      // on this call, and a modal opened from inside the handler would block
      // the reply from ever arriving.
      setImmediate(() => {
        closeSettingsWindow();
        if (restartRequired(before, after)) void promptRestart();
      });
      return { ok: true };
    },
  );

  ipcMain.handle('settings:regenerate-readonly', () =>
    deps.regenerateReadonly(),
  );

  ipcMain.on('settings:copy', (_event, value: string) => {
    clipboard.writeText(String(value));
  });

  ipcMain.on('settings:close', () => closeSettingsWindow());
}
