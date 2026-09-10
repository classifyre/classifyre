"use client";

import * as React from "react";

import { CookieConsentBanner } from "@workspace/ui/components";

import { GoogleAnalytics } from "@/components/google-analytics";
import { readCookieConsentRuntimeConfig } from "@/lib/analytics-config";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Cookie consent for the app, switched on per-deployment by Helm
 * (`frontend.cookieConsent.enabled`) and off everywhere else.
 *
 * Two states:
 *
 * 1. **Banner off** (chart default, and the all-in-one image) — the banner
 *    never renders, and gtag keeps bootstrapping from the runtime config
 *    script exactly as before. Private instances behind SSO are unaffected.
 * 2. **Banner on** (public deployments, e.g. the demo) — nothing analytics-
 *    related loads for an EEA/UK/CH visitor until they accept, and the
 *    consent-gated GA loader takes over from the inline bootstrap.
 */
export function CookieConsent() {
  const { t } = useTranslation();
  const [config, setConfig] = React.useState<{
    enabled: boolean;
    policyUrl: string;
  } | null>(null);

  React.useEffect(() => {
    // Read after mount: the config global is assigned by a same-origin script
    // tag, which has not run at render time.
    setConfig(readCookieConsentRuntimeConfig());
  }, []);

  if (!config?.enabled) {
    return null;
  }

  return (
    <>
      <GoogleAnalytics />
      <CookieConsentBanner
        policyHref={config.policyUrl}
        copy={{
          message: t("cookieConsent.message"),
          policyLabel: t("cookieConsent.policyLabel"),
          accept: t("cookieConsent.accept"),
          decline: t("cookieConsent.decline"),
          regionLabel: t("cookieConsent.label"),
          ariaLabel: t("cookieConsent.ariaLabel"),
        }}
      />
    </>
  );
}
