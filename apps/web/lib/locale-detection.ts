// ─── Language ────────────────────────────────────────────────────────

export type ResolvedLanguage = "ENGLISH" | "GERMAN";
export type LanguageSetting = "AUTOMATIC" | ResolvedLanguage;

const SUPPORTED_PREFIXES: Record<string, ResolvedLanguage> = {
  de: "GERMAN",
};

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
