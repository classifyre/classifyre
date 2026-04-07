"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { Toaster } from "@workspace/ui/components";
import { AssistantWorkflowProvider } from "@/components/assistant-workflow-provider";
import { DemoModeBlockedDialog } from "@/components/demo-mode-blocked-dialog";
import { InstanceSettingsProvider } from "@/components/instance-settings-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      enableColorScheme
    >
      <InstanceSettingsProvider>
        <AssistantWorkflowProvider>
          {children}
          <DemoModeBlockedDialog />
          <Toaster />
        </AssistantWorkflowProvider>
      </InstanceSettingsProvider>
    </NextThemesProvider>
  );
}
