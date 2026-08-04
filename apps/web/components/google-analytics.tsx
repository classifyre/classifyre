"use client";

import * as React from "react";
import Script from "next/script";

import { useAnalyticsConsent } from "@workspace/ui/hooks/use-analytics-consent";
import { disableGoogleAnalytics } from "@workspace/ui/lib/cookie-consent";

import { readGoogleAnalyticsRuntimeConfig } from "@/lib/analytics-config";

/**
 * Consent-gated gtag.js loader.
 *
 * Only used when the deployment turns the cookie banner on. Without the banner
 * the runtime config script bootstraps gtag itself before hydration (see
 * `app/classifyre-cfg/route.ts`) and this component renders nothing, so the two
 * paths can never both load it.
 *
 * The measurement ID comes from the same injected config, so switching it is
 * still a `helm upgrade` rather than an image rebuild.
 */
export function GoogleAnalytics() {
  const allowed = useAnalyticsConsent();
  const [measurementId, setMeasurementId] = React.useState<string | null>(null);
  const wasAllowed = React.useRef(false);

  React.useEffect(() => {
    setMeasurementId(readGoogleAnalyticsRuntimeConfig()?.measurementId ?? null);
  }, []);

  React.useEffect(() => {
    if (!measurementId) return;
    if (allowed) {
      wasAllowed.current = true;
      return;
    }
    // Consent withdrawn after the tag had loaded: flip Google's documented
    // kill switch and drop the cookies it already set.
    if (wasAllowed.current) {
      disableGoogleAnalytics(measurementId);
      wasAllowed.current = false;
    }
  }, [allowed, measurementId]);

  if (!measurementId || !allowed) {
    return null;
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${measurementId}');`}
      </Script>
    </>
  );
}
