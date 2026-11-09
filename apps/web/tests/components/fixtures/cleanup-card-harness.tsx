"use client";

import * as React from "react";
import { CleanupCard } from "@/components/maintenance/cleanup-card";
import { ServerConfigContext } from "@/components/server-config-provider";
import { InstanceSettingsProvider } from "@/components/instance-settings-provider";

/**
 * Drives the card the way the settings page does: demo mode off everywhere,
 * instance settings loading from the (stubbed) API like production.
 */
export function CleanupCardHarness() {
  return (
    <ServerConfigContext.Provider
      value={{ logsPersisted: false, demoMode: false }}
    >
      <InstanceSettingsProvider>
        <CleanupCard />
      </InstanceSettingsProvider>
    </ServerConfigContext.Provider>
  );
}
