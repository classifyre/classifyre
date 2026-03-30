import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const HASH_DELIMITER = "_#_";

/**
 * Hash a string to base64 (URL safe) with a source type prefix.
 */
export function hashId(sourceType: string, rawId: string): string {
  const finalRawId = `${sourceType}${HASH_DELIMITER}${rawId}`;
  return btoa(finalRawId)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Unhash a base64 string (URL safe).
 */
export function unhashId(hashedId: string): string {
  let base64 = hashedId.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return atob(base64);
}
