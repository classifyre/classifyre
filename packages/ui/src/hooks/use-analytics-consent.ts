"use client";

import * as React from "react";

import {
  isAnalyticsAllowed,
  subscribeToCookieConsent,
} from "../lib/cookie-consent";

/**
 * Whether analytics may run, tracked reactively so a decision takes effect
 * without a reload.
 *
 * Always `false` on the server and on the first client render: the answer
 * depends on `document.cookie` and the browser time zone, and returning the
 * real value straight away would make the markup differ between the two and
 * break hydration. Analytics initialising one tick late is not a problem —
 * initialising before consent is.
 */
export function useAnalyticsConsent(): boolean {
  const [allowed, setAllowed] = React.useState(false);

  React.useEffect(() => {
    const sync = () => setAllowed(isAnalyticsAllowed());
    sync();
    return subscribeToCookieConsent(sync);
  }, []);

  return allowed;
}
