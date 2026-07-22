import { BrowserWindow, WebContentsView, dialog, shell } from 'electron';
import http from 'http';
import { PostgresManager } from './postgres-manager.js';
import { ProcessManager } from './process-manager.js';
import { NamespaceManager, assertValidRemoteUrl, type Namespace } from './namespace-manager.js';
import { getAvailablePort } from './port-manager.js';
import { captureViewThumbnail } from './thumbnails.js';
import { verifyClassifyreRemote } from './remote-instance.js';

const TAB_BAR_HEIGHT = 44;

/** Resolves when `promise` settles or `ms` elapses, whichever comes first. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

/** Lifecycle stages of a workspace open, streamed to the selector page. */
export type OpenStage = 'db' | 'schema' | 'migrate' | 'api' | 'interface' | 'done' | 'error';

interface RunningNamespace {
  namespace: Namespace;
  apiPort: number;
  view: WebContentsView;
}

export class NamespaceRuntime {
  private running = new Map<string, RunningNamespace>();
  private mainWindow: BrowserWindow | null = null;
  private tabBarView: WebContentsView | null = null;
  private selectorView: WebContentsView | null = null;
  private activeTabId: string | null = null;
  private stateChangeListeners = new Set<() => void>();

  constructor(
    private pg: PostgresManager,
    private processManager: ProcessManager,
    private namespaceManager: NamespaceManager,
    private isDev: boolean,
    private preloadPath: string,
  ) {}

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
    win.on('resize', () => this.layoutViews());
  }

  setTabBarView(view: WebContentsView): void {
    this.tabBarView = view;
  }

  setSelectorView(view: WebContentsView): void {
    this.selectorView = view;
  }

  /**
   * Starts a namespace (idempotent). `activate: false` powers it on in the
   * background — tab appears, processes run — without leaving the current tab;
   * used by the selector's power switch and session restore.
   */
  async open(namespaceId: string, options: { activate?: boolean } = {}): Promise<RunningNamespace> {
    const activate = options.activate !== false;
    const existing = this.running.get(namespaceId);
    if (existing) {
      if (activate) this.switchToTab(namespaceId);
      return existing;
    }

    const ns = this.namespaceManager.get(namespaceId);
    if (!ns) throw new Error(`Namespace ${namespaceId} not found`);

    try {
      return await this.doOpen(namespaceId, ns, activate);
    } catch (err) {
      this.emitOpenProgress(namespaceId, 'error');
      throw err;
    }
  }

  private async doOpen(
    namespaceId: string,
    ns: Namespace,
    activate: boolean,
  ): Promise<RunningNamespace> {
    let apiPort = 0;
    let view: WebContentsView;
    let loaded: Promise<void>;

    if (ns.type === 'remote' && ns.remoteUrl) {
      this.emitOpenProgress(namespaceId, 'interface');
      // Re-check on every open so a saved URL that was replaced, downgraded,
      // or edited by hand never gets presented as a trusted Classifyre tab.
      // This also loads the remote namespace registry before entering the
      // remote web app, which will then use the same relative /api endpoint.
      await verifyClassifyreRemote(ns.remoteUrl);
      ({ view, loaded } = this.createRemoteView(ns));
    } else {
      if (!this.pg.isRunning()) {
        this.emitOpenProgress(namespaceId, 'db');
        await this.pg.start();
      }

      this.emitOpenProgress(namespaceId, 'schema');
      await this.pg.createSchema(ns.schemaName);
      const databaseUrl = this.pg.getConnectionString(ns.schemaName);
      this.emitOpenProgress(namespaceId, 'migrate');
      await this.processManager.runMigrations(databaseUrl);

      if (ns.apiPort) {
        // A fixed port was configured (e.g. for MCP-server consumers that need
        // a stable URL). Never silently reallocate — fail with a clear error.
        const granted = await getAvailablePort(ns.apiPort);
        if (granted !== ns.apiPort) {
          throw new Error(
            `Configured API port ${ns.apiPort} is already in use. ` +
              'Free the port or change it in workspace settings.',
          );
        }
        apiPort = ns.apiPort;
      } else {
        apiPort = await getAvailablePort();
      }
      this.emitOpenProgress(namespaceId, 'api');
      await this.processManager.startApi(namespaceId, apiPort, databaseUrl, {
        maxParallelScans: ns.maxParallelScans,
        memoryLimitMb: ns.memoryLimitMb,
        env: ns.env,
      });

      this.emitOpenProgress(namespaceId, 'interface');
      ({ view, loaded } = this.createNamespaceView(ns, apiPort));
    }

    // Don't reveal the tab until the interface has actually rendered — the
    // API being ready doesn't mean the page has painted, and switching early
    // shows a white view with no feedback. The selector keeps its "Loading
    // interface…" indicator until this resolves.
    try {
      await loaded;
    } catch (err) {
      if (this.mainWindow) this.mainWindow.contentView.removeChildView(view);
      view.webContents.close();
      if (ns.type !== 'remote') {
        await this.processManager.stopApi(namespaceId).catch(() => {});
      }
      throw err;
    }

    this.namespaceManager.updateLastOpened(namespaceId);

    const entry: RunningNamespace = { namespace: ns, apiPort, view };
    this.running.set(namespaceId, entry);

    this.emitOpenProgress(namespaceId, 'done');
    if (activate) this.switchToTab(namespaceId);
    this.notifyTabBar();

    return entry;
  }

  /**
   * Streams open-lifecycle stages to the selector page so its cards can show
   * real progress (instead of timer-driven guesses) — including for opens
   * initiated from the tray, menu, or session restore.
   */
  private emitOpenProgress(namespaceId: string, stage: OpenStage): void {
    if (!this.selectorView || this.selectorView.webContents.isDestroyed()) return;
    this.selectorView.webContents.send('namespace:open-progress', { namespaceId, stage });
  }

  /** Tells the selector page that running state changed so it re-renders. */
  private notifySelectorStateChanged(): void {
    if (!this.selectorView || this.selectorView.webContents.isDestroyed()) return;
    this.selectorView.webContents.send('namespace:state-changed');
  }

  /** Registers a listener fired whenever tabs/running state changes. */
  onStateChange(listener: () => void): void {
    this.stateChangeListeners.add(listener);
  }

  /** Notifies tab bar + external listeners (tray, menus) of a state change. */
  emitStateChange(): void {
    this.notifyTabBar();
  }

  /**
   * Resolves when the view's page has finished loading; rejects on a
   * main-frame load failure or renderer crash. A stuck-but-alive load
   * resolves after the timeout so a slow page is still shown eventually.
   */
  private waitForViewLoad(view: WebContentsView, timeoutMs = 30_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const wc = view.webContents;
      const cleanup = () => {
        wc.removeListener('did-finish-load', onDone);
        wc.removeListener('did-fail-load', onFail);
        wc.removeListener('render-process-gone', onGone);
        clearTimeout(timer);
      };
      const onDone = () => {
        cleanup();
        resolve();
      };
      const onFail = (
        _e: unknown,
        code: number,
        desc: string,
        _url: string,
        isMainFrame: boolean,
      ) => {
        // Subframe/asset failures and ERR_ABORTED (-3, e.g. a redirect) are
        // not fatal for the page as a whole.
        if (!isMainFrame || code === -3) return;
        cleanup();
        reject(new Error(`The interface failed to load: ${desc} (${code})`));
      };
      const onGone = (_e: unknown, details: Electron.RenderProcessGoneDetails) => {
        cleanup();
        reject(new Error(`The interface crashed while loading (${details.reason})`));
      };
      const timer = setTimeout(() => {
        cleanup();
        console.warn('[runtime] view load timed out — showing it anyway');
        resolve();
      }, timeoutMs);
      wc.on('did-finish-load', onDone);
      wc.on('did-fail-load', onFail);
      wc.on('render-process-gone', onGone);
    });
  }

  private createRemoteView(ns: Namespace): { view: WebContentsView; loaded: Promise<void> } {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    if (this.mainWindow) {
      this.mainWindow.contentView.addChildView(view);
    }
    view.setVisible(false);

    const url = ns.remoteUrl!;
    // Re-validated here (not only at create/update) so a namespaces.json
    // edited by hand can't smuggle in a plaintext or non-http(s) URL.
    assertValidRemoteUrl(url);
    const allowedOrigin = new URL(url).origin;

    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Remote workspaces may legitimately hop origins for redirect-based
    // SSO/OAuth login, so cross-origin https navigation stays allowed. What
    // must never happen inside a tab the chrome presents as trusted is a
    // downgrade to plaintext http (MITM rewrite) or a non-web scheme — except
    // when the workspace itself is an http://localhost dev server.
    view.webContents.on('will-navigate', (e, target) => {
      const targetUrl = new URL(target);
      if (targetUrl.protocol === 'https:') return;
      if (targetUrl.protocol === 'http:' && targetUrl.origin === allowedOrigin) return;
      e.preventDefault();
    });

    const loaded = this.waitForViewLoad(view);
    void view.webContents.loadURL(url);
    return { view, loaded };
  }

  private createNamespaceView(
    ns: Namespace,
    apiPort: number,
  ): { view: WebContentsView; loaded: Promise<void> } {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: this.preloadPath,
        additionalArguments: [
          `--api-port=${apiPort}`,
          `--namespace-id=${ns.id}`,
        ],
      },
    });

    if (this.mainWindow) {
      this.mainWindow.contentView.addChildView(view);
    }
    view.setVisible(false);

    // The local workspace view must stay on the bundled app (app:// packaged,
    // localhost:3000 dev). Outbound links open in the system browser instead
    // of turning the workspace tab — or a fresh unhardened window — into an
    // arbitrary browser if the bundled web app ever has an XSS or a stray link.
    const isAppUrl = (target: string): boolean =>
      this.isDev ? target.startsWith('http://localhost:3000') : target.startsWith('app://');
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    view.webContents.on('will-navigate', (e, target) => {
      if (isAppUrl(target)) return;
      e.preventDefault();
      if (/^https?:/.test(target)) void shell.openExternal(target);
    });

    // Renderer diagnostics → main log (userData/logs/main.log). A blank
    // workspace window is otherwise invisible to the main process; surfacing
    // failed asset loads and renderer crashes here makes it debuggable.
    view.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`[web] did-fail-load ${url || '(main)'}: ${desc} (${code})`);
    });
    view.webContents.on('render-process-gone', (_e, details) => {
      console.error(`[web] render process gone: ${details.reason} (exitCode ${details.exitCode})`);
    });
    // Forward renderer warnings/errors to the main log. Client-side code never
    // touches the main process, so without this a broken page (e.g. a failed
    // fetch or a React error) is invisible in the log. Verbose/info levels are
    // dropped to keep the log readable.
    view.webContents.on('console-message', (details) => {
      if (details.level !== 'warning' && details.level !== 'error') return;
      const tag = details.level === 'error' ? 'error' : 'warn';
      const where = details.sourceId ? ` (${details.sourceId}:${details.lineNumber})` : '';
      console.log(`[web:${tag}] ${details.message}${where}`);
    });

    const viewLoaded = this.waitForViewLoad(view);
    let loaded = viewLoaded;
    if (this.isDev) {
      const webUrl = 'http://localhost:3000';
      loaded = this.waitForDevServer(webUrl).then(
        () => {
          void view.webContents.loadURL(webUrl);
          return viewLoaded;
        },
        () => {
          if (this.mainWindow) {
            void dialog.showMessageBox(this.mainWindow, {
              type: 'warning',
              title: 'Web dev server not running',
              message: 'Next.js dev server is not available at localhost:3000.\n\nStart it with: cd apps/web && bun dev',
            });
          }
          throw new Error('Web dev server is not running at localhost:3000');
        },
      );
    } else {
      // Served by the 'app' scheme (registerAppProtocol) — NOT loadFile/file://,
      // under which the export's absolute /_next/... asset paths resolve to the
      // filesystem root and 404, leaving a blank window. The host segment is
      // arbitrary; the handler resolves the path against the bundled web dir.
      void view.webContents.loadURL('app://classifyre/index.html');
    }

    return { view, loaded };
  }

  switchToTab(tabId: string): void {
    console.log(`[runtime] switchToTab: ${tabId}, running tabs: ${[...this.running.keys()].join(', ')}`);
    // Snapshot the tab being left while its view is still painted — this is
    // what the selector cards show as the workspace thumbnail.
    if (this.activeTabId && this.activeTabId !== tabId) {
      const leaving = this.running.get(this.activeTabId);
      if (leaving) void captureViewThumbnail(this.activeTabId, leaving.view);
    }
    this.activeTabId = tabId;
    // After the window is destroyed (background-off close path) the views are
    // gone too — only the bookkeeping above should happen.
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const showSelector = tabId === '__selector__';
    if (this.selectorView) {
      console.log(`[runtime] selectorView.setVisible(${showSelector})`);
      this.selectorView.setVisible(showSelector);
    }

    for (const [id, entry] of this.running) {
      const visible = id === tabId;
      console.log(`[runtime] namespace ${id} view.setVisible(${visible})`);
      entry.view.setVisible(visible);
    }

    this.layoutViews();
    this.notifyTabBar();
  }

  showSelector(): void {
    console.log('[runtime] showSelector called');
    this.switchToTab('__selector__');
  }

  async close(namespaceId: string): Promise<void> {
    const entry = this.running.get(namespaceId);
    if (!entry) return;

    const wasActive = this.activeTabId === namespaceId;

    // Drop from bookkeeping first so the tab counts as closed immediately —
    // even if a teardown step below throws or is slow, the UI won't be stuck
    // showing a workspace that's on its way out.
    this.running.delete(namespaceId);

    // Snapshot before teardown so a stopped workspace still shows its last
    // state on the selector card. Only the active view is reliably painted.
    // Bounded: capturePage can hang on a wedged renderer, which used to leave
    // the whole close stuck (the tab became un-closable without a restart).
    if (wasActive) {
      await withTimeout(captureViewThumbnail(namespaceId, entry.view), 2500);
    }

    // Detach + destroy the view synchronously so it can never linger on screen
    // overlapping the remaining workspace.
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      entry.view.setVisible(false);
      this.mainWindow.contentView.removeChildView(entry.view);
    }
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close();
    }

    // Switch away right away so the UI is responsive while the API is torn
    // down below.
    if (wasActive) {
      const remaining = [...this.running.keys()];
      if (remaining.length > 0) {
        this.switchToTab(remaining[remaining.length - 1]!);
      } else {
        this.showSelector();
      }
    }

    this.notifyTabBar();

    // Kill the API last; stopApi has its own force-kill timeout, so this
    // cannot hang the close. Errors are logged, never thrown to the caller.
    await this.processManager
      .stopApi(namespaceId)
      .catch((err) => console.error(`[runtime] stopApi failed for ${namespaceId}:`, err));
  }

  async closeAll(): Promise<void> {
    const ids = [...this.running.keys()];
    await Promise.all(ids.map((id) => this.close(id)));
  }

  private layoutViews(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const size = this.mainWindow.getContentSize();
    const w = size[0] ?? 1400;
    const h = size[1] ?? 900;
    const contentY = TAB_BAR_HEIGHT;
    const contentHeight = h - TAB_BAR_HEIGHT;

    if (this.tabBarView) {
      this.tabBarView.setBounds({ x: 0, y: 0, width: w, height: TAB_BAR_HEIGHT });
    }

    if (this.selectorView) {
      this.selectorView.setBounds({ x: 0, y: contentY, width: w, height: contentHeight });
    }

    for (const [, entry] of this.running) {
      entry.view.setBounds({ x: 0, y: contentY, width: w, height: contentHeight });
    }
  }

  private notifyTabBar(): void {
    for (const listener of this.stateChangeListeners) listener();
    // Keep the selector's cards (power toggles, live-port rows) in sync with
    // the real running state. Without this a workspace closed from the tab bar
    // left its selector card stuck showing "On", because the selector only
    // re-rendered from its own actions.
    this.notifySelectorStateChanged();
    if (!this.tabBarView || this.tabBarView.webContents.isDestroyed()) return;

    const data = this.getTabState();
    const js = `
      (function(){
        var tabs = ${JSON.stringify(data.tabs)};
        var container = document.getElementById('tabs');
        if (container) {
          container.innerHTML = '';
          tabs.forEach(function(t) {
            var div = document.createElement('div');
            div.className = t.active ? 'tab active' : 'tab';
            div.dataset.id = t.id;
            div.onclick = function() { window.electronAPI.switchTab(t.id); };
            if (t.remote) {
              var icon = document.createElement('span');
              icon.className = 'tab-icon';
              icon.textContent = '\\u{1F310}';
              div.appendChild(icon);
            }
            var label = document.createElement('span');
            label.className = 'tab-label';
            label.textContent = t.name;
            div.appendChild(label);
            var close = document.createElement('span');
            close.className = 'tab-close';
            close.textContent = '\\u00D7';
            close.onclick = function(e) { e.stopPropagation(); window.electronAPI.closeTab(t.id); };
            div.appendChild(close);
            container.appendChild(div);
          });
        }
        var h = document.getElementById('home-tab');
        if (h) { h.className = ${JSON.stringify('tab-home' + (data.showingSelector ? ' active' : ''))}; }
      })()
    `;
    void this.tabBarView.webContents.executeJavaScript(js).catch(() => {});
  }

  getTabState(): { tabs: { id: string; name: string; active: boolean; remote: boolean }[]; showingSelector: boolean } {
    const tabs = [...this.running.entries()].map(([id, entry]) => ({
      id,
      name: entry.namespace.name,
      active: id === this.activeTabId,
      remote: entry.namespace.type === 'remote',
    }));
    return { tabs, showingSelector: this.activeTabId === '__selector__' };
  }

  getRunning(): Map<string, RunningNamespace> {
    return new Map(this.running);
  }

  /** Maps a WebContents back to the namespace whose view owns it. */
  findNamespaceIdByWebContents(wc: Electron.WebContents): string | undefined {
    for (const [id, entry] of this.running) {
      if (entry.view.webContents === wc) return id;
    }
    return undefined;
  }

  getApiPort(namespaceId: string): number | undefined {
    return this.running.get(namespaceId)?.apiPort;
  }

  isOpen(namespaceId: string): boolean {
    return this.running.has(namespaceId);
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  private waitForDevServer(url: string, timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Dev server at ${url} not available`));
          return;
        }
        const req = http.get(url, (res) => {
          res.resume();
          resolve();
        });
        req.on('error', () => setTimeout(check, 500));
        req.setTimeout(2000, () => {
          req.destroy();
          setTimeout(check, 500);
        });
      };
      check();
    });
  }
}
