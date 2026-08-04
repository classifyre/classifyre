"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import {
  DemoUpgradeFootnote,
  DemoUpgradeOptions,
} from "./demo-upgrade-cta";
import { useTranslation } from "@/hooks/use-translation";

const DEMO_BLOCKED_EVENT = "classifyre:demo-blocked";

function installDemoModeFetchInterceptor() {
  if (typeof window === "undefined") return;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const response = await originalFetch(...args);

    if (response.status === 403) {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("json")) {
        try {
          const body = (await response.clone().json()) as Record<
            string,
            unknown
          >;
          if (
            body.demoMode === true ||
            body.code === "DEMO_MODE_READ_ONLY"
          ) {
            window.dispatchEvent(new CustomEvent(DEMO_BLOCKED_EVENT));
          }
        } catch {
          // ignore parse errors
        }
      }
    }

    return response;
  };
}

export function DemoModeBlockedDialog() {
  const [open, setOpen] = React.useState(false);
  const { t } = useTranslation();

  React.useEffect(() => {
    installDemoModeFetchInterceptor();
  }, []);

  React.useEffect(() => {
    function handleDemoBlocked() {
      setOpen(true);
    }
    window.addEventListener(DEMO_BLOCKED_EVENT, handleDemoBlocked);
    return () =>
      window.removeEventListener(DEMO_BLOCKED_EVENT, handleDemoBlocked);
  }, []);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {/* Short viewports (landscape phones) scroll rather than clip the CTAs. */}
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-500">
            <Lock />
          </AlertDialogMedia>
          <AlertDialogTitle>{t("demo.blockedTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("demo.blockedDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <DemoUpgradeOptions />
        <DemoUpgradeFootnote />
        <AlertDialogFooter>
          <AlertDialogAction variant="outline" onClick={() => setOpen(false)}>
            {t("demo.keepExploring")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
