/*
 * Stands in for apps/web/hooks/use-translation.ts, which reads the language
 * from the instance settings the API serves. A video has no API; it speaks
 * English, out of the app's own dictionary, so the words on screen are the
 * words in the product.
 */
interface WebI18n {
  getTranslationsForLanguage: (language: string) => unknown;
  translate: (
    translations: unknown,
    key: string,
    params?: Record<string, string | number>,
  ) => string;
}

const i18n = require.context("../../../web/i18n", false, /index\.ts$/);
const { getTranslationsForLanguage, translate } = i18n<WebI18n>("./index.ts");
const english = getTranslationsForLanguage("ENGLISH");

function t(key: string, params?: Record<string, string | number>): string {
  return translate(english, key, params);
}

export function useTranslation() {
  return { t };
}

/** The app's English wording for a key, for the chrome a video draws round a borrowed component. */
export const webText = t;
