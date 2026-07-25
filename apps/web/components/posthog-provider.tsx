"use client";

import * as React from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

import { readPostHogRuntimeConfig } from "@/lib/analytics-config";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [initialised, setInitialised] = React.useState(false);

  React.useEffect(() => {
    const config = readPostHogRuntimeConfig();
    if (!config) return;

    posthog.init(config.token, {
      api_host: config.apiHost,
      ui_host: config.uiHost,
      defaults: "2026-01-30",
      capture_pageview: true,
      capture_pageleave: true,
      person_profiles: "identified_only",
    });
    setInitialised(true);
  }, []);

  if (!initialised) {
    return <>{children}</>;
  }

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
