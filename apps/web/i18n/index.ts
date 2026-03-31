import enTranslations from "./en.json";
import deTranslations from "./de.json";

type Translations = typeof enTranslations;

const translationMap: Record<string, Translations> = {
  ENGLISH: enTranslations,
  GERMAN: deTranslations,
};

export function getTranslationsForLanguage(language: string): Translations {
  return translationMap[language] ?? enTranslations;
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
