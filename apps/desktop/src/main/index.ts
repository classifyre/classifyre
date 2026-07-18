import { app, autoUpdater, BrowserWindow, WebContentsView, dialog, protocol } from 'electron';
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

  // Background mode: closing the window hides it instead, keeping running
  // workspaces (and their WebContentsViews) alive. The tray/dock/second
  // launch brings it back. Real quit goes through before-quit (isQuitting).
  win.on('close', (e) => {
    if (isQuitting || !settingsManager.get().runInBackground) return;
    e.preventDefault();
    win.hide();
  });

  // Without background mode a closed window means "stop": tear down the
  // running workspaces so a recreated window doesn't hold destroyed views.
  // The session snapshot from before the close survives (saves suppressed
  // during teardown), so the next launch restores what was open.
  win.on('closed', () => {
    if (isQuitting) return;
    sessionStore.suppress();
    void runtime
      .closeAll()
      .catch((err) => console.error('Teardown after window close failed:', err))
      .finally(() => sessionStore.resume());
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

  // Snapshot the previous session before the state-change hook below starts
  // rewriting it, then keep it continuously up to date.
  const previousSession = sessionStore.load();
  runtime.onStateChange(() => {
    sessionStore.save({
      openIds: [...runtime.getRunning().keys()],
      activeTabId: runtime.getActiveTabId(),
    });
  });

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

  mainWindow = createMainWindow();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Bring last session back: reopen every workspace that was running when the
  // app was last closed, then land on the tab the user was looking at.
  // Sequential on purpose — concurrent first opens would race Prisma's
  // database-level migration advisory lock. Selector cards animate each open
  // via the namespace:open-progress events.
  const restoreIds = previousSession.openIds.filter((id) => namespaceManager.get(id));
  if (restoreIds.length > 0) {
    void (async () => {
      for (const id of restoreIds) {
        try {
          // Background start: don't flip through tabs while restoring.
          await runtime.open(id, { activate: false });
        } catch (err) {
          console.error(`[session-restore] failed to reopen workspace ${id}:`, err);
        }
      }
      const { activeTabId } = previousSession;
      if (activeTabId === '__selector__') {
        runtime.showSelector();
      } else if (activeTabId && runtime.isOpen(activeTabId)) {
        runtime.switchToTab(activeTabId);
      }
    })();
  }
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
