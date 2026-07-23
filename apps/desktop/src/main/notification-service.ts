import { BrowserWindow, Notification, ipcMain, type WebContents } from 'electron';
import type { SettingsManager } from './settings-manager.js';

// Payload forwarded by the web renderer when its namespace-scoped websocket
// receives `notification:created`. The renderer remains the source of truth
// for notification delivery; main only renders the native OS toast.
export interface DesktopNotificationPayload {
  id?: string;
  title?: string;
  message?: string;
  /** Namespace-qualified web-app route, e.g. /acme/scans/:id. */
  actionUrl?: string;
  /** Display name captured by the namespace-scoped shared web view. */
  namespaceName?: string;
  severity?: string;
}

export interface NotificationServiceDeps {
  settingsManager: SettingsManager;
  showWindow: () => void;
  getWebContents: () => WebContents | null;
}

export function registerNotificationHandlers(deps: NotificationServiceDeps): void {
  const { settingsManager, showWindow, getWebContents } = deps;

  ipcMain.on('notification:show', (event, payload: DesktopNotificationPayload) => {
    if (!settingsManager.get().desktopNotifications) return;
    if (!Notification.isSupported()) return;
    if (!payload || typeof payload !== 'object') return;

    const contents = getWebContents();
    if (!contents || contents !== event.sender) return;
    const namespaceName =
      typeof payload.namespaceName === 'string' && payload.namespaceName
        ? payload.namespaceName
        : undefined;

    // The in-app notification center already surfaces it when the user is
    // looking at the app — only toast when the window is unfocused or hidden.
    const appFocused = BrowserWindow.getAllWindows().some(
      (w) => !w.isDestroyed() && w.isVisible() && w.isFocused(),
    );
    if (appFocused) return;

    const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Classifyre';
    const body = typeof payload.message === 'string' ? payload.message : '';
    const actionUrl = typeof payload.actionUrl === 'string' ? payload.actionUrl : undefined;
    const severity = typeof payload.severity === 'string' ? payload.severity : 'INFO';

    const notification = new Notification({
      title: namespaceName ? `${namespaceName} — ${title}` : title,
      body,
      silent: false,
      // Linux (libnotify) urgency; ignored on macOS/Windows.
      urgency: severity === 'HIGH' || severity === 'CRITICAL' ? 'critical' : 'normal',
    });

    notification.on('click', () => {
      showWindow();
      const destination = getWebContents();
      if (actionUrl && destination && !destination.isDestroyed()) {
        destination.send('desktop-notification:navigate', actionUrl);
      }
    });

    notification.show();
  });
}
