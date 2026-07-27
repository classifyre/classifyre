import { BrowserWindow, app } from 'electron';
import { getLogFilePath } from './logger.js';

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

/** Ordered boot phases, rendered as a checklist. */
export const STARTUP_STEPS = [
  { id: 'database', label: 'Starting the local database' },
  { id: 'runtime', label: 'Preparing bundled components' },
  { id: 'service', label: 'Starting the Classifyre service' },
  { id: 'interface', label: 'Loading the interface' },
] as const;

export type StartupStep = (typeof STARTUP_STEPS)[number]['id'];

const STEP_ITEMS = STARTUP_STEPS.map(
  (step) => `<li data-step="${step.id}"><span class="mark"></span>${step.label}</li>`,
).join('');

const HTML = `
<meta charset="utf-8">
<title>Starting Classifyre</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; padding: 26px 28px;
    display: flex; flex-direction: column; gap: 14px;
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #fafaf9; color: #1c1917;
    user-select: none; cursor: default;
  }
  #brand {
    font-size: 10px; font-weight: 600; letter-spacing: .18em;
    text-transform: uppercase; opacity: .5;
  }
  #title { font-family: ui-serif, Georgia, "Times New Roman", serif; font-size: 21px; }
  #track { height: 5px; border-radius: 3px; background: #e7e5e4; overflow: hidden; }
  #bar { height: 100%; width: 35%; background: #d97706; border-radius: 3px; }
  #bar.indeterminate { animation: slide 1.2s ease-in-out infinite alternate; }
  @keyframes slide { from { margin-left: 0 } to { margin-left: 65% } }
  ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 7px; }
  li { display: flex; align-items: center; gap: 9px; opacity: .38; }
  li[data-state="active"] { opacity: 1; font-weight: 600; }
  li[data-state="done"] { opacity: .62; }
  .mark {
    width: 13px; height: 13px; flex: none; border-radius: 50%;
    border: 1.5px solid currentColor; opacity: .55;
  }
  li[data-state="active"] .mark { border-color: #d97706; border-right-color: transparent; opacity: 1; animation: spin .8s linear infinite; }
  li[data-state="done"] .mark { border-color: #d97706; background: #d97706; opacity: 1; }
  @keyframes spin { to { transform: rotate(360deg) } }
  #detail { margin-top: auto; opacity: .6; }
  #hint { opacity: .6; font-style: italic; display: none; }
  #hint.visible { display: block; }
  #error { display: none; }
  body.failed #steps, body.failed #track, body.failed #detail, body.failed #hint { display: none; }
  /* A long failure message must scroll inside the window, never clip. */
  body.failed { overflow-y: auto; }
  body.failed #error { display: flex; flex-direction: column; gap: 8px; margin-top: auto; }
  #message { color: #b91c1c; white-space: pre-wrap; overflow-wrap: anywhere; }
  #log { font-size: 11px; opacity: .6; overflow-wrap: anywhere; }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1917; color: #fafaf9; }
    #track { background: #44403c; }
    #message { color: #f87171; }
  }
</style>
<div id="brand">Classifyre</div>
<div id="title">Starting up…</div>
<div id="track"><div id="bar" class="indeterminate"></div></div>
<ul id="steps">${STEP_ITEMS}</ul>
<div id="detail"></div>
<div id="hint">First launch takes a few minutes while bundled components are prepared. You can leave this window open.</div>
<div id="error"><div id="message"></div><div id="log"></div></div>
`;

// Defined after load rather than inline in the page, so the markup above stays
// script-free (same approach as the update progress window).
const BOOTSTRAP = `
window.__startup = (state) => {
  const steps = ${JSON.stringify(STARTUP_STEPS.map((step) => step.id))};
  if (state.title !== undefined) document.getElementById('title').textContent = state.title;
  if (state.detail !== undefined) document.getElementById('detail').textContent = state.detail;
  if (state.step !== undefined) {
    const active = steps.indexOf(state.step);
    for (const [index, id] of steps.entries()) {
      const li = document.querySelector('[data-step="' + id + '"]');
      if (li) li.dataset.state = index < active ? 'done' : index === active ? 'active' : 'pending';
    }
    const bar = document.getElementById('bar');
    bar.classList.remove('indeterminate');
    // Reserve the last slice for the step in flight — never render 100% while
    // the app is still working.
    bar.style.width = Math.round(((active + 0.5) / steps.length) * 100) + '%';
    // A step that overruns gets the "this is normal" hint instead of silence.
    clearTimeout(window.__hintTimer);
    document.getElementById('hint').classList.remove('visible');
    window.__hintTimer = setTimeout(
      () => document.getElementById('hint').classList.add('visible'),
      ${20_000},
    );
  }
  if (state.error !== undefined) {
    clearTimeout(window.__hintTimer);
    document.body.classList.add('failed');
    document.getElementById('message').textContent = state.error;
    document.getElementById('log').textContent = state.log ? 'Log file: ' + state.log : '';
  }
};
`;

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
      width: 460,
      height: 330,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Starting Classifyre',
      show: false,
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
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`)
      .then(async () => {
        if (win.isDestroyed()) return;
        await win.webContents.executeJavaScript(BOOTSTRAP);
        if (!win.isDestroyed()) win.show();
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
      title: 'Classifyre could not start',
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
