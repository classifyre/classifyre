import type { ResolvedLanguage } from "./locale-detection";

const COOKIE_NAME = "classifyre-language";
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function getLanguageCookie(): ResolvedLanguage | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const value = match.split("=")[1];
  if (value === "ENGLISH" || value === "GERMAN") return value;
  return null;
}

export function setLanguageCookie(resolved: ResolvedLanguage): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=${resolved}; path=/; max-age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}
