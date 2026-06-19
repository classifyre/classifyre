"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import type { RunnerDto, RunnerLogEntryDto } from "@workspace/api-client";
import { parseRunnerSocketPayload } from "@/lib/runner-ws-merge";

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

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:8000";
  }

  if (typeof window !== "undefined") {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl && !apiUrl.startsWith("/")) {
      return apiUrl;
    }
    return window.location.origin;
  }

  return "http://localhost:8000";
};

const WS_URL = getWebSocketUrl();

export type UseRunnerWebSocketOptions = {
  /** When false, the socket is not opened. */
  enabled?: boolean;
  /**
   * When true (default), keeps an internal runners list for simple consumers.
   * Set false when you only use onRunnerUpdate / onRunnerCreated.
   */
  trackRunnersList?: boolean;
  onRunnerUpdate?: (runner: RunnerDto) => void;
  onRunnerCreated?: (runner: RunnerDto) => void;
  /** Called when the server pushes new log entries for a runner in real-time. */
  onRunnerLog?: (runnerId: string, entries: RunnerLogEntryDto[]) => void;
};

export function useRunnerWebSocket(options?: UseRunnerWebSocketOptions) {
  const enabled = options?.enabled ?? true;
  const optsRef = useRef(options);
  optsRef.current = options;

  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [runners, setRunners] = useState<RunnerDto[]>([]);

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      return;
    }

    const socketUrl = `${WS_URL}/runners`;
    const socket = io(socketUrl, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      autoConnect: true,
    });

    socketRef.current = socket;

    const subscribe = () => {
      socket.emit("subscribe:runners");
    };

    const handlePayload = (raw: unknown) => {
      try {
        return parseRunnerSocketPayload(raw);
      } catch {
        return null;
      }
    };

    const onUpdate = (raw: unknown) => {
      const runner = handlePayload(raw);
      if (!runner) return;
      optsRef.current?.onRunnerUpdate?.(runner);
      if (optsRef.current?.trackRunnersList !== false) {
        setRunners((prev) => {
          const index = prev.findIndex((r) => r.id === runner.id);
          if (index >= 0) {
            const updated = [...prev];
            updated[index] = runner;
            return updated;
          }
          return prev;
        });
      }
    };

    const onCreated = (raw: unknown) => {
      const runner = handlePayload(raw);
      if (!runner) return;
      optsRef.current?.onRunnerCreated?.(runner);
      if (optsRef.current?.trackRunnersList !== false) {
        setRunners((prev) => {
          if (prev.find((r) => r.id === runner.id)) return prev;
          return [runner, ...prev];
        });
      }
    };

    socket.on("connect", () => {
      setIsConnected(true);
      subscribe();
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("connect_error", () => {
      setIsConnected(false);
    });

    socket.on("reconnect", () => {
      setIsConnected(true);
      subscribe();
    });

    socket.on("reconnect_failed", () => {
      setIsConnected(false);
    });

    const onLog = (payload: unknown) => {
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("runnerId" in payload) ||
        !("entries" in payload)
      )
        return;
      const { runnerId, entries } = payload as {
        runnerId: string;
        entries: RunnerLogEntryDto[];
      };
      optsRef.current?.onRunnerLog?.(runnerId, entries);
    };

    socket.on("runner:update", onUpdate);
    socket.on("runner:created", onCreated);
    socket.on("runner:log", onLog);

    return () => {
      socket.off("runner:update", onUpdate);
      socket.off("runner:created", onCreated);
      socket.off("runner:log", onLog);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled]);

  const subscribeToRunner = useCallback((runnerId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("subscribe:runner", runnerId);
    }
  }, []);

  const unsubscribeFromRunner = useCallback((runnerId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("unsubscribe:runner", runnerId);
    }
  }, []);

  return {
    isConnected,
    runners,
    setRunners,
    subscribeToRunner,
    unsubscribeFromRunner,
  };
}
