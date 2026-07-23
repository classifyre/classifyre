import { app, autoUpdater, BrowserWindow, dialog, protocol, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { PostgresManager } from './postgres-manager.js';
import { ProcessManager } from './process-manager.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { registerNotificationHandlers } from './notification-service.js';
import { registerAppProtocol } from './protocol-handler.js';
import { SettingsManager } from './settings-manager.js';
import { UpdateChecker } from './update-checker.js';
import { initFileLogging } from './logger.js';
import { buildApplicationMenu } from './menu.js';
import { AppTray } from './tray.js';
import { getAvailablePort } from './port-manager.js';
import { NamespaceStore, type ApiNamespace } from './namespace-store.js';

/** Process id for the single shared, namespace-aware API. */
const SHARED_API_ID = 'shared';

// Tests and managed installations can override the application data root.
// Apply it before any manager or logger reads userData.
const configuredDataDir = process.env['CLASSIFYRE_DATA_DIR'];
if (configuredDataDir) {
  const dataDirOverride = path.resolve(configuredDataDir);
  fs.mkdirSync(dataDirOverride, { recursive: true });
  process.env['CLASSIFYRE_DATA_DIR'] = dataDirOverride;
  app.setPath('userData', dataDirOverride);
}

// embedded-postgres registers an async-exit-hook that calls done() on process
// exit, but Electron's quit path doesn't always provide the callback.
process.on('unhandledRejection', (reason) => {
  if (reason instanceof TypeError && reason.message === 'done is not a function') {
    return;
  }
  console.error('Unhandled rejection:', reason);
});

// The packaged Next.js export references assets using absolute paths. The
// custom scheme must be privileged before app ready for those paths and fetch
// requests to resolve correctly.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let pg: PostgresManager;
let settingsManager: SettingsManager;
let processManager: ProcessManager;
let updateChecker: UpdateChecker;
let namespaceStore: NamespaceStore;
let sharedApiBaseUrl = '';
let tray: AppTray | null = null;
let isQuitting = false;
let shutdownStarted = false;

autoUpdater.on('before-quit-for-update', () => {
  isQuitting = true;
});

function getPreloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

function appUrl(route = ''): string {
  const normalized = route.replace(/^\/+/, '');
  if (isDev) {
    return normalized
      ? `http://localhost:3000/${normalized}`
      : 'http://localhost:3000';
  }
  return normalized
    ? `app://classifyre/${normalized}`
    : 'app://classifyre/index.html';
}

function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (!sharedApiBaseUrl) return;
  mainWindow = createMainWindow();
}

function showHome(): void {
  showMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(appUrl());
  }
}

function openNamespace(namespace: ApiNamespace): void {
  if (namespace.type === 'remote' && namespace.remoteUrl) {
    void shell.openExternal(namespace.remoteUrl);
    return;
  }
  showMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(appUrl(namespace.slug));
  }
}

function configureWebContents(win: BrowserWindow): void {
  const contents = win.webContents;
  const isAppUrl = (target: string): boolean => {
    if (isDev) return new URL(target).origin === 'http://localhost:3000';
    const url = new URL(target);
    return url.protocol === 'app:' && url.host === 'classifyre';
  };

  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, target) => {
    if (isAppUrl(target)) return;
    event.preventDefault();
    if (/^https?:/.test(target)) void shell.openExternal(target);
  });
  contents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[web] did-fail-load ${url || '(main)'}: ${description} (${code})`);
  });
  contents.on('render-process-gone', (_event, details) => {
    console.error(
      `[web] render process gone: ${details.reason} (exitCode ${details.exitCode})`,
    );
  });
  contents.on('console-message', (details) => {
    if (details.level !== 'warning' && details.level !== 'error') return;
    const where = details.sourceId
      ? ` (${details.sourceId}:${details.lineNumber})`
      : '';
    console.log(`[web:${details.level}] ${details.message}${where}`);
  });
}

/**
 * One window renders the namespace-aware web application. Namespace selection,
 * creation, settings, and routing all live in that application and use the
 * shared API injected by the preload.
 */
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Classifyre',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath(),
      additionalArguments: [`--api-base=${sharedApiBaseUrl}`],
    },
  });
  configureWebContents(win);
  void win.loadURL(appUrl());

  win.on('close', (event) => {
    if (isQuitting || !settingsManager.get().runInBackground) return;
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

app.on('ready', async () => {
  if (!process.env['ELECTRON_DISABLE_SINGLE_INSTANCE'] && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.classifyre.desktop');
  }

  const logFile = initFileLogging();
  if (logFile) console.log(`Logging to ${logFile}`);

  if (!isDev) {
    registerAppProtocol(path.join(process.resourcesPath, 'web'));
  }

  settingsManager = new SettingsManager();
  pg = new PostgresManager(settingsManager.get().postgresPort);
  processManager = new ProcessManager();
  updateChecker = new UpdateChecker();
  updateChecker.startPeriodicChecks();
  void updateChecker.checkForUpdates();

  try {
    await pg.start();
    console.log(`Embedded PostgreSQL started on port ${pg.getPort()}`);
  } catch (error) {
    console.error('Failed to start embedded PostgreSQL:', error);
    dialog.showErrorBox(
      'Classifyre could not start',
      `The embedded PostgreSQL database failed to start.\n\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    app.quit();
    return;
  }

  try {
    const apiPort = await getAvailablePort();
    sharedApiBaseUrl = `http://127.0.0.1:${apiPort}`;
    await processManager.startApi(
      SHARED_API_ID,
      apiPort,
      pg.getConnectionString(),
    );
    console.log(`Shared Classifyre API started on ${sharedApiBaseUrl}`);
  } catch (error) {
    console.error('Failed to start the Classifyre API:', error);
    dialog.showErrorBox(
      'Classifyre could not start',
      `The Classifyre API failed to start.\n\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    app.quit();
    return;
  }

  namespaceStore = new NamespaceStore(sharedApiBaseUrl);

  const menuDeps = {
    namespaceStore,
    updateChecker,
    showHome,
    openNamespace,
  };
  const rebuildMenu = () => buildApplicationMenu(menuDeps);
  rebuildMenu();
  namespaceStore.onChange(rebuildMenu);

  tray = new AppTray({
    namespaceStore,
    settingsManager,
    updateChecker,
    showWindow: showMainWindow,
    showHome,
    openNamespace,
    quit: () => app.quit(),
  });
  tray.create();

  registerIpcHandlers(namespaceStore);
  registerNotificationHandlers({
    settingsManager,
    showWindow: showMainWindow,
    getWebContents: () => mainWindow?.webContents ?? null,
  });

  await namespaceStore.start();
  mainWindow = createMainWindow();
});

app.on('second-instance', showMainWindow);

app.on('window-all-closed', () => {
  if (settingsManager?.get().runInBackground) return;
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', showMainWindow);

app.on('before-quit', (event) => {
  isQuitting = true;
  if (shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;

  const forceQuitTimer = setTimeout(() => {
    console.error('Shutdown timed out after 30s — quitting anyway');
    app.quit();
  }, 30_000);

  tray?.destroy();
  namespaceStore?.stop();
  Promise.resolve()
    .then(() => processManager?.stopAll())
    .then(() => pg?.stop())
    .catch((error) => console.error('Shutdown error:', error))
    .finally(() => {
      clearTimeout(forceQuitTimer);
      app.quit();
    });
});
