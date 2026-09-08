"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

import { useInstanceSettings } from "@/components/instance-settings-provider";
import { getLanguageOverride } from "@/lib/language-cookie";
import {
  DEFAULT_LOCALE,
  isLocale,
  languageToLocale,
  resolveLanguage,
  withLocalePrefix,
} from "@/lib/locale-detection";

/**
 * The static export has no rewrites to route between the locale trees, so the
 * cookie stays the only language control there and this must not fire.
 */
const isDesktopBuild = process.env.NEXT_PUBLIC_DESKTOP_BUILD === "true";

/**
 * Sends a visitor to their language the first time they arrive on an
 * unprefixed URL.
 *
 * The URL is what decides the rendered language, which means an `AUTOMATIC`
 * instance would otherwise serve English forever to a German browser: nothing
 * in the request ever put `/de` in front. This closes that gap on the client,
 * which is the only place it can be closed — `output: "export"` rejects
 * middleware, and reading `Accept-Language` on the server would make every
 * page vary by header.
 *
 * It deliberately fires **only** on a path with no locale prefix:
 *
 *  - `/de/…` is already an explicit choice.
 *  - `/…` after the switcher wrote `ENGLISH` is also explicit — the cookie is
 *    read here precisely so a user who chose English is not bounced back to
 *    German by their browser's settings on the next page load.
 *
 * Crawlers are unaffected: this runs after hydration, so the unprefixed URL
 * still serves English with `hreflang` alternates pointing at both locales,
 * which is what Google asks for. Language redirects are a ranking hazard when
 * they are server-side and unconditional; this is neither.
 */
export function LocaleRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const { settings, loading } = useInstanceSettings();
  // One attempt per mount. Without this the effect can re-enter between the
  // `router.replace` call and the new pathname landing.
  const attempted = React.useRef(false);

  React.useEffect(() => {
    if (isDesktopBuild || attempted.current) return;
    // Instance settings decide the fallback when there is no cookie; acting
    // before they land would use AUTOMATIC for an instance pinned to English.
    if (loading) return;

    const current = pathname ?? "/";
    const first = current.split("/").filter(Boolean)[0];
    // An explicit locale in the URL is the user's choice; leave it.
    if (isLocale(first)) {
      attempted.current = true;
      return;
    }

    attempted.current = true;

    const setting = getLanguageOverride() ?? settings.language;
    const target = languageToLocale(
      resolveLanguage(setting as Parameters<typeof resolveLanguage>[0]),
    );
    if (target === DEFAULT_LOCALE) return;

    const suffix = window.location.search + window.location.hash;
    router.replace(withLocalePrefix(target, current) + suffix);
  }, [loading, pathname, router, settings.language]);

  return null;
}
