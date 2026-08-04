"use client";

import * as React from "react";

import { CookieConsentBanner } from "@workspace/ui/components";

import { GoogleAnalytics } from "@/components/google-analytics";
import { readCookieConsentRuntimeConfig } from "@/lib/analytics-config";
import { isDesktopShell } from "@/lib/desktop";
import { useTranslation } from "@/hooks/use-translation";

/**
 * Cookie consent for the app, switched on per-deployment by Helm
 * (`frontend.cookieConsent.enabled`) and off everywhere else.
 *
 * Three states, in order of precedence:
 *
 * 1. **Desktop** — never. The Electron build is a static export that ships no
 *    analytics at all, so there is nothing to consent to and the config script
 *    it would read does not exist.
 * 2. **Banner off** (chart default) — the banner never renders, and gtag keeps
 *    bootstrapping from the runtime config script exactly as before. Private
 *    instances behind SSO are unaffected by this feature.
 * 3. **Banner on** (public deployments, e.g. the demo) — nothing analytics-
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
    // tag, and the desktop check needs `window`.
    if (isDesktopShell()) return;
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
