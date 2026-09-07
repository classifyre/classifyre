"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import {
  DEFAULT_LOCALE,
  languageToLocale,
  stripLocalePrefix,
  withLocalePrefix,
  type Locale,
  type ResolvedLanguage,
} from "@/lib/locale-detection";

/**
 * The locale of the current route.
 *
 * The URL — not the cookie and not the instance setting — is authoritative
 * once a page is rendering under `app/[locale]/…`, so every link built during
 * that render must inherit it or a click would silently switch language.
 */
export function useLocale(): Locale {
  const pathname = usePathname();
  return React.useMemo(
    () => stripLocalePrefix(pathname ?? "/").locale,
    [pathname],
  );
}

/**
 * Prefix an absolute app path with the current locale. No-ops for the default
 * locale, which is served unprefixed.
 */
export function useLocalePath(): (path: string) => string {
  const locale = useLocale();
  return React.useCallback(
    (path: string) =>
      locale === DEFAULT_LOCALE ? path : withLocalePrefix(locale, path),
    [locale],
  );
}

/**
 * The locale of the browser's current URL, read outside React.
 *
 * **Event handlers only** — during server rendering there is no `window` and
 * this always reports the default locale. Anything evaluated while rendering
 * must use {@link useLocalePath}.
 */
export function currentLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  return stripLocalePrefix(window.location.pathname).locale;
}

/**
 * Where the language switcher navigates: the same page in another language,
 * query string and hash intact.
 *
 * Switching language is a navigation, not just a preference — the URL prefix
 * is what decides `<html lang>` and every server-rendered title — so this is
 * the whole behaviour of the switcher and is unit-tested as such.
 */
export function localeSwitchHref(
  pathname: string,
  language: ResolvedLanguage,
  suffix = "",
): string {
  const { rest } = stripLocalePrefix(pathname || "/");
  return withLocalePrefix(languageToLocale(language), rest) + suffix;
}
