import { app } from 'electron';
import path from 'path';
import fs from 'fs';

export interface AppSettings {
  /**
   * Preferred port for the local API. 0 (the default) means 'pick any free
   * port'. A fixed port is only useful for pointing external tooling at the
   * local instance; the app itself always injects the resolved base URL.
   */
  apiPort: number;
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
  /**
   * How many scans may run at once across every workspace on this machine.
   * 0 means unlimited. Exported to the API as MAX_CONCURRENT_RUNNERS, which
   * is the same knob the Helm chart sets for Kubernetes deployments.
   */
  maxConcurrentRunners: number;
  /**
   * Publish a read-only PostgreSQL login for external tools (BI, psql).
   * Enabling it also makes the embedded database listen on the network — see
   * postgres-readonly.ts for the pg_hba rules that keep the superuser
   * loopback-only.
   */
  readonlyDbEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiPort: 0,
  postgresPort: 54320,
  runInBackground: true,
  desktopNotifications: true,
  memoryLimitMb: 0,
  maxConcurrentRunners: 2,
  readonlyDbEnabled: false,
};

/** Upper bound for {@link AppSettings.maxConcurrentRunners}; 0 means unlimited. */
export const MAX_CONCURRENT_RUNNERS_LIMIT = 16;

/**
 * Settings whose value is only read while a process is starting, so a change
 * needs a restart before it does anything. Kept next to the model because the
 * settings window uses it to decide whether to prompt.
 */
export const RESTART_REQUIRED_KEYS = [
  'apiPort',
  'postgresPort',
  'memoryLimitMb',
  'maxConcurrentRunners',
  'readonlyDbEnabled',
] as const satisfies readonly (keyof AppSettings)[];

/**
 * Validates a patch and returns the settings it would produce. Pure and
 * Electron-free so the bounds can be tested without booting the app.
 */
export function applySettingsPatch(
  current: AppSettings,
  patch: Partial<AppSettings>,
): AppSettings {
  const next: AppSettings = { ...current };

  if (patch.apiPort !== undefined) {
    const port = patch.apiPort;
    // 0 keeps the historical behaviour of binding an ephemeral port.
    if (!Number.isInteger(port) || port < 0 || port > 65535 || (port > 0 && port < 1024)) {
      throw new Error('API port must be 0 (automatic) or between 1024 and 65535');
    }
    next.apiPort = port;
  }
  if (patch.postgresPort !== undefined) {
    const port = patch.postgresPort;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Database port must be between 1024 and 65535');
    }
    next.postgresPort = port;
  }
  if (patch.runInBackground !== undefined) {
    next.runInBackground = patch.runInBackground === true;
  }
  if (patch.desktopNotifications !== undefined) {
    next.desktopNotifications = patch.desktopNotifications === true;
  }
  if (patch.memoryLimitMb !== undefined) {
    const limit = patch.memoryLimitMb;
    // 0 disables the override. Anything below 1 GB cannot boot the API.
    if (!Number.isInteger(limit) || limit < 0 || (limit > 0 && limit < 1024)) {
      throw new Error('Memory limit must be 0 (automatic) or at least 1024 MB');
    }
    next.memoryLimitMb = limit;
  }
  if (patch.maxConcurrentRunners !== undefined) {
    const value = patch.maxConcurrentRunners;
    if (!Number.isInteger(value) || value < 0 || value > MAX_CONCURRENT_RUNNERS_LIMIT) {
      throw new Error(
        `Concurrent scans must be between 0 (unlimited) and ${MAX_CONCURRENT_RUNNERS_LIMIT}`,
      );
    }
    next.maxConcurrentRunners = value;
  }
  if (patch.readonlyDbEnabled !== undefined) {
    next.readonlyDbEnabled = patch.readonlyDbEnabled === true;
  }

  return next;
}

/** Whether a change from `before` to `after` only takes effect on restart. */
export function restartRequired(before: AppSettings, after: AppSettings): boolean {
  return RESTART_REQUIRED_KEYS.some((key) => before[key] !== after[key]);
}

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
    // Validate the whole patch before anything is persisted, so a rejected
    // field cannot leave the file holding half of a save.
    this.settings = applySettingsPatch(this.settings, patch);
    fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
    return this.get();
  }
}
