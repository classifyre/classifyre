import { BrowserWindow, app, nativeTheme } from 'electron';
import { getLogFilePath } from './logger.js';
import {
  STARTUP_BOOTSTRAP,
  STARTUP_HTML,
  STARTUP_STEPS,
  type StartupStep,
} from './startup-page.js';

export { STARTUP_STEPS, type StartupStep };

// Boot can take minutes on a cold install: embedded Postgres runs initdb, the
// bundled Python venv is relocated, the API tar is unpacked, and Prisma
// migrations run before the API binds its port. Without a window during that
// time the app looks dead in the dock — and clicking the dock icon used to open
// the real UI against an API that wasn't listening yet ("Failed to fetch" over
// empty skeletons). This window is the app's face until the API is actually
// ready, and it is the thing dock/tray activation focuses while starting.
//
// Like UpdateProgressWindow, it is a plain data-URL page driven from the main
// process via executeJavaScript: no preload, no IPC channel, no packaged asset
// (the startup UI must work before anything else is unpacked).

interface StartupState {
  title?: string;
  detail?: string;
  step?: StartupStep;
  error?: string;
  log?: string;
}

export interface StartupWindowDeps {
  /** Invoked when the user closes the window before startup finished. */
  onCancel: () => void;
}

export class StartupWindow {
  private window: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private closingProgrammatically = false;

  constructor(private readonly deps: StartupWindowDeps) {}

  show(): void {
    if (this.window) return;
    const win = new BrowserWindow({
      width: 480,
      height: 376,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Starting Classifyre',
      show: false,
      // Paint the window in the theme's background from the first frame; the
      // default white would flash against the dark UI.
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#f5f5f5',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    this.window = win;
    win.setMenuBarVisibility(false);

    // Closing this window is the only quit affordance during boot: the tray and
    // the application menu are not built until the API is up, so a close that
    // merely hid it would leave the app running with nothing on screen.
    win.on('closed', () => {
      if (this.window === win) this.window = null;
      this.ready = null;
      if (!this.closingProgrammatically) this.deps.onCancel();
    });

    this.ready = win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(STARTUP_HTML)}`)
      .then(async () => {
        if (win.isDestroyed()) return;
        try {
          await win.webContents.executeJavaScript(STARTUP_BOOTSTRAP);
        } finally {
          // Show even if the render script failed: a bare window still tells
          // the user the app is alive, whereas a hidden one is the very
          // "nothing happens" symptom this window exists to prevent.
          if (!win.isDestroyed()) win.show();
        }
      })
      .catch((err: unknown) => {
        console.error('[startup] progress window failed to load:', err);
      });

    this.update({ step: STARTUP_STEPS[0].id });
  }

  /** Marks the current phase; earlier steps render as complete. */
  setStep(step: StartupStep, detail = ''): void {
    this.update({ step, detail });
  }

  /** Sub-status under the checklist (e.g. what is being unpacked right now). */
  setDetail(detail: string): void {
    this.update({ detail });
  }

  /** Switches the window to a terminal error state and keeps it on screen. */
  showError(message: string): void {
    this.show();
    this.update({
      // Short enough to hold one line at display size — the summary and the
      // underlying error both render in the panel below it.
      title: 'Startup failed',
      error: message,
      log: getLogFilePath() ?? '',
    });
    this.focus();
  }

  focus(): void {
    const win = this.window;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (process.platform === 'darwin') app.dock?.show().catch(() => {});
  }

  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  /** Closes the window without treating it as a user cancellation. */
  close(): void {
    const win = this.window;
    this.window = null;
    this.ready = null;
    if (!win || win.isDestroyed()) return;
    this.closingProgrammatically = true;
    win.destroy();
  }

  private update(state: StartupState): void {
    void this.run(state);
  }

  private async run(state: StartupState): Promise<void> {
    try {
      await this.ready;
      const win = this.window;
      if (!win || win.isDestroyed()) return;
      await win.webContents.executeJavaScript(
        `window.__startup && window.__startup(${JSON.stringify(state)});`,
      );
    } catch {
      // Cosmetic only — never let progress rendering break startup.
    }
  }
}
