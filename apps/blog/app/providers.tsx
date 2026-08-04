"use client";

import * as React from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

import { useAnalyticsConsent } from "@workspace/ui/hooks/use-analytics-consent";

const POSTHOG_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
const POSTHOG_UI_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_UI_HOST ?? "https://us.posthog.com";

/**
 * PostHog, gated on cookie consent: `posthog.init` is what sets the
 * distinct-id cookie, so it must not run before the visitor has accepted where
 * consent is required. Withdrawing consent opts the SDK out and clears its
 * identity, which is the closest the SDK gets to un-initialising.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const allowed = useAnalyticsConsent();
  const [initialised, setInitialised] = React.useState(false);

  React.useEffect(() => {
    if (!POSTHOG_TOKEN) return;

    if (!allowed) {
      if (initialised) {
        posthog.opt_out_capturing();
        posthog.reset();
      }
      return;
    }

    if (!initialised) {
      posthog.init(POSTHOG_TOKEN, {
        api_host: POSTHOG_HOST,
        ui_host: POSTHOG_UI_HOST,
        defaults: "2026-01-30",
        capture_pageview: true,
        capture_pageleave: true,
        person_profiles: "identified_only",
      });
      setInitialised(true);
      return;
    }

    // Re-granted after a decline: the SDK is still loaded, just opted out.
    posthog.opt_in_capturing();
  }, [allowed, initialised]);

  if (!POSTHOG_TOKEN || !initialised) {
    return <>{children}</>;
  }

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
