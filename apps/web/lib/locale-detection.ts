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
