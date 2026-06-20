import { app, BrowserWindow, WebContentsView } from 'electron';
import path from 'path';
import { PostgresManager } from './postgres-manager.js';
import { NamespaceManager } from './namespace-manager.js';
import { ProcessManager } from './process-manager.js';
import { NamespaceRuntime } from './namespace-runtime.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { registerAppProtocol } from './protocol-handler.js';
import { AutoUpdater } from './auto-updater.js';

// embedded-postgres registers an async-exit-hook that calls done() on process
// exit, but Electron's quit path doesn't always provide the callback. Suppress
// the resulting unhandled rejection so it doesn't crash the app on quit.
process.on('unhandledRejection', (reason) => {
  if (reason instanceof TypeError && (reason as TypeError).message === 'done is not a function') {
    return;
  }
  console.error('Unhandled rejection:', reason);
});

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let pg: PostgresManager;
let namespaceManager: NamespaceManager;
let processManager: ProcessManager;
let runtime: NamespaceRuntime;
let updater: AutoUpdater;

function getPreloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

declare const NAMESPACE_SELECTOR_VITE_DEV_SERVER_URL: string | undefined;
declare const NAMESPACE_SELECTOR_VITE_NAME: string | undefined;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Classifyre',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // --- Tab bar view (thin strip at top) ---
  const tabBarView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath(),
    },
  });
  win.contentView.addChildView(tabBarView);

  const tabBarHtml = isDev
    ? path.join(__dirname, '../../src/renderer/tab-bar/tab-bar.html')
    : path.join(__dirname, 'tab-bar/tab-bar.html');
  void tabBarView.webContents.loadFile(tabBarHtml);

  // --- Selector view (namespace picker, fills content area) ---
  const selectorView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath(),
    },
  });
  win.contentView.addChildView(selectorView);

  if (typeof NAMESPACE_SELECTOR_VITE_DEV_SERVER_URL !== 'undefined' && NAMESPACE_SELECTOR_VITE_DEV_SERVER_URL) {
    void selectorView.webContents.loadURL(NAMESPACE_SELECTOR_VITE_DEV_SERVER_URL);
  } else if (typeof NAMESPACE_SELECTOR_VITE_NAME !== 'undefined' && NAMESPACE_SELECTOR_VITE_NAME) {
    void selectorView.webContents.loadFile(
      path.join(__dirname, `../renderer/${NAMESPACE_SELECTOR_VITE_NAME}/index.html`),
    );
  } else {
    void selectorView.webContents.loadFile(
      path.join(__dirname, '../../index.html'),
    );
  }

  runtime.setMainWindow(win);
  runtime.setTabBarView(tabBarView);
  runtime.setSelectorView(selectorView);
  runtime.showSelector();

  updater.setTabBarView(tabBarView);
  void updater.init().then(() => updater.checkForUpdates());

  return win;
}

app.on('ready', async () => {
  if (!process.env['ELECTRON_DISABLE_SINGLE_INSTANCE'] && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  if (!isDev) {
    const webDir = path.join(process.resourcesPath, 'web');
    registerAppProtocol(webDir);
  }

  pg = new PostgresManager();
  namespaceManager = new NamespaceManager();
  processManager = new ProcessManager();
  runtime = new NamespaceRuntime(
    pg,
    processManager,
    namespaceManager,
    isDev,
    getPreloadPath(),
  );

  updater = new AutoUpdater();
  registerIpcHandlers(runtime, namespaceManager, updater);

  try {
    await pg.start();
    console.log(`Embedded PostgreSQL started on port ${pg.getPort()}`);
  } catch (err) {
    console.error('Failed to start embedded PostgreSQL:', err);
    app.quit();
    return;
  }

  mainWindow = createMainWindow();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow) {
    mainWindow = createMainWindow();
  }
});

let isQuitting = false;
app.on('before-quit', (e) => {
  if (isQuitting) return;
  e.preventDefault();
  isQuitting = true;

  Promise.resolve()
    .then(() => runtime?.closeAll())
    .then(() => pg?.stop())
    .catch((err) => console.error('Shutdown error:', err))
    .finally(() => app.quit());
});
