import { BrowserWindow, Notification, ipcMain } from 'electron';
import type { NamespaceRuntime } from './namespace-runtime.js';
import type { SettingsManager } from './settings-manager.js';

// Payload forwarded by the web renderer when its notifications websocket
// receives `notification:created`. The renderer is the source of truth for
// notification delivery (each workspace tab already holds a live socket to its
// own API instance), so the main process never has to know API ports or
// manage its own socket clients — it only renders the native OS toast.
export interface DesktopNotificationPayload {
  id?: string;
  title?: string;
  message?: string;
  /** Relative web-app route, e.g. /scans/:id — resolved by the sending tab. */
  actionUrl?: string;
  /** Display name captured by the namespace-scoped shared web view. */
  namespaceName?: string;
  severity?: string;
}

export interface NotificationServiceDeps {
  runtime: NamespaceRuntime;
  settingsManager: SettingsManager;
  showWindow: () => void;
}

export function registerNotificationHandlers(deps: NotificationServiceDeps): void {
  const { runtime, settingsManager, showWindow } = deps;

  ipcMain.on('notification:show', (event, payload: DesktopNotificationPayload) => {
    if (!settingsManager.get().desktopNotifications) return;
    if (!Notification.isSupported()) return;
    if (!payload || typeof payload !== 'object') return;

    // The new desktop architecture has one shared web view for all local
    // namespaces. Keep support for legacy remote/per-workspace views too.
    const namespaceId = runtime.findNamespaceIdByWebContents(event.sender);
    const isSharedView = runtime.isSelectorWebContents(event.sender);
    if (!namespaceId && !isSharedView) return;
    const namespaceName =
      (typeof payload.namespaceName === 'string' && payload.namespaceName) ||
      (namespaceId
        ? runtime.getRunning().get(namespaceId)?.namespace.name
        : undefined);

    // The in-app notification center already surfaces it when the user is
    // looking at that workspace — only toast when the app is unfocused/hidden
    // or a different tab is active.
    const appFocused = BrowserWindow.getAllWindows().some(
      (w) => !w.isDestroyed() && w.isVisible() && w.isFocused(),
    );
    if (
      appFocused &&
      (isSharedView || runtime.getActiveTabId() === namespaceId)
    )
      return;

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
      if (isSharedView) {
        if (actionUrl) runtime.navigateSelector(actionUrl);
        else runtime.showSelector();
        return;
      }

      // namespaceId is present for the legacy-view branch above.
      if (!namespaceId) return;
      const entry = runtime.getRunning().get(namespaceId);
      if (entry) {
        runtime.switchToTab(namespaceId);
        if (actionUrl) entry.view.webContents.send('desktop-notification:navigate', actionUrl);
      } else {
        // Tab was closed after the toast fired — reopen the workspace, then
        // deep-link once its view exists.
        runtime
          .open(namespaceId)
          .then((reopened) => {
            if (actionUrl) {
              reopened.view.webContents.send('desktop-notification:navigate', actionUrl);
            }
          })
          .catch((err) => console.error('[notifications] reopen failed:', err));
      }
    });

    notification.show();
  });
}
