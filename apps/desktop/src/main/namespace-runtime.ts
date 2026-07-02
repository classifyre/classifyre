import { BrowserWindow, WebContentsView, dialog } from 'electron';
import path from 'path';
import http from 'http';
import { PostgresManager } from './postgres-manager.js';
import { ProcessManager } from './process-manager.js';
import { NamespaceManager, type Namespace } from './namespace-manager.js';
import { getAvailablePort } from './port-manager.js';

const TAB_BAR_HEIGHT = 44;

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

  async open(namespaceId: string): Promise<RunningNamespace> {
    const existing = this.running.get(namespaceId);
    if (existing) {
      this.switchToTab(namespaceId);
      return existing;
    }

    const ns = this.namespaceManager.get(namespaceId);
    if (!ns) throw new Error(`Namespace ${namespaceId} not found`);

    let apiPort = 0;
    let view: WebContentsView;

    if (ns.type === 'remote' && ns.remoteUrl) {
      view = this.createRemoteView(ns);
    } else {
      if (!this.pg.isRunning()) {
        await this.pg.start();
      }

      await this.pg.createSchema(ns.schemaName);
      const databaseUrl = this.pg.getConnectionString(ns.schemaName);
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
      await this.processManager.startApi(namespaceId, apiPort, databaseUrl, {
        maxParallelScans: ns.maxParallelScans,
        memoryLimitMb: ns.memoryLimitMb,
      });

      view = this.createNamespaceView(ns, apiPort);
    }

    this.namespaceManager.updateLastOpened(namespaceId);

    const entry: RunningNamespace = { namespace: ns, apiPort, view };
    this.running.set(namespaceId, entry);

    this.switchToTab(namespaceId);
    this.notifyTabBar();

    return entry;
  }

  private createRemoteView(ns: Namespace): WebContentsView {
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
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    void view.webContents.loadURL(url);
    return view;
  }

  private createNamespaceView(ns: Namespace, apiPort: number): WebContentsView {
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

    if (this.isDev) {
      const webUrl = 'http://localhost:3000';
      void this.waitForDevServer(webUrl).then(
        () => view.webContents.loadURL(webUrl),
        () => {
          if (this.mainWindow) {
            void dialog.showMessageBox(this.mainWindow, {
              type: 'warning',
              title: 'Web dev server not running',
              message: 'Next.js dev server is not available at localhost:3000.\n\nStart it with: cd apps/web && bun dev',
            });
          }
        },
      );
    } else {
      const webDir = path.join(process.resourcesPath, 'web');
      void view.webContents.loadFile(path.join(webDir, 'index.html'));
    }

    return view;
  }

  switchToTab(tabId: string): void {
    console.log(`[runtime] switchToTab: ${tabId}, running tabs: ${[...this.running.keys()].join(', ')}`);
    this.activeTabId = tabId;

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

    this.running.delete(namespaceId);

    if (this.mainWindow) {
      this.mainWindow.contentView.removeChildView(entry.view);
    }

    await this.processManager.stopApi(namespaceId);

    if (this.activeTabId === namespaceId) {
      const remaining = [...this.running.keys()];
      if (remaining.length > 0) {
        this.switchToTab(remaining[remaining.length - 1]!);
      } else {
        this.showSelector();
      }
    }

    this.notifyTabBar();
  }

  async closeAll(): Promise<void> {
    const ids = [...this.running.keys()];
    await Promise.all(ids.map((id) => this.close(id)));
  }

  private layoutViews(): void {
    if (!this.mainWindow) return;

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
    if (!this.tabBarView) return;

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
