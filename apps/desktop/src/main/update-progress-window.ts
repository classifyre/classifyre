import { BrowserWindow } from 'electron';

// Small frameless window shown while an update downloads. Electron has no
// native progress dialog, and `dialog.showMessageBox` is either blocking or
// dismissable-and-gone — neither can show a live percentage. This is a plain
// data-URL page driven from the main process via executeJavaScript, so it
// needs no preload, no IPC channel and no packaged asset.

const HTML = `
<meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: flex; flex-direction: column; justify-content: center;
    gap: 10px; height: 100vh; padding: 0 22px; box-sizing: border-box;
    background: #fafaf9; color: #1c1917;
  }
  #title { font-size: 14px; font-weight: 600; }
  #detail { opacity: .65; }
  #track { height: 6px; border-radius: 3px; background: #e7e5e4; overflow: hidden; }
  #bar { height: 100%; width: 0%; background: #d97706; transition: width .15s linear; }
  #bar.indeterminate { width: 35%; animation: slide 1.1s ease-in-out infinite alternate; }
  @keyframes slide { from { margin-left: 0 } to { margin-left: 65% } }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1917; color: #fafaf9; }
    #track { background: #44403c; }
  }
</style>
<div id="title">Downloading update…</div>
<div id="track"><div id="bar" class="indeterminate"></div></div>
<div id="detail">Starting download…</div>
`;

export class UpdateProgressWindow {
  private window: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;

  constructor(private version: string) {}

  show(): void {
    if (this.window) return;
    this.window = new BrowserWindow({
      width: 420,
      height: 150,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Updating Classifyre',
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    this.window.setMenuBarVisibility(false);
    // The user closing this window only hides progress; the download keeps
    // going and still reports through the tray + the completion prompt.
    this.window.on('closed', () => {
      this.window = null;
      this.ready = null;
    });
    this.ready = this.window
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`)
      .then(() => {
        this.window?.show();
      })
      .catch((err: unknown) => {
        console.error('[update] progress window failed to load:', err);
      });
    void this.setTitle(`Downloading Classifyre ${this.version}…`);
  }

  /** Renders a percentage (0-100), or an indeterminate bar when null. */
  setProgress(percent: number | null, detail: string): void {
    void this.run(
      percent === null
        ? `document.getElementById('bar').classList.add('indeterminate');`
        : `(() => { const b = document.getElementById('bar');
             b.classList.remove('indeterminate'); b.style.width = ${percent} + '%'; })();`,
      detail,
    );
  }

  close(): void {
    const win = this.window;
    this.window = null;
    this.ready = null;
    if (win && !win.isDestroyed()) win.destroy();
  }

  private async setTitle(title: string): Promise<void> {
    await this.run(`document.getElementById('title').textContent = ${JSON.stringify(title)};`);
  }

  private async run(script: string, detail?: string): Promise<void> {
    try {
      await this.ready;
      const win = this.window;
      if (!win || win.isDestroyed()) return;
      const detailScript =
        detail === undefined
          ? ''
          : `document.getElementById('detail').textContent = ${JSON.stringify(detail)};`;
      await win.webContents.executeJavaScript(`${script}${detailScript}`);
    } catch {
      // Cosmetic only — never let progress rendering break the download.
    }
  }
}
