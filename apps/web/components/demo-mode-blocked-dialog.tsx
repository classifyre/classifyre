"use client";

import * as React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
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
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("demo.blockedTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("demo.blockedDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => setOpen(false)}>
            {t("common.close")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
