import { app, Menu, shell, dialog, clipboard, type MenuItemConstructorOptions } from 'electron';
import fs from 'fs';
import path from 'path';
import { getLogFilePath } from './logger.js';
import type { NamespaceRuntime } from './namespace-runtime.js';
import type { NamespaceManager } from './namespace-manager.js';
import type { UpdateChecker } from './update-checker.js';

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

export interface MenuDeps {
  runtime: NamespaceRuntime;
  namespaceManager: NamespaceManager;
  updateChecker: UpdateChecker;
  showMainWindow: () => void;
}

function workspaceItems(deps: MenuDeps): MenuItemConstructorOptions[] {
  const { runtime, namespaceManager, showMainWindow } = deps;
  return namespaceManager.list().map((ns, i) => ({
    label: ns.name,
    type: 'checkbox' as const,
    checked: runtime.isOpen(ns.id),
    // Cmd/Ctrl+1..9 jump straight to a workspace (opening it if needed).
    ...(i < 9 ? { accelerator: `CmdOrCtrl+${i + 1}` } : {}),
    click: () => {
      showMainWindow();
      runtime.open(ns.id).catch((err) => console.error(`[menu] open ${ns.name} failed:`, err));
    },
  }));
}

export function buildApplicationMenu(deps: MenuDeps): void {
  const { runtime, updateChecker, showMainWindow } = deps;

  const checkForUpdates: MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    // Interactive: reports back with a dialog even when already up to date.
    click: () => void updateChecker.checkForUpdates(true),
  };

  const workspacesSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'Workspaces Home',
      // Cmd+T = "new tab": the picker is where new workspace tabs come from.
      // (Cmd+0 stays the View menu's zoom reset.)
      accelerator: 'CmdOrCtrl+T',
      click: () => {
        showMainWindow();
        runtime.showSelector();
      },
    },
    { type: 'separator' },
    ...workspaceItems(deps),
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
