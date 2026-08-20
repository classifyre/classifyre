import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  Notification,
  protocol,
  shell,
} from 'electron';
import fs from 'fs';
import path from 'path';
import { PostgresManager } from './postgres-manager.js';
import { HealthMonitor } from './health-monitor.js';
import { ProcessManager, type ApiHealthEvent } from './process-manager.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { registerNotificationHandlers } from './notification-service.js';
import { registerAppProtocol } from './protocol-handler.js';
import { SettingsManager } from './settings-manager.js';
import { UpdateChecker } from './update-checker.js';
import { getLogFilePath, initFileLogging } from './logger.js';
import { buildApplicationMenu } from './menu.js';
import { AppTray } from './tray.js';
import { getAvailablePort } from './port-manager.js';
import { NamespaceStore, type ApiNamespace } from './namespace-store.js';
import { StartupWindow, type StartupStep } from './startup-window.js';
import {
  openSettingsWindow,
  registerSettingsHandlers,
} from './settings-window.js';

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
let healthMonitor: HealthMonitor | null = null;
let isQuitting = false;
let shutdownStarted = false;

// The web UI is only usable once the shared API answers. Until then every
// activation path (dock click, tray, second instance, deep link) must land on
// the startup window instead of loading the real UI against a dead API — that
// produced a window full of empty skeletons and "Failed to fetch".
let startupState: 'starting' | 'ready' | 'failed' = 'starting';
let startupWindow: StartupWindow | null = null;

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
  // Before the API is up there is nothing worth rendering: show progress
  // instead of a UI whose every request would fail.
  if (startupState !== 'ready') {
    startupWindow?.focus();
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  if (!sharedApiBaseUrl) return;
  mainWindow = createMainWindow();
}

/**
 * Terminal startup failure: the startup window stays up with the reason (and
 * the log path) instead of vanishing behind a modal, and the user is offered
 * the log before the app exits.
 */
async function failStartup(summary: string, error: unknown): Promise<void> {
  startupState = 'failed';
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`${summary} ${detail}`);
  startupWindow?.showError(`${summary}\n\n${detail}`);

  const logFile = getLogFilePath();
  const buttons = logFile ? ['Quit', 'Open Log'] : ['Quit'];
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Classifyre could not start',
    message: summary,
    detail,
    buttons,
    defaultId: 0,
  });
  if (logFile && buttons[response] === 'Open Log') {
    await shell.openPath(logFile);
  }
  app.quit();
}

// The service is crashing repeatedly. It is still being restarted — the
// supervisor never gives up — so this is a status report, not a decision to
// make. It used to be a modal dialog with a "Try Again" button, which was both
// annoying (it interrupts whatever the user is doing, on a machine where the
// fix is already under way) and misleading (it said the service was "no longer
// being restarted automatically", so users relaunched the app for no reason).
function reportApiHealth(event: ApiHealthEvent): void {
  if (startupState !== 'ready' || isQuitting || shutdownStarted) return;
  if (event.state === 'recovered') {
    console.log('Classifyre service recovered');
    tray?.setServiceHealthy(true);
    return;
  }
  console.error(event.reason ?? 'Classifyre service is unhealthy');
  tray?.setServiceHealthy(false);
  if (!settingsManager?.get().desktopNotifications) return;
  if (!Notification.isSupported()) return;
  const seconds = Math.round((event.nextRetryMs ?? 0) / 1000);
  new Notification({
    title: 'Classifyre is restarting its service',
    body:
      (event.reason ?? 'The service stopped unexpectedly.') +
      (seconds ? ` Retrying in ${seconds}s.` : ''),
    silent: true,
  }).show();
}

// Postgres died out from under the app. Bring it back, then restart the API:
// its pool, its port and possibly its password all belong to the instance that
// just went away.
async function recoverDatabase(): Promise<void> {
  await pg.restart();
  console.log(`Embedded PostgreSQL restarted on port ${pg.getPort()}`);
  await processManager.restartApiNow(
    SHARED_API_ID,
    Number(new URL(sharedApiBaseUrl).port),
    pg.getConnectionString(),
  );
}

function showHome(): void {
  showMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(appUrl());
  }
}

function openNamespace(namespace: ApiNamespace): void {
  showMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // A remote workspace opens in the embedded browser view (app route
  // `/remote/<id>`), never the system browser: the user stays in the app and
  // can walk back to the local workspace directory.
  const route =
    namespace.type === 'remote' ? `remote/${namespace.id}` : namespace.slug;
  void mainWindow.loadURL(appUrl(route));
}

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Whether `target` belongs to a remote workspace the user has registered.
 * Guest views may only be *attached* to a known remote origin; once attached
 * they browse that site freely (including an identity provider's login
 * redirect), the same as a browser tab would.
 */
