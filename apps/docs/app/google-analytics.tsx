"use client";

import * as React from "react";
import Script from "next/script";

import { useAnalyticsConsent } from "@workspace/ui/hooks/use-analytics-consent";
import { disableGoogleAnalytics } from "@workspace/ui/lib/cookie-consent";

/**
 * Google Analytics (gtag.js), gated on cookie consent.
 *
 * This site is a static export, so the measurement ID is baked in at build time
 * from `NEXT_PUBLIC_GA_MEASUREMENT_ID`. Leave it unset to disable analytics —
 * nothing is then requested from googletagmanager.com.
 *
 * The scripts render only once {@link useAnalyticsConsent} says yes, so in the
 * EEA/UK/CH nothing reaches Google before the visitor accepts. If consent is
 * later withdrawn the tags are already in the document, so we also flip
 * Google's own `ga-disable-<id>` kill switch and drop the `_ga*` cookies.
 */
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

export function GoogleAnalytics() {
  const allowed = useAnalyticsConsent();
  const wasAllowed = React.useRef(false);

  React.useEffect(() => {
    if (!GA_MEASUREMENT_ID) return;
    if (allowed) {
      wasAllowed.current = true;
      return;
    }
    if (wasAllowed.current) {
      disableGoogleAnalytics(GA_MEASUREMENT_ID);
      wasAllowed.current = false;
    }
  }, [allowed]);

  if (!GA_MEASUREMENT_ID || !allowed) {
    return null;
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');`}
      </Script>
    </>
  );
}
