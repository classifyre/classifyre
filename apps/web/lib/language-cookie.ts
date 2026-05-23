import type { LanguageSetting } from "./locale-detection";

const COOKIE_NAME = "classifyre-language";
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const VALID_VALUES = new Set<string>(["AUTOMATIC", "ENGLISH", "GERMAN"]);

/**
 * Read the per-user language override from cookie.
 * Returns null when no override has been set (use instance default).
 */
export function getLanguageOverride(): LanguageSetting | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const value = match.split("=")[1];
  if (value && VALID_VALUES.has(value)) return value as LanguageSetting;
  return null;
}

/**
 * Persist a per-user language override. This does NOT call the API —
 * it only affects the current browser.
 */
export function setLanguageOverride(setting: LanguageSetting): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=${setting}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}

/**
 * Remove the per-user override so the instance default takes effect again.
 */
export function clearLanguageOverride(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
}
