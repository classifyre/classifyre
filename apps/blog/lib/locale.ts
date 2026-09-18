/**
 * Locale routing for the blog, mirroring `apps/web/lib/locale-detection.ts`.
 *
 * English is the default locale and is served **unprefixed** (`/sources`);
 * German lives under `/de` (`/de/quellen` → actually `/de/sources`, slugs are
 * not translated, only content). Keeping the default unprefixed means every
 * URL that shipped before locale routing keeps working.
 *
 * Server never redirects: one URL always renders one language, which keeps
 * the canonical/hreflang contract crawlers see deterministic. The client
 * redirect (`components/locale-redirect.tsx`) only ever touches unprefixed
 * URLs — a `/de/…` URL is an explicit language choice and must never switch.
 */

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Cookie storing an explicit language choice. Same name the Nextra theme's
 *  own locale switch uses (`NEXT_LOCALE`), so the two stay compatible. */
export const LOCALE_COOKIE = "NEXT_LOCALE";
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Split a locale prefix off a pathname. `rest` always starts with "/" so it
 * can be concatenated with a prefix without special-casing the root.
 */
export function stripLocalePrefix(pathname: string): {
  locale: Locale;
  rest: string;
} {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (isLocale(first) && first !== DEFAULT_LOCALE) {
    return { locale: first, rest: `/${segments.slice(1).join("/")}` };
  }
  return { locale: DEFAULT_LOCALE, rest: `/${segments.join("/")}` };
}

/**
 * Prefix a blog path with a locale. Idempotent: a path that already carries
 * a locale prefix has it replaced, never doubled.
 */
export function withLocalePrefix(locale: Locale, path: string): string {
  if (!path.startsWith("/")) return path;
  const { rest } = stripLocalePrefix(path);
  const suffix = rest === "/" ? "" : rest;
  return locale === DEFAULT_LOCALE ? suffix || "/" : `/de${suffix}`;
}

/** The same page in the other language. Used by the language switcher. */
export function alternateLocalePath(pathname: string): string {
  const { locale, rest } = stripLocalePrefix(pathname);
  const target: Locale = locale === DEFAULT_LOCALE ? "de" : DEFAULT_LOCALE;
  const switched = withLocalePrefix(target, rest);
  return switched.endsWith("/") ? switched : `${switched}/`;
}

export type ResolvedLanguage = "ENGLISH" | "GERMAN";

export function localeToLanguage(locale: Locale): ResolvedLanguage {
  return locale === "de" ? "GERMAN" : "ENGLISH";
}

export function languageToLocale(language: ResolvedLanguage): Locale {
  return language === "GERMAN" ? "de" : "en";
}

/** Primary subtag of a BCP-47 tag, lowercased (`"de-AT"` → `"de"`). */
export function resolveLocaleTag(tag: string): ResolvedLanguage {
  return (tag.split("-")[0] ?? "").toLowerCase() === "de"
    ? "GERMAN"
    : "ENGLISH";
}

export function detectBrowserLanguage(): ResolvedLanguage {
  if (typeof navigator === "undefined") return "ENGLISH";
  const candidates: readonly string[] =
    navigator.languages?.length > 0
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];
  for (const tag of candidates) {
    if (resolveLocaleTag(tag) !== "ENGLISH") return resolveLocaleTag(tag);
  }
  return "ENGLISH";
}

export function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  const value = match?.slice(LOCALE_COOKIE.length + 1);
  return isLocale(value) ? value : null;
}

export function writeLocaleCookie(locale: Locale): void {
  document.cookie =
    `${LOCALE_COOKIE}=${locale}; max-age=${COOKIE_MAX_AGE_SECONDS}; path=/; SameSite=Lax`;
}

/**
 * Where an automatic language redirect should go, if anywhere.
 *
 * Only the default locale is eligible: an unprefixed URL carries no explicit
 * language choice and may follow the stored cookie, then the browser. A URL
 * that already carries `/de` is an explicit request and never switches.
 *
 * Pure (no `navigator`, no router) so the rule is unit-testable; the client
 * component supplies the resolved language and performs the navigation.
 */
export function autoRedirectTarget(
  pathname: string,
  resolved: ResolvedLanguage,
): string | null {
  const { locale, rest } = stripLocalePrefix(pathname);
  if (locale !== DEFAULT_LOCALE) return null;
  if (resolved === localeToLanguage(DEFAULT_LOCALE)) return null;
  // `next.config.mjs` sets `trailingSlash: true`, so the slash-terminated
  // form is the one that does not redirect again — emit it directly.
  const target = withLocalePrefix(languageToLocale(resolved), rest);
  return target.endsWith("/") ? target : `${target}/`;
}
