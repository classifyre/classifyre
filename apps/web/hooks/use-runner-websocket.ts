"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { RunnerDto } from "@workspace/api-client";

// WebSocket must connect directly to backend (not through Next.js proxy)
// Next.js rewrites only work for HTTP requests, not WebSocket connections
const getWebSocketUrl = () => {
  // Use explicit WebSocket URL if provided
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  // In development, always connect directly to backend (port 8000)
  // Next.js proxy at /api doesn't support WebSocket upgrades
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:8000";
  }

  // Production: use API URL if it's a full URL, otherwise same origin
  if (typeof window !== "undefined") {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl && !apiUrl.startsWith("/")) {
      // Full URL provided (e.g., https://api.example.com)
      return apiUrl;
    }
    // If API URL is relative (/api), backend is likely on same origin
    // In production, backend might be on same domain or different port
    // Default to same origin - adjust if backend is on different domain
    return window.location.origin;
  }

  return "http://localhost:8000";
};

const WS_URL = getWebSocketUrl();

export function useRunnerWebSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [runners, setRunners] = useState<RunnerDto[]>([]);

  useEffect(() => {
    // Initialize socket connection
    // WebSocket connects directly to backend (not through Next.js proxy)
    const socketUrl = `${WS_URL}/runners`;
    console.log("Connecting to WebSocket:", socketUrl);

    const socket = io(socketUrl, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      autoConnect: true,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      // Subscribe to all runner updates
      socket.emit("subscribe:runners");
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("connect_error", (error) => {
      console.error("WebSocket connection error:", error);
      console.error("Attempted to connect to:", socketUrl);
      setIsConnected(false);
    });

    socket.on("reconnect_attempt", (attemptNumber) => {
      console.log(`WebSocket reconnection attempt ${attemptNumber}`);
    });

    socket.on("reconnect", (attemptNumber) => {
      console.log(`WebSocket reconnected after ${attemptNumber} attempts`);
      setIsConnected(true);
      socket.emit("subscribe:runners");
    });

    socket.on("reconnect_failed", () => {
      console.error("WebSocket reconnection failed");
      setIsConnected(false);
    });

    // Listen for runner updates
    socket.on("runner:update", (runner: RunnerDto) => {
      setRunners((prev) => {
        const index = prev.findIndex((r) => r.id === runner.id);
        if (index >= 0) {
          // Update existing runner
          const updated = [...prev];
          updated[index] = runner;
          return updated;
        } else {
          // Add new runner
          return [runner, ...prev];
        }
      });
    });

    // Listen for new runners
    socket.on("runner:created", (runner: RunnerDto) => {
      setRunners((prev) => {
        // Check if runner already exists
        if (prev.find((r) => r.id === runner.id)) {
          return prev;
        }
        return [runner, ...prev];
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

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
