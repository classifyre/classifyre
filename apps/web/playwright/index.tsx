import * as React from "react";
import { beforeMount } from "@playwright/experimental-ct-react/hooks";
import { InstanceSettingsProvider } from "@/components/instance-settings-provider";

beforeMount(async ({ App }) => {
  return (
    <InstanceSettingsProvider>
      <App />
    </InstanceSettingsProvider>
  );
});
