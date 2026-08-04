import {
  ANALYTICS_CONFIG_GLOBAL,
  DEFAULT_COOKIE_POLICY_URL,
  GA_MEASUREMENT_ID_PATTERN,
  type AnalyticsRuntimeConfig,
} from "@/lib/analytics-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reads an env var without letting Next.js inline it at build time.
 *
 * `process.env.FOO` is statically replaced during the build; the web image is
 * built in CI long before Helm supplies these values, so a static read would
 * bake in `undefined`. Indexed access is left alone by the bundler and resolves
 * against the real process environment at request time.
 */
function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function buildConfig(): AnalyticsRuntimeConfig {
  const posthogToken = readEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN");
  const measurementId = readEnv("GOOGLE_ANALYTICS_MEASUREMENT_ID");

  return {
    posthog: posthogToken
      ? {
          token: posthogToken,
          apiHost: readEnv("NEXT_PUBLIC_POSTHOG_HOST") ?? "/classifyre-usr",
          uiHost:
            readEnv("NEXT_PUBLIC_POSTHOG_UI_HOST") ?? "https://us.posthog.com",
        }
      : null,
    googleAnalytics:
      measurementId && GA_MEASUREMENT_ID_PATTERN.test(measurementId)
        ? { measurementId }
        : null,
    cookieConsent: {
      enabled: readEnv("COOKIE_CONSENT_ENABLED") === "true",
      policyUrl:
        readEnv("COOKIE_CONSENT_POLICY_URL") ?? DEFAULT_COOKIE_POLICY_URL,
    },
  };
}

/**
 * Standard gtag.js bootstrap. Runs as a classic script, so `gtag` is a genuine
 * global — same as pasting Google's snippet into the page head.
 *
 * The measurement ID is validated against {@link GA_MEASUREMENT_ID_PATTERN}
 * before it reaches this template, so it cannot break out of the string literal.
 */
function renderGoogleAnalytics(measurementId: string): string {
  return `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${measurementId}');
(function(){
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=${measurementId}';
  document.head.appendChild(s);
})();
`.trim();
}

export function GET(): Response {
  const config = buildConfig();

  const lines = [
    `window.${ANALYTICS_CONFIG_GLOBAL} = ${JSON.stringify(config)};`,
  ];

  // With the consent banner on, gtag must not bootstrap here: this script runs
  // before hydration, which is exactly what "before consent" means. The client
  // component in `components/google-analytics.tsx` loads it instead, once the
  // visitor has accepted. With the banner off (private instances), the inline
  // bootstrap is kept — it is one fewer round trip and nothing is gated.
  if (config.googleAnalytics && !config.cookieConsent.enabled) {
    lines.push(renderGoogleAnalytics(config.googleAnalytics.measurementId));
  }

  return new Response(`${lines.join("\n")}\n`, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}
