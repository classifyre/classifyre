"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isDesktopShell } from "@/lib/desktop";
import { useNotificationsWebSocket } from "@/hooks/use-notifications-websocket";
import { nsPath } from "@/lib/ns-path";
import { useNamespace } from "@/components/namespace-provider";

type DesktopNotificationsApi = {
  showNotification: (payload: Record<string, unknown>) => void;
  onNotificationNavigate: (cb: (url: string) => void) => () => void;
};

function getDesktopApi(): DesktopNotificationsApi | null {
  if (!isDesktopShell()) return null;
  const api = window.electronAPI;
  if (!api?.showNotification || !api?.onNotificationNavigate) return null;
  return api as DesktopNotificationsApi;
}

/**
 * Inside the Electron shell, forwards freshly-received in-app notifications
 * to the main process (which shows a native OS toast) and handles the
 * click-through deep link back into this workspace tab. Renders nothing and
 * no-ops in the plain web app.
 */
export function DesktopNotificationsBridge() {
  const router = useRouter();
  const { displayName } = useNamespace();
  const [desktopApi] = useState(getDesktopApi);

  useEffect(() => {
    if (!desktopApi) return;
    return desktopApi.onNotificationNavigate((url) => {
      if (typeof url === "string" && url.startsWith("/")) {
        // The URL was namespace-qualified when the toast was created. Do not
        // re-scope it to whichever workspace happens to be open on click.
        router.push(url);
      }
    });
  }, [desktopApi, router]);

  const handleCreated = useCallback(
    (notification: Record<string, unknown>) => {
      desktopApi?.showNotification({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        namespaceName: displayName,
        actionUrl:
          typeof notification.actionUrl === "string"
            ? nsPath(notification.actionUrl)
            : undefined,
        severity: notification.severity,
      });
    },
    [desktopApi, displayName],
  );

  useNotificationsWebSocket(desktopApi ? { onCreated: handleCreated } : {});

  return null;
}
