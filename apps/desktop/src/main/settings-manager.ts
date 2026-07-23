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
}

export const DEFAULT_SETTINGS: AppSettings = {
  postgresPort: 54320,
  runInBackground: true,
  desktopNotifications: true,
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
    fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
    return this.get();
  }
}
