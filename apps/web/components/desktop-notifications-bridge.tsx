"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isDesktopShell } from "@/lib/desktop";
import { useNotificationsWebSocket } from "@/hooks/use-notifications-websocket";

type DesktopNotificationsApi = {
  showNotification: (payload: Record<string, unknown>) => void;
  onNotificationNavigate: (cb: (url: string) => void) => void;
};

function getDesktopApi(): DesktopNotificationsApi | null {
  if (!isDesktopShell()) return null;
  const api = (window as any).electronAPI;
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
  const [desktopApi] = useState(getDesktopApi);

  useEffect(() => {
    if (!desktopApi) return;
    desktopApi.onNotificationNavigate((url) => {
      if (typeof url === "string" && url.startsWith("/")) {
        router.push(url);
      }
    });
    // Preload registers listeners for the lifetime of the page; no cleanup API.
  }, [desktopApi, router]);

  const handleCreated = useCallback(
    (notification: Record<string, unknown>) => {
      desktopApi?.showNotification({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        actionUrl: notification.actionUrl,
        severity: notification.severity,
      });
    },
    [desktopApi],
  );

  useNotificationsWebSocket(desktopApi ? { onCreated: handleCreated } : {});

  return null;
}
