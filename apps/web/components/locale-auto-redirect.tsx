"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

import { useInstanceSettings } from "./instance-settings-provider";
import {
  autoRedirectTarget,
  resolveLanguage,
} from "@/lib/locale-detection";

/**
 * Automatic language redirect for prefix-less entry URLs.
 *
 * A URL without a locale prefix carries no explicit language choice, so on
 * first render it follows the same precedence the rest of the app uses: the
 * per-user cookie override, then the instance setting, then (`AUTOMATIC`) the
 * browser language. When that resolves to a non-default language the same
 * page is re-requested under its prefix (`/de/…`), where the server already
 * renders the translated title, description and `<html lang>`.
 *
 * A URL that already carries a prefix is an explicit request and is never
 * touched — see `autoRedirectTarget`, which pins that rule in a unit test.
 * The server never redirects either, so crawlers always see one language per
 * URL and the canonical/hreflang contract stays deterministic.
 */
export function LocaleAutoRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const { effectiveLanguageSetting, loading } = useInstanceSettings();

  React.useEffect(() => {
    // Wait for the instance setting: redirecting on the AUTOMATIC default
    // while a fixed instance language is still loading would bounce a user
    // to `/de/` whom the instance would keep in English (and vice versa).
    // The directory (no namespace in the route) resolves loading immediately.
    if (loading || !pathname) return;

    const target = autoRedirectTarget(
      pathname,
      resolveLanguage(effectiveLanguageSetting),
    );
    if (!target) return;

    // Query and hash are not part of `pathname`; carry them over so a shared
    // filtered view stays filtered after the language hop.
    const suffix =
      typeof window === "undefined"
        ? ""
        : window.location.search + window.location.hash;
    router.replace(`${target}${suffix}`);
  }, [pathname, effectiveLanguageSetting, loading, router]);

  return null;
}
