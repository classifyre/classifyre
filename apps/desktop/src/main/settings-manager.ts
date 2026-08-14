import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export interface AppSettings {
  /** Preferred embedded-Postgres port; the app skips forward if it's busy. */
  postgresPort: number;
  /** Keep the app services and tray alive when the window closes. */
  runInBackground: boolean;
  /** Show native OS notifications for in-app notifications (scan failures etc.). */
  desktopNotifications: boolean;
  /**
   * Override for the API process's V8 old-space cap, in MB. 0 (the default)
   * means 'size it automatically' — see computeApiHeapMb, and note that the
   * automatic value deliberately does not scale up with installed RAM.
   *
   * Raising this is rarely the answer to a heap-OOM crash and is often the
   * cause of one: a larger cap lets V8 defer collection, so garbage piles up
   * and the OS swaps it, and the failure arrives as an allocation that cannot
   * be satisfied. Raise it only when a scan needs a genuinely larger *live*
   * set — and values above ~4 GB are clamped, because Electron will not grant
   * them under ELECTRON_RUN_AS_NODE.
   */
  memoryLimitMb: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  postgresPort: 54320,
  runInBackground: true,
  desktopNotifications: true,
  memoryLimitMb: 0,
};

export class SettingsManager {
  private filePath: string;
  private settings: AppSettings;

  constructor() {
    const base = process.env['CLASSIFYRE_DATA_DIR'] || app.getPath('userData');
    this.filePath = path.join(base, 'settings.json');
    this.settings = this.load();
  }

  private load(): AppSettings {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<AppSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  update(patch: Partial<AppSettings>): AppSettings {
    if (patch.postgresPort !== undefined) {
      const port = patch.postgresPort;
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new Error('Database port must be between 1024 and 65535');
      }
      this.settings.postgresPort = port;
    }
    if (patch.runInBackground !== undefined) {
      this.settings.runInBackground = patch.runInBackground === true;
    }
    if (patch.desktopNotifications !== undefined) {
      this.settings.desktopNotifications = patch.desktopNotifications === true;
    }
    if (patch.memoryLimitMb !== undefined) {
      const limit = patch.memoryLimitMb;
      // 0 disables the override. Anything below 1 GB cannot boot the API.
      if (!Number.isInteger(limit) || limit < 0 || (limit > 0 && limit < 1024)) {
        throw new Error('Memory limit must be 0 (automatic) or at least 1024 MB');
      }
      this.settings.memoryLimitMb = limit;
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
    return this.get();
  }
}
