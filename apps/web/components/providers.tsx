"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { Toaster } from "@workspace/ui/components";
import { AssistantWorkflowProvider } from "@/components/assistant-workflow-provider";
import { CookieConsent } from "@/components/cookie-consent";
import { DemoModeBlockedDialog } from "@/components/demo-mode-blocked-dialog";
import { InstanceSettingsProvider } from "@/components/instance-settings-provider";
import { PostHogProvider } from "@/components/posthog-provider";
import { ActiveNamespacesProvider } from "@/components/active-namespaces-provider";
import type { Locale } from "@/lib/locale-detection";

export function Providers({
  children,
  locale,
}: {
  children: React.ReactNode;
  /** Route locale, so language resolution starts from the URL. */
  locale: Locale;
}) {
  return (
    <PostHogProvider>
      <NextThemesProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        enableColorScheme
      >
        <ActiveNamespacesProvider>
          <InstanceSettingsProvider routeLocale={locale}>
            <AssistantWorkflowProvider>
              {children}
              <DemoModeBlockedDialog />
              {/* Inside InstanceSettingsProvider so the bar speaks the same
                  language as the rest of the app. */}
              <CookieConsent />
              <Toaster />
            </AssistantWorkflowProvider>
          </InstanceSettingsProvider>
        </ActiveNamespacesProvider>
      </NextThemesProvider>
    </PostHogProvider>
  );
}
