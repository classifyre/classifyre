"use client";

import * as React from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

import { useAnalyticsConsent } from "@workspace/ui/hooks/use-analytics-consent";

import {
  readCookieConsentRuntimeConfig,
  readPostHogRuntimeConfig,
} from "@/lib/analytics-config";

/**
 * PostHog, gated on cookie consent when the deployment asks for a banner.
 *
 * `posthog.init` is what sets the distinct-id cookie, so on a consent-enabled
 * deployment it must not run until an EEA/UK/CH visitor has accepted. Where the
 * banner is off (the chart default — private instances), behaviour is unchanged
 * and the SDK initialises as soon as a token is configured.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const consentAllowsAnalytics = useAnalyticsConsent();
  const [consentRequired, setConsentRequired] = React.useState<boolean | null>(
    null,
  );
  const [initialised, setInitialised] = React.useState(false);

  React.useEffect(() => {
    setConsentRequired(readCookieConsentRuntimeConfig().enabled);
  }, []);

  const allowed = consentRequired === false || consentAllowsAnalytics;

  React.useEffect(() => {
    // Wait until we know whether this deployment gates analytics at all.
    if (consentRequired === null) return;

    const config = readPostHogRuntimeConfig();
    if (!config) return;

    if (!allowed) {
      if (initialised) {
        posthog.opt_out_capturing();
        posthog.reset();
      }
      return;
    }

    if (!initialised) {
      posthog.init(config.token, {
        api_host: config.apiHost,
        ui_host: config.uiHost,
        defaults: "2026-01-30",
        capture_pageview: true,
        capture_pageleave: true,
        person_profiles: "identified_only",
      });
      setInitialised(true);
      return;
    }

    // Re-granted after a decline: the SDK is loaded, just opted out.
    posthog.opt_in_capturing();
  }, [allowed, consentRequired, initialised]);

  if (!initialised) {
    return <>{children}</>;
  }

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
