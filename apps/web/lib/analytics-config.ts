/**
 * Browser-facing analytics configuration.
 *
 * The web image is built once in CI and configured per-deployment by Helm, so
 * `NEXT_PUBLIC_*` variables are NOT usable here: Next.js inlines those into the
 * client bundle at build time, and anything Helm sets afterwards is invisible to
 * the browser. Instead the server serves the config at {@link ANALYTICS_CONFIG_PATH}
 * (see `app/classifyre-cfg/route.ts`), which assigns it to
 * {@link ANALYTICS_CONFIG_GLOBAL} before React hydrates.
 *
 * Desktop builds are a static export with no server, so they fall back to the
 * build-time `NEXT_PUBLIC_*` values, which do work in that mode.
 */

import { privacyPolicyUrl } from "@workspace/ui/lib/site-links";

/** Fallback policy link: the one published on the marketing site. */
export const DEFAULT_COOKIE_POLICY_URL = privacyPolicyUrl;

export interface PostHogRuntimeConfig {
  token: string;
  apiHost: string;
  uiHost: string;
}

export interface GoogleAnalyticsRuntimeConfig {
  measurementId: string;
}

/**
 * Cookie-banner settings, resolved per-deployment by Helm
 * (`frontend.cookieConsent`).
 *
 * Off by default: a Classifyre instance is normally a private, internal tool
 * behind SSO where a public-website consent bar is noise. It is turned on for
 * deliberately public deployments (the demo instance — see values-vps.yaml),
 * which are the ones an EU visitor can reach without a contract.
 */
export interface CookieConsentRuntimeConfig {
  enabled: boolean;
  /** Where the banner's policy link points. */
  policyUrl: string;
}

export interface AnalyticsRuntimeConfig {
  posthog: PostHogRuntimeConfig | null;
  googleAnalytics: GoogleAnalyticsRuntimeConfig | null;
  cookieConsent: CookieConsentRuntimeConfig;
}

/** Global the runtime config script assigns to. */
export const ANALYTICS_CONFIG_GLOBAL = "__CLASSIFYRE_ANALYTICS__";

/**
 * Path of the runtime config script. Deliberately neutral — paths containing
 * `analytics`, `tracking` or `gtag` are targeted by ad-blocker filter lists.
 * Matches the naming of the existing `/classifyre-usr` PostHog proxy.
 */
export const ANALYTICS_CONFIG_PATH = "/classifyre-cfg/";

/** GA4 measurement IDs look like `G-XXXXXXXXXX`. */
export const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;

declare global {
  interface Window {
    [ANALYTICS_CONFIG_GLOBAL]?: AnalyticsRuntimeConfig;
  }
}

/**
 * Reads the PostHog config injected by the server, falling back to build-time
 * env vars for desktop/static builds and local development.
 */
export function readPostHogRuntimeConfig(): PostHogRuntimeConfig | null {
  if (typeof window !== "undefined") {
    const injected = window[ANALYTICS_CONFIG_GLOBAL]?.posthog;
    if (injected?.token) {
      return injected;
    }
  }

  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) {
    return null;
  }

  return {
    token,
    apiHost: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "/classifyre-usr",
    uiHost: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST ?? "https://us.posthog.com",
  };
}

/** GA config injected by the server. Never falls back to build-time env vars:
 * gtag is bootstrapped by the runtime config script when consent is off, and
 * by `components/google-analytics.tsx` when it is on. */
export function readGoogleAnalyticsRuntimeConfig(): GoogleAnalyticsRuntimeConfig | null {
  if (typeof window === "undefined") return null;
  return window[ANALYTICS_CONFIG_GLOBAL]?.googleAnalytics ?? null;
}

/**
 * Cookie-banner settings for this deployment.
 *
 * Disabled whenever the server did not say otherwise — which covers the
 * desktop build (a static export with no config script, and no analytics to
 * consent to) and any chart install that left `frontend.cookieConsent.enabled`
 * at its default.
 */
export function readCookieConsentRuntimeConfig(): CookieConsentRuntimeConfig {
  if (typeof window === "undefined") {
    return { enabled: false, policyUrl: DEFAULT_COOKIE_POLICY_URL };
  }

  const injected = window[ANALYTICS_CONFIG_GLOBAL]?.cookieConsent;
  return {
    enabled: injected?.enabled === true,
    policyUrl: injected?.policyUrl || DEFAULT_COOKIE_POLICY_URL,
  };
}
