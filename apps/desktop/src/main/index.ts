import { app, autoUpdater, BrowserWindow, WebContentsView, dialog, protocol, shell } from 'electron';
import path from 'path';
import { PostgresManager } from './postgres-manager.js';
import { NamespaceManager } from './namespace-manager.js';
import { ProcessManager } from './process-manager.js';
import { NamespaceRuntime } from './namespace-runtime.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { registerNotificationHandlers } from './notification-service.js';
import { registerAppProtocol } from './protocol-handler.js';
import { SettingsManager } from './settings-manager.js';
import { SessionStore } from './session-store.js';
import { UpdateChecker } from './update-checker.js';
import { initFileLogging } from './logger.js';
import { buildApplicationMenu } from './menu.js';
import { AppTray } from './tray.js';
import { getAvailablePort } from './port-manager.js';

/** Fixed process id for the single shared API in the ProcessManager map. */
const SHARED_API_ID = '__shared__';

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
let sessionStore: SessionStore;
let updateChecker: UpdateChecker;
/** Base URL of the single shared API, injected into the web view's preload. */
let sharedApiBaseUrl = '';
let tray: AppTray | null = null;
let isQuitting = false;
let shutdownStarted = false;

// Squirrel.Mac's quitAndInstall() closes every window BEFORE any before-quit
// fires. Without this flag the background-mode close handler intercepts that
// close and just hides the window, so "Restart to update" silently did nothing
// but hide the app. Marking quit-in-progress here lets the close proceed;
// graceful shutdown still runs in before-quit, and Squirrel's ShipIt installs
// the update once the process actually exits.
autoUpdater.on('before-quit-for-update', () => {
  isQuitting = true;
});

/** Restores the window, recreating it if it was fully closed. */
function showMainWindow(): void {
  if (!runtime) return; // fired before startup finished (or after a failed start)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }
}

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

/**
 * Single-instance window: ONE web view loading the web app. The web app owns
 * the namespace concept now (its landing page lists/creates workspaces and
 * routes under `/<slug>/...`), talking to the single shared API whose base URL
 * is injected via the preload. No more tab bar / native selector / per-
 * namespace views.
 */
function createMainWindow(): BrowserWindow {
  const apiBaseUrl = sharedApiBaseUrl;
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
  lockDownChrome(win.webContents);

  const webView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath(),
      additionalArguments: [`--api-base=${apiBaseUrl}`],
    },
  });
  win.contentView.addChildView(webView);

  const fit = () => {
    const { width, height } = win.getContentBounds();
    webView.setBounds({ x: 0, y: 0, width, height });
  };
  fit();
  win.on('resize', fit);

  // Allow in-app navigation within the web app only; outbound links open in the
  // system browser.
  webView.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  webView.webContents.on('will-navigate', (e, target) => {
    const inApp = isDev
      ? target.startsWith('http://localhost:3000')
      : target.startsWith('app://classifyre');
    if (!inApp) {
      e.preventDefault();
      void shell.openExternal(target);
    }
  });

  if (isDev) {
    void webView.webContents.loadURL('http://localhost:3000');
  } else {
    // Served by the 'app' scheme (registerAppProtocol) — NOT file:// — so the
    // Next static export's absolute asset paths and client routing resolve.
    void webView.webContents.loadURL('app://classifyre/index.html');
  }

  updateChecker.setTabBarView(webView);
  webView.webContents.on('did-finish-load', () => {
    void updateChecker.checkForUpdates();
  });

  // Background mode: closing the window hides it instead of quitting.
  win.on('close', (e) => {
    if (isQuitting || !settingsManager.get().runInBackground) return;
    e.preventDefault();
    win.hide();
  });

  return win;
}

