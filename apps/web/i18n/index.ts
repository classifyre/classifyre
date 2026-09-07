import enTranslations from "./en";
import deTranslations from "./de";
import { localeToLanguage, type Locale } from "@/lib/locale-detection";

type Translations = typeof enTranslations;

const translationMap: Record<string, Translations> = {
  ENGLISH: enTranslations,
  GERMAN: deTranslations,
};

export function getTranslationsForLanguage(language: string): Translations {
  return translationMap[language] ?? enTranslations;
}

/** Translations for a URL locale segment (`"en"` / `"de"`). */
export function getTranslationsForLocale(locale: Locale): Translations {
  return getTranslationsForLanguage(localeToLanguage(locale));
}

/**
 * Translate a key in a route locale. This is what server components (every
 * `generateMetadata`) use, so no metadata file has to reach for `@/i18n/en`
 * and hardwire English.
 */
export function translateFor(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  return translate(getTranslationsForLocale(locale), key, params);
}

type PathsOf<T, Prefix extends string = ""> = {
  [K in keyof T]: T[K] extends string
    ? Prefix extends ""
      ? `${K & string}`
      : `${Prefix}.${K & string}`
    : T[K] extends Record<string, unknown>
      ? PathsOf<
          T[K],
          Prefix extends "" ? `${K & string}` : `${Prefix}.${K & string}`
        >
      : never;
}[keyof T];

export type TranslationKey = PathsOf<Translations>;

export function translate(
  translations: Translations,
  key: string,
  params?: Record<string, string | number>,
): string {
  const parts = key.split(".");
  let value: unknown = translations;
  for (const part of parts) {
    if (typeof value === "object" && value !== null) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }

  if (typeof value !== "string") return key;

  if (!params) return value;

  return value.replace(/\{\{(\w+)\}\}/g, (_, paramKey: string) =>
    String(params[paramKey] ?? `{{${paramKey}}}`),
  );
}
