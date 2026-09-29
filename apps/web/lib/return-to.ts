/**
 * Where an editor returns to when it is done. A page that sends someone off
 * to edit something (a case board opening its watch's query) passes its own
 * address as `?returnTo=`; Cancel, Back and Save come back to it — also in a
 * new tab, where the browser has no history to go back through.
 */
export const RETURN_TO_PARAM = "returnTo";

/** This page's own address (path and query), as a `returnTo` value. */
export function currentAddress(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

/** `path` with `returnTo` set to where we are now (or to `returnTo`). */
export function withReturnTo(path: string, returnTo: string = currentAddress()): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${RETURN_TO_PARAM}=${encodeURIComponent(returnTo)}`;
}

/**
 * A `returnTo` value that is safe to navigate to: an address inside this app
 * (an absolute path), never another origin — the parameter comes from the
 * URL, so anyone can put anything in it.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) return null;
  if (/^\/[^/?#]*:/.test(trimmed) || trimmed.includes("://")) return null;
  return trimmed.length <= 2048 ? trimmed : null;
}
