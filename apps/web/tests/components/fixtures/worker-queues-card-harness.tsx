"use client";

import * as React from "react";
import { WorkerQueuesCard } from "@/components/worker-queues-card";
import { ServerConfigContext } from "@/components/server-config-provider";
import { InstanceSettingsProvider } from "@/components/instance-settings-provider";

/**
 * Drives the card the way the settings page does: demo mode off everywhere,
 * instance settings loading from the (stubbed) API like production.
 */
export function WorkerQueuesCardHarness() {
  return (
    <ServerConfigContext.Provider
      value={{ logsPersisted: false, demoMode: false }}
    >
      <InstanceSettingsProvider>
        <WorkerQueuesCard />
      </InstanceSettingsProvider>
    </ServerConfigContext.Provider>
  );
}
