import { isLocale, type Locale } from "@/lib/locale-detection";

const COOKIE_LANGUAGES: Record<string, Locale> = {
  ENGLISH: "en",
  GERMAN: "de",
};

/**
 * The language the sign-in pages should open in: the one of the page the
 * person came from (its `/de/…` prefix), else the one they chose in the app
 * (the `classifyre-language` cookie). Null leaves it to the identity server,
 * which follows the browser's languages.
 */
export function signInLocale(
  returnTo: string,
  languageCookie?: string,
): Locale | null {
  const first = returnTo.split(/[/?#]/).filter(Boolean)[0];
  if (isLocale(first)) return first;
  return (languageCookie && COOKIE_LANGUAGES[languageCookie]) || null;
}
