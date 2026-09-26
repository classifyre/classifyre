"use client";

import * as React from "react";
import { AppSidebar } from "./app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar";
import { Separator } from "@workspace/ui/components/separator";
import { AssistantFab } from "./assistant-workflow-provider";
import { DemoModeBanner } from "./demo-mode-badge";
import { PausedWorkspaceBanner } from "./namespace/paused-workspace-banner";
import { DocumentTitleUpdater } from "./document-title-updater";
import { AiHealthProvider } from "./ai-health";
import { AppBreadcrumbs, HeaderActions } from "./app-header";
import type { ServerConfig } from "@/lib/server-config";
import {
  DEFAULT_SERVER_CONFIG,
  ServerConfigContext,
  useServerConfig,
} from "./server-config-provider";
import { ActiveNamespaceTabs } from "./namespace/active-namespace-tabs";

// The server config context lives in ./server-config-provider so components
// rendered by this layout can consume it without importing back into here.
// Re-exported for the existing call sites that import it from this module.
export { useServerConfig };

export function DashboardLayout({
  children,
  serverConfig = DEFAULT_SERVER_CONFIG,
}: {
  children: React.ReactNode;
  serverConfig?: ServerConfig;
}) {
  const { demoMode } = serverConfig;

  return (
    <ServerConfigContext.Provider value={serverConfig}>
      <SidebarProvider>
        <AiHealthProvider>
          {/* Mounted here (not in the root layout) so the document title can
              name the active workspace. Wraps the page so a detail route can
              contribute its entity name via `useEntityDocumentTitle`. */}
          <DocumentTitleUpdater>
            <AppSidebar />
            <SidebarInset className="min-w-0 overflow-x-clip">
              <ActiveNamespaceTabs />
              <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b px-3 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                  <SidebarTrigger className="-ml-1 size-7 shrink-0" />
                  <Separator orientation="vertical" className="mr-1 h-4 shrink-0 sm:mr-2" />
                  <AppBreadcrumbs />
                </div>
                <HeaderActions demoMode={demoMode} />
              </header>
              {demoMode && <DemoModeBanner />}
              <PausedWorkspaceBanner />
              <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-2">
                {children}
              </div>
            </SidebarInset>
            <AssistantFab />
          </DocumentTitleUpdater>
        </AiHealthProvider>
      </SidebarProvider>
    </ServerConfigContext.Provider>
  );
}
