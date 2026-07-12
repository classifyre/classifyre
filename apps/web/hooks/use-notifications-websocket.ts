"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

const getWebSocketUrl = () => {
  if (
    typeof window !== "undefined" &&
    (window as any).__CLASSIFYRE_DESKTOP__?.apiBaseUrl
  ) {
    return (window as any).__CLASSIFYRE_DESKTOP__.apiBaseUrl as string;
  }

  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  if (typeof window !== "undefined") {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl) {
      if (apiUrl.startsWith("/")) {
        return window.location.origin;
      }
      return apiUrl;
    }

    return window.location.origin;
  }

  return "http://localhost:8000";
};

const WS_URL = getWebSocketUrl();

export function useNotificationsWebSocket({
  onChange,
  onCreated,
}: {
  onChange?: () => void;
  /** Fires with the full notification payload when a new one is created. */
  onCreated?: (notification: Record<string, unknown>) => void;
} = {}) {
  const socketRef = useRef<Socket | null>(null);
  const callbackRef = useRef<(() => void) | undefined>(onChange);
  const createdRef = useRef<typeof onCreated>(onCreated);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    callbackRef.current = onChange;
    createdRef.current = onCreated;
  }, [onChange, onCreated]);

  useEffect(() => {
    const socket = io(`${WS_URL}/notifications`, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
      autoConnect: true,
    });

    socketRef.current = socket;

    const handleChange = () => {
      callbackRef.current?.();
    };

    socket.on("connect", () => {
      setIsConnected(true);
      socket.emit("subscribe:notifications");
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("connect_error", () => {
      setIsConnected(false);
    });

    socket.on("reconnect", () => {
      setIsConnected(true);
      socket.emit("subscribe:notifications");
    });

    socket.on("notification:created", (notification: Record<string, unknown>) => {
      createdRef.current?.(notification);
      handleChange();
    });
    socket.on("notification:updated", handleChange);
    socket.on("notification:deleted", handleChange);
    socket.on("notifications:changed", handleChange);

    return () => {
      if (socket.connected) {
        socket.emit("unsubscribe:notifications");
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return {
    isConnected,
  };
}
