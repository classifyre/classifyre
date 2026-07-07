import { app, Menu, shell, dialog, clipboard, type MenuItemConstructorOptions } from 'electron';
import fs from 'fs';
import path from 'path';
import { getLogFilePath } from './logger.js';

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

export function buildApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? ([{ role: 'appMenu' }] as MenuItemConstructorOptions[]) : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { label: 'Logs', submenu: logsSubmenu },
    {
      role: 'help',
      submenu: [
        ...logsSubmenu,
        { type: 'separator' },
        {
          label: `Classifyre ${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
