// ─── Language ────────────────────────────────────────────────────────

export type ResolvedLanguage = "ENGLISH" | "GERMAN";
export type LanguageSetting = "AUTOMATIC" | ResolvedLanguage;

/**
 * The locales the app is addressable in. These are URL path segments, so they
 * are also reserved namespace slugs — see `RESERVED_WEB_PREFIXES` in
 * `apps/api/src/namespace/namespace.constants.ts` and
 * `RESERVED_ROUTE_PREFIXES` in `packages/api-client/src/client.ts`.
 */
export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * The locale served without a path prefix: `/acme/findings` is English,
 * `/de/acme/findings` is German. Keeping the default unprefixed avoids a
 * redirect on every entry URL that shipped before locale routing existed.
 */
export const DEFAULT_LOCALE: Locale = "en";

/**
 * The single locale ↔ language table. Everything else in this file derives
 * from it, so the URL segment and the render language can never drift.
 */
const LOCALE_LANGUAGE: Record<Locale, ResolvedLanguage> = {
  en: "ENGLISH",
  de: "GERMAN",
};

const LANGUAGE_LOCALE = Object.fromEntries(
  Object.entries(LOCALE_LANGUAGE).map(([locale, language]) => [
    language,
    locale as Locale,
  ]),
) as Record<ResolvedLanguage, Locale>;

/** BCP-47 tags for `<html lang>` and OpenGraph, keyed by locale. */
const LOCALE_HTML_LANG: Record<Locale, string> = { en: "en", de: "de" };
const LOCALE_OPEN_GRAPH: Record<Locale, string> = {
  en: "en_US",
  de: "de_DE",
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}

export function localeToLanguage(locale: Locale): ResolvedLanguage {
  return LOCALE_LANGUAGE[locale];
}

export function languageToLocale(language: ResolvedLanguage): Locale {
  return LANGUAGE_LOCALE[language];
}

export function localeHtmlLang(locale: Locale): string {
  return LOCALE_HTML_LANG[locale];
}

export function localeOpenGraph(locale: Locale): string {
  return LOCALE_OPEN_GRAPH[locale];
}

/**
 * The path prefix a locale contributes — empty for {@link DEFAULT_LOCALE}.
 * This is the one definition of "the default locale is unprefixed"; every
 * URL builder in the app goes through it.
 */
export function localePathPrefix(locale: Locale): string {
  return locale === DEFAULT_LOCALE ? "" : `/${locale}`;
}

/**
 * Split a locale prefix off an app pathname. `rest` always starts with "/"
 * so it can be concatenated with a prefix without special-casing the root.
 *
 * A pathname with no prefix resolves to {@link DEFAULT_LOCALE}, which is what
 * makes `/acme/findings` English rather than ambiguous.
 */
export function stripLocalePrefix(pathname: string): {
  locale: Locale;
  rest: string;
} {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (isLocale(first)) {
    return { locale: first, rest: `/${segments.slice(1).join("/")}` };
  }
  return { locale: DEFAULT_LOCALE, rest: `/${segments.join("/")}` };
}

/**
 * Prefix an app path with a locale. Idempotent: a path that already carries a
 * locale prefix has it replaced, never doubled.
 */
export function withLocalePrefix(locale: Locale, path: string): string {
  if (!path.startsWith("/")) return path;
  const { rest } = stripLocalePrefix(path);
  const prefix = localePathPrefix(locale);
  const suffix = rest === "/" ? "" : rest;
  return `${prefix}${suffix}` || "/";
}

const SUPPORTED_PREFIXES: Record<string, ResolvedLanguage> = Object.fromEntries(
  Object.entries(LOCALE_LANGUAGE).filter(
    ([, language]) => language !== "ENGLISH",
  ),
);

export function resolveLocaleTag(tag: string): ResolvedLanguage {
  const primary = (tag.split("-")[0] ?? "").toLowerCase();
  return SUPPORTED_PREFIXES[primary] ?? "ENGLISH";
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
    const resolved = resolveLocaleTag(tag);
    if (resolved !== "ENGLISH") return resolved;
  }

  return "ENGLISH";
}

export function resolveLanguage(setting: LanguageSetting): ResolvedLanguage {
  if (setting === "AUTOMATIC") return detectBrowserLanguage();
  return setting;
}

// ─── Time Format ─────────────────────────────────────────────────────

export type ResolvedTimeFormat = "TWELVE_HOUR" | "TWENTY_FOUR_HOUR";
export type TimeFormatSetting = "AUTOMATIC" | ResolvedTimeFormat;

/**
 * Detect whether the browser locale uses 12-hour or 24-hour time.
 * Uses Intl.DateTimeFormat to format a reference time and checks for AM/PM markers.
 */
export function detectBrowserTimeFormat(): ResolvedTimeFormat {
  if (typeof Intl === "undefined") return "TWELVE_HOUR";

  try {
    const locale =
      typeof navigator !== "undefined"
        ? navigator.language || "en-US"
        : "en-US";

    const formatted = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
    }).resolvedOptions();

    return formatted.hourCycle === "h23" || formatted.hourCycle === "h24"
      ? "TWENTY_FOUR_HOUR"
      : "TWELVE_HOUR";
  } catch {
    return "TWELVE_HOUR";
  }
}

export function resolveTimeFormat(
  setting: TimeFormatSetting,
): ResolvedTimeFormat {
  if (setting === "AUTOMATIC") return detectBrowserTimeFormat();
  return setting;
}

// ─── Timezone ────────────────────────────────────────────────────────

export const AUTOMATIC_TIMEZONE = "AUTOMATIC";

/**
 * Detect the browser's IANA timezone (e.g. "Europe/Berlin", "America/New_York").
 * Falls back to "UTC" on SSR or error.
 */
export function detectBrowserTimezone(): string {
  if (typeof Intl === "undefined") return "UTC";

  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}

export function resolveTimezone(setting: string): string {
  if (setting === AUTOMATIC_TIMEZONE) return detectBrowserTimezone();
  return setting;
}