function isRegisteredRemoteOrigin(target: string): boolean {
  const origin = safeOrigin(target);
  if (!origin) return false;
  return (namespaceStore?.list() ?? []).some(
    (namespace) =>
      namespace.type === 'remote' &&
      namespace.remoteUrl !== null &&
      safeOrigin(namespace.remoteUrl) === origin,
  );
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
  // Embedded remote workspaces (<webview> in the /remote/<id> route). The guest
  // renders a server we do not control, so it gets no preload and no Node —
  // only a persistent, per-remote session partition for its cookies.
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    // An empty/blank src means the attribute has not been applied yet — the
    // guest navigates itself a tick later. Anything else must be a workspace
    // the user registered.
    const src = params['src'] ?? '';
    if (src && src !== 'about:blank' && !isRegisteredRemoteOrigin(src)) {
      console.error(`[web] refused to attach webview to ${src}`);
      event.preventDefault();
    }
  });
  contents.on('did-attach-webview', (_event, guest) => {
    // A popup has no chrome to show where it came from — hand those to the
    // system browser. In-page navigation stays inside the guest.
    guest.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
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
 * Shows the window once its first page has painted and retires the startup
 * window at the same moment. A failed or slow load still reveals the window —
 * an error the user can see beats an indefinite splash.
 */
function revealWhenLoaded(win: BrowserWindow): void {
  let revealed = false;
  const reveal = (): void => {
    if (revealed) return;
    revealed = true;
    clearTimeout(fallback);
    if (!win.isDestroyed()) win.show();
    startupWindow?.close();
    startupWindow = null;
  };
  const fallback = setTimeout(reveal, 30_000);
  fallback.unref?.();
  // `did-finish-load`, not `ready-to-show`: the latter fires on the first paint
  // of an empty document, which would hand off to a blank window.
  win.webContents.once('did-finish-load', reveal);
  win.webContents.once('did-fail-load', reveal);
  win.once('closed', () => clearTimeout(fallback));
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
    // Stay hidden until the page has actually rendered, so the handoff from the
    // startup window is a swap rather than a flash of blank chrome.
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: getPreloadPath(),
      // Remote workspaces are browsed inside the app rather than handed to the
      // system browser; the guest's own preferences are locked down in
      // configureWebContents' will-attach-webview handler.
      webviewTag: true,
      additionalArguments: [`--api-base=${sharedApiBaseUrl}`],
    },
  });
  configureWebContents(win);
  revealWhenLoaded(win);
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

  // On screen before any of the slow work starts, so the app never sits in the
  // dock with nothing to show.
  startupWindow = new StartupWindow({ onCancel: () => app.quit() });
  startupWindow.show();
  // Later crash-recovery restarts reuse the same callbacks; ignore them once
  // the app is up so a background restart cannot resurrect startup UI.
  const reportProgress = (detail: string, phase?: StartupStep): void => {
    if (startupState !== 'starting') return;
    if (phase) startupWindow?.setStep(phase, detail);
    else startupWindow?.setDetail(detail);
  };

  settingsManager = new SettingsManager();
  pg = new PostgresManager(
    settingsManager.get().postgresPort,
    reportProgress,
    undefined,
    settingsManager.get().readonlyDbEnabled,
  );
  processManager = new ProcessManager(
    reportProgress,
    () => {
      const settings = settingsManager.get();
      return {
        memoryLimitMb: settings.memoryLimitMb,
        maxConcurrentRunners: settings.maxConcurrentRunners,
      };
    },
    reportApiHealth,
  );
  updateChecker = new UpdateChecker();
  updateChecker.startPeriodicChecks();

  try {
    startupWindow.setStep('database');
    await pg.start();
    console.log(`Embedded PostgreSQL started on port ${pg.getPort()}`);
  } catch (error) {
    await failStartup('The embedded PostgreSQL database failed to start.', error);
    return;
  }

  try {
    startupWindow.setStep('runtime');
    // A configured port is a preference, not a demand: getAvailablePort falls
    // forward to an ephemeral one rather than failing startup on a collision.
    const apiPort = await getAvailablePort(settingsManager.get().apiPort || undefined);
    sharedApiBaseUrl = `http://127.0.0.1:${apiPort}`;
    await processManager.startApi(
      SHARED_API_ID,
      apiPort,
      pg.getConnectionString(),
    );
    console.log(`Shared Classifyre API started on ${sharedApiBaseUrl}`);
  } catch (error) {
    await failStartup('The Classifyre API failed to start.', error);
    return;
  }

  namespaceStore = new NamespaceStore(sharedApiBaseUrl);

  const menuDeps = {
    namespaceStore,
    updateChecker,
    showHome,
    openNamespace,
    openSettings: openSettingsWindow,
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
  registerSettingsHandlers({
    settingsManager,
    getEffectivePorts: () => ({
      apiPort: Number(new URL(sharedApiBaseUrl).port),
      postgresPort: pg.getPort(),
    }),
    getReadonlyInfo: () => pg.getReadonlyInfo(),
    regenerateReadonly: () => pg.regenerateReadonlyPassword(),
    // The tray mirrors two of these settings as checkboxes.
    onSaved: () => tray?.rebuildMenu(),
  });
  registerNotificationHandlers({
    settingsManager,
    showWindow: showMainWindow,
    getWebContents: () => mainWindow?.webContents ?? null,
  });

  startupWindow.setStep('interface', 'Opening the workspace directory…');
  await namespaceStore.start();

  // Closing the startup window mid-boot quits the app; don't pop a main window
  // open on top of a shutdown that is already running.
  if (isQuitting) return;

  // Only now may any activation path open the real UI: everything it talks to
  // is live. createMainWindow closes the startup window once the page loads.
  startupState = 'ready';
  mainWindow = createMainWindow();

  // Only now: during startup a probe would race the boot it is watching, and
  // the startup window already owns that failure surface.
  healthMonitor = new HealthMonitor({
    apiBaseUrl: () => sharedApiBaseUrl || null,
    // A supervised restart is already in flight, or the app is on its way out.
    isWatchable: () =>
      startupState === 'ready' &&
      !isQuitting &&
      !shutdownStarted &&
      !processManager.isTransitioning(SHARED_API_ID),
    pingDatabase: () => pg.ping(),
    recoverDatabase,
    restartApi: () =>
      processManager.restartApiNow(
        SHARED_API_ID,
        Number(new URL(sharedApiBaseUrl).port),
        pg.getConnectionString(),
      ),
    log: (message) => console.error(message),
  });
  healthMonitor.start();

  // Startup update check runs once the window exists, so the "update available"
  // prompt doesn't arrive before the app itself does.
  setTimeout(() => void updateChecker.backgroundCheck(), 10_000).unref?.();
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
  healthMonitor?.stop();
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
