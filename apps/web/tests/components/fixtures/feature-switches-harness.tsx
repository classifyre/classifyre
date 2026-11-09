"use client";

import * as React from "react";
import { FeatureSwitchesCard } from "@/components/maintenance/feature-switches-card";
import { FeatureOffNotice } from "@/components/feature-off-notice";
import { NamespaceProvider } from "@/components/namespace-provider";
import { ServerConfigContext } from "@/components/server-config-provider";
import { InstanceSettingsProvider } from "@/components/instance-settings-provider";

/**
 * The Features card as the Cleanup tab mounts it — inside a workspace, since
 * the switches are per workspace — next to a notice another page would show,
 * so one test can flip a switch and watch the rest of the product react.
 */
export function FeatureSwitchesHarness() {
  return (
    <ServerConfigContext.Provider
      value={{ logsPersisted: false, demoMode: false }}
    >
      <InstanceSettingsProvider>
        <NamespaceProvider slug="acme">
          <FeatureOffNotice feature="duplicates" context="review" />
          <FeatureSwitchesCard />
        </NamespaceProvider>
      </InstanceSettingsProvider>
    </ServerConfigContext.Provider>
  );
}