app.on('ready', async () => {
  if (!process.env['ELECTRON_DISABLE_SINGLE_INSTANCE'] && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  // Windows toast notifications are dropped unless the process carries an
  // explicit App User Model ID. No-op on macOS/Linux.
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.classifyre.desktop');
  }

  // Tee stdout/stderr to userData/logs/main.log before anything else runs, so
  // startup and workspace-open failures are diagnosable without launching the
  // app from a terminal.
  const logFile = initFileLogging();
  if (logFile) console.log(`Logging to ${logFile}`);

  if (!isDev) {
    const webDir = path.join(process.resourcesPath, 'web');
    registerAppProtocol(webDir);
  }

  settingsManager = new SettingsManager();
  sessionStore = new SessionStore();
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

  // NOTE: the per-namespace tab/selector runtime, its IPC, and the Workspaces
  // menu/tray are now vestigial — the web app owns namespace selection and
  // talks to the single shared API directly. They remain wired (harmless, never
  // invoked by the single web view) pending a follow-up cleanup that also
  // repoints notification deep-links at the single web view.
  updateChecker = new UpdateChecker();
  registerIpcHandlers(runtime, namespaceManager, settingsManager, updateChecker, pg);
  registerNotificationHandlers({ runtime, settingsManager, showWindow: showMainWindow });

  // Application menu (Logs menu, Workspaces menu, Check for Updates…);
  // Electron's bare default menu has none of these. Rebuilt when workspaces
  // change so the Workspaces menu stays current.
  const rebuildMenu = () =>
    buildApplicationMenu({ runtime, namespaceManager, updateChecker, showMainWindow });
  rebuildMenu();
  runtime.onStateChange(rebuildMenu);

  tray = new AppTray({
    runtime,
    namespaceManager,
    settingsManager,
    updateChecker,
    showWindow: showMainWindow,
    quit: () => app.quit(),
  });
  tray.create();

  updateChecker.startPeriodicChecks();

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

  // Start the ONE shared, namespace-aware API. It connects with a schema-less
  // DATABASE_URL and resolves the tenant schema per request from the `/<slug>/`
  // URL segment; it migrates the registry + every namespace schema itself
  // (autoMigrate). Namespaces are created from the web app's landing page (a
  // POST to the API's /namespaces), which provisions the schema on the fly.
  try {
    const apiPort = await getAvailablePort();
    sharedApiBaseUrl = `http://127.0.0.1:${apiPort}`;
    await processManager.startApi(
      SHARED_API_ID,
      apiPort,
      pg.getConnectionString(),
      { autoMigrate: true },
    );
    console.log(`Shared Classifyre API started on ${sharedApiBaseUrl}`);
  } catch (err) {
    console.error('Failed to start the Classifyre API:', err);
    dialog.showErrorBox(
      'Classifyre could not start',
      `The Classifyre API failed to start.\n\n${err instanceof Error ? err.message : String(err)}`,
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
  showMainWindow();
});

app.on('window-all-closed', () => {
  // Background mode keeps the app (tray + workspaces) alive on every
  // platform; the tray or a relaunch brings the window back.
  if (settingsManager?.get().runInBackground) return;
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  showMainWindow();
});

app.on('before-quit', (e) => {
  // isQuitting may already be true (update restart path) — the graceful
  // shutdown below must still run exactly once, so it has its own flag.
  isQuitting = true;
  if (shutdownStarted) return;
  e.preventDefault();
  shutdownStarted = true;

  // If graceful shutdown hangs (e.g. pg_ctl stop blocked on a stuck
  // connection), quit anyway — otherwise the app appears frozen and the user
  // force-kills it, which is the unclean shutdown this chain tries to avoid.
  const forceQuitTimer = setTimeout(() => {
    console.error('Shutdown timed out after 30s — quitting anyway');
    app.quit();
  }, 30_000);

  tray?.destroy();
  // Teardown closes every workspace — keep the pre-quit snapshot so the next
  // launch restores the session instead of starting empty.
  sessionStore?.suppress();
  Promise.resolve()
    .then(() => runtime?.closeAll())
    .then(() => pg?.stop())
    .catch((err) => console.error('Shutdown error:', err))
    .finally(() => {
      clearTimeout(forceQuitTimer);
      app.quit();
    });
});
