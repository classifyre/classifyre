import { app, BrowserWindow, WebContentsView, dialog, protocol } from 'electron';
import path from 'path';
import { PostgresManager } from './postgres-manager.js';
import { NamespaceManager } from './namespace-manager.js';
import { ProcessManager } from './process-manager.js';
import { NamespaceRuntime } from './namespace-runtime.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { registerAppProtocol } from './protocol-handler.js';
import { SettingsManager } from './settings-manager.js';
import { UpdateChecker } from './update-checker.js';
import { initFileLogging } from './logger.js';
import { buildApplicationMenu } from './menu.js';

// embedded-postgres registers an async-exit-hook that calls done() on process
// exit, but Electron's quit path doesn't always provide the callback. Suppress
// the resulting unhandled rejection so it doesn't crash the app on quit.
process.on('unhandledRejection', (reason) => {
  if (reason instanceof TypeError && (reason as TypeError).message === 'done is not a function') {
    return;
  }
  console.error('Unhandled rejection:', reason);
});

// The packaged Next.js static export references assets with ABSOLUTE paths
// (/_next/static/...). Loading index.html over file:// resolves those against
// the filesystem root, so every chunk 404s and the window renders blank. They
// are instead served by the custom 'app' scheme (registerAppProtocol), but that
// scheme must be declared privileged BEFORE app 'ready' so it behaves as a
// standard, secure origin — otherwise absolute paths and fetch() don't resolve.
// Harmless in dev (the app scheme is only loaded when packaged).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let pg: PostgresManager;
let namespaceManager: NamespaceManager;
let settingsManager: SettingsManager;
let processManager: ProcessManager;
let runtime: NamespaceRuntime;
let updateChecker: UpdateChecker;

function getPreloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

declare const NAMESPACE_SELECTOR_VITE_DEV_SERVER_URL: string | undefined;
declare const NAMESPACE_SELECTOR_VITE_NAME: string | undefined;

// The app-chrome views (window shell, tab bar, selector) only ever display
// their own bundled pages. Deny window.open and in-place navigation so a
// compromised or buggy page can't turn app chrome into an arbitrary browser.
function lockDownChrome(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e) => e.preventDefault());
}

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
  lockDownChrome(win.webContents);
  lockDownChrome(tabBarView.webContents);
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
  lockDownChrome(selectorView.webContents);
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

  updateChecker.setTabBarView(tabBarView);
  tabBarView.webContents.on('did-finish-load', () => {
    void updateChecker.checkForUpdates();
  });

  return win;
}

app.on('ready', async () => {
  if (!process.env['ELECTRON_DISABLE_SINGLE_INSTANCE'] && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  // Tee stdout/stderr to userData/logs/main.log before anything else runs, so
  // startup and workspace-open failures are diagnosable without launching the
  // app from a terminal.
  const logFile = initFileLogging();
  if (logFile) console.log(`Logging to ${logFile}`);

  // Install the application menu (adds a "Logs" menu to open/reveal main.log;
  // Electron's bare default menu has no such entry).
  buildApplicationMenu();

  if (!isDev) {
    const webDir = path.join(process.resourcesPath, 'web');
    registerAppProtocol(webDir);
  }

  settingsManager = new SettingsManager();
  pg = new PostgresManager(settingsManager.get().postgresPort);
  namespaceManager = new NamespaceManager();
  processManager = new ProcessManager();
  runtime = new NamespaceRuntime(
    pg,
    processManager,
    namespaceManager,
    isDev,
    getPreloadPath(),
  );

  updateChecker = new UpdateChecker();
  registerIpcHandlers(runtime, namespaceManager, settingsManager, updateChecker, pg);

  try {
    await pg.start();
    console.log(`Embedded PostgreSQL started on port ${pg.getPort()}`);
  } catch (err) {
    console.error('Failed to start embedded PostgreSQL:', err);
    // Surface the failure — a silent exit looks like a crash and gives users
    // nothing to report.
    dialog.showErrorBox(
      'Classifyre could not start',
      `The embedded PostgreSQL database failed to start.\n\n${err instanceof Error ? err.message : String(err)}`,
    );
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

  // If graceful shutdown hangs (e.g. pg_ctl stop blocked on a stuck
  // connection), quit anyway — otherwise the app appears frozen and the user
  // force-kills it, which is the unclean shutdown this chain tries to avoid.
  const forceQuitTimer = setTimeout(() => {
    console.error('Shutdown timed out after 30s — quitting anyway');
    app.quit();
  }, 30_000);

  Promise.resolve()
    .then(() => runtime?.closeAll())
    .then(() => pg?.stop())
    .catch((err) => console.error('Shutdown error:', err))
    .finally(() => {
      clearTimeout(forceQuitTimer);
      app.quit();
    });
});
