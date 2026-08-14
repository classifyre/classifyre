import { app, Menu, shell, dialog, clipboard, type MenuItemConstructorOptions } from 'electron';
import fs from 'fs';
import path from 'path';
import { getLogFilePath } from './logger.js';
import type { ApiNamespace, NamespaceStore } from './namespace-store.js';
import type { UpdateChecker } from './update-checker.js';
import type { SettingsManager } from './settings-manager.js';

// The packaged GUI has no attached terminal, so the tee'd log file in userData
// (see logger.ts) is the only window into what the app, API, and Postgres did.
// This menu surfaces it so a user can open/reveal the log without hunting
// through ~/Library/Application Support. Without an explicit application menu
// Electron installs a bare default one that has no such entry.

function withLogFile(action: (logFile: string) => void): void {
  const logFile = getLogFilePath();
  if (!logFile || !fs.existsSync(logFile)) {
    void dialog.showMessageBox({
      type: 'info',
      title: 'No log file yet',
      message: 'No log file has been created yet. Open a workspace first, then try again.',
    });
    return;
  }
  action(logFile);
}

const isMac = process.platform === 'darwin';
const revealLabel = isMac ? 'Reveal Log File in Finder' : 'Show Log File in Explorer';

const logsSubmenu: MenuItemConstructorOptions[] = [
  {
    label: 'Open Log File',
    accelerator: 'CmdOrCtrl+Shift+L',
    click: () => withLogFile((logFile) => void shell.openPath(logFile)),
  },
  {
    label: revealLabel,
    click: () => withLogFile((logFile) => shell.showItemInFolder(logFile)),
  },
  {
    label: 'Open Logs Folder',
    click: () => withLogFile((logFile) => void shell.openPath(path.dirname(logFile))),
  },
  { type: 'separator' },
  {
    label: 'Copy Log File Path',
    click: () =>
      withLogFile((logFile) => {
        clipboard.writeText(logFile);
      }),
  },
];

/**
 * Selectable values for the API's V8 heap ceiling, in MB.
 *
 * 0 means "automatic" (see computeApiHeapMb), which is the right answer for
 * almost every install — a bigger heap makes V8 collect *less* often, so
 * raising this is not a general performance knob and usually makes memory
 * behaviour worse. It exists for the one case where the automatic value is
 * genuinely too small: a workspace whose correlation graph is large enough
 * that a single read does not fit, which fails as "Ineffective mark-compacts
 * near heap limit" in the log. Values above 4 GB are not offered because
 * Electron will not grant them (see ELECTRON_MAX_OLD_SPACE_MB).
 */
export const MEMORY_LIMIT_CHOICES: { label: string; value: number }[] = [
  { label: 'Automatic (recommended)', value: 0 },
  { label: '3 GB', value: 3072 },
  { label: '4 GB (maximum)', value: 4096 },
];

export interface MenuDeps {
  namespaceStore: NamespaceStore;
  updateChecker: UpdateChecker;
  settingsManager: SettingsManager;
  showHome: () => void;
  openNamespace: (namespace: ApiNamespace) => void;
  /** Restarts the shared API so a new heap ceiling takes effect. */
  restartApi: () => Promise<void>;
  /** Re-renders the menu so the radio selection reflects the saved value. */
  refreshMenu: () => void;
}

function memoryLimitSubmenu(deps: MenuDeps): MenuItemConstructorOptions[] {
  const current = deps.settingsManager.get().memoryLimitMb;
  return MEMORY_LIMIT_CHOICES.map(({ label, value }) => ({
    label,
    type: 'radio',
    checked: current === value,
    click: () => {
      if (deps.settingsManager.get().memoryLimitMb === value) return;
      deps.settingsManager.update({ memoryLimitMb: value });
      deps.refreshMenu();
      void promptRestart(deps);
    },
  }));
}

async function promptRestart(deps: MenuDeps): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Restart the Classifyre service?',
    message: 'The memory limit applies when the Classifyre service restarts.',
    detail:
      'Restarting interrupts any scan that is running; it can be re-run ' +
      'afterwards. Choosing Later applies the new limit the next time the ' +
      'app starts.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return;
  try {
    await deps.restartApi();
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Restart failed',
      message: 'The Classifyre service could not be restarted.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function workspaceItems(deps: MenuDeps): MenuItemConstructorOptions[] {
  return deps.namespaceStore.list().map((namespace, index) => ({
    label: namespace.name,
    // Cmd/Ctrl+1..9 jump straight to a workspace (opening it if needed).
    ...(index < 9 ? { accelerator: `CmdOrCtrl+${index + 1}` } : {}),
    click: () => deps.openNamespace(namespace),
  }));
}

export function buildApplicationMenu(deps: MenuDeps): void {
  const { updateChecker, showHome } = deps;

  const checkForUpdates: MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    // Interactive: reports back with a dialog even when already up to date.
    click: () => void updateChecker.checkForUpdates(true),
  };

  const workspacesSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'Workspaces Home',
      // Keep the familiar new-workspace shortcut for returning to the
      // namespace directory. (Cmd+0 remains the View menu's zoom reset.)
      accelerator: 'CmdOrCtrl+T',
      click: showHome,
    },
    { type: 'separator' },
    ...workspaceItems(deps),
  ];

  // Machine-level tuning, deliberately native rather than part of the in-app
  // (web) settings: it configures the local API *process*, applies per
  // installation rather than per workspace, and has to remain reachable when
  // that process is unhealthy — which is exactly when someone needs it.
  const settingsSubmenu: MenuItemConstructorOptions[] = [
    { label: 'API Memory Limit', submenu: memoryLimitSubmenu(deps) },
  ];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              checkForUpdates,
              { type: 'separator' },
              { label: 'Settings', submenu: settingsSubmenu },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    // Windows and Linux have no application menu to hang Settings off, so it
    // becomes a top-level entry there.
    ...(isMac
      ? []
      : ([{ label: 'Settings', submenu: settingsSubmenu }] as MenuItemConstructorOptions[])),
    { label: 'Workspaces', submenu: workspacesSubmenu },
    { role: 'windowMenu' },
    { label: 'Logs', submenu: logsSubmenu },
    {
      role: 'help',
      submenu: [
        ...logsSubmenu,
        { type: 'separator' },
        ...(isMac ? [] : [checkForUpdates]),
        {
          label: `Classifyre ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  // Right-clicking the dock icon lists workspaces too.
  if (isMac) {
    app.dock?.setMenu(Menu.buildFromTemplate(workspacesSubmenu));
  }
}
