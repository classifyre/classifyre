import * as React from "react";
import { AiHealthFixButton, AiHealthProvider } from "@/components/ai-health";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { ServerConfigContext } from "@/components/server-config-provider";

export function AiHealthHarness() {
  const { updateSettings } = useInstanceSettings();

  return (
    <ServerConfigContext.Provider
      value={{ s3Configured: false, demoMode: false }}
    >
      <AiHealthProvider>
        <button
          onClick={() =>
            void updateSettings({
              aiEnabled: false,
              aiProviderConfigId: null,
              harnessEnabled: true,
              harnessAiProviderConfigId: "harness-provider",
            })
          }
        >
          Configure Harness only
        </button>
        <AiHealthFixButton />
      </AiHealthProvider>
    </ServerConfigContext.Provider>
  );
}
