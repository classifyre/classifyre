import enTranslations from "./en.json";
import deTranslations from "./de.json";
import type { Locale } from "@/lib/locale";

type Translations = typeof enTranslations;

const translationMap: Record<Locale, Translations> = {
  en: enTranslations,
  de: deTranslations,
};

export function getTranslationsForLocale(locale: Locale): Translations {
  return translationMap[locale] ?? enTranslations;
}

/** Docker command notes in order: port, shm, pgdata, data, cache. */
export function getDockerNotes(
  locale: Locale,
): readonly [string, string, string, string, string] {
  const notes = getTranslationsForLocale(locale).docker.notes;
  const fallback = enTranslations.docker.notes;
  return [0, 1, 2, 3, 4].map(
    (index) => notes[index] ?? fallback[index],
  ) as unknown as readonly [string, string, string, string, string];
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

/**
 * Translate a key, falling back to English per-key so partially translated
 * locales render English for missing strings instead of raw keys.
 */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const lookup = (root: unknown): unknown => {
    let value: unknown = root;
    for (const part of key.split(".")) {
      if (typeof value === "object" && value !== null) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return value;
  };

  const raw =
    locale === "en"
      ? lookup(enTranslations)
      : (lookup(translationMap[locale]) ?? lookup(enTranslations));

  if (typeof raw !== "string") return key;
  if (!params) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, paramKey: string) =>
    String(params[paramKey] ?? `{{${paramKey}}}`),
  );
}

function lookupKey(root: unknown, key: string): unknown {
  let value: unknown = root;
  for (const part of key.split(".")) {
    if (typeof value === "object" && value !== null) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return value;
}

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Translate a string-list key (e.g. rotating canvas labels), falling back to
 * English per-key like {@link translate}. Returns an empty list when neither
 * locale has one, so callers can fall back to a built-in default.
 */
export function translateList(locale: Locale, key: string): readonly string[] {
  const raw =
    locale === "en"
      ? lookupKey(enTranslations, key)
      : (lookupKey(translationMap[locale], key) ??
        lookupKey(enTranslations, key));
  return isStringList(raw) ? raw : [];
}
