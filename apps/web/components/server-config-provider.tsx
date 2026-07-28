"use client";

import * as React from "react";
import type { ServerConfig } from "@/lib/server-config";

// Populated once by the server layout (getServerConfig()) and distributed to
// all client components via this context. Default to safe values so that UI
// does not flash incorrect states before the first render.
//
// Lives in its own module rather than in dashboard-layout so components the
// layout renders (ai-health, …) can read it without an import cycle.
export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  s3Configured: true,
  demoMode: false,
};

export const ServerConfigContext = React.createContext<ServerConfig>(
  DEFAULT_SERVER_CONFIG,
);

export function useServerConfig(): ServerConfig {
  return React.useContext(ServerConfigContext);
}
