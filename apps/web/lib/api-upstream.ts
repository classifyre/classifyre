/**
 * Resolving the API base URL for *server-side* reads (sitemap generation, SEO
 * entity lookups).
 *
 * Deliberately not `@workspace/api-client`: that client resolves the active
 * namespace from module state meant for the browser, which is shared by every
 * in-flight request during server rendering. Plain `fetch` against
 * `<base>/<namespace>/…` is the same URL contract the CLI and MCP use.
 */

export function normalizeAbsoluteUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/\/+$/, "") : null;
}

/**
 * Upstream candidates, in the same order and with the same fallbacks as the
 * `/api` proxy route — `NEXT_PUBLIC_API_URL` is usually the relative `/api`
 * path and is therefore skipped unless it is absolute.
 */
export function apiBaseUrls(): string[] {
  const candidates = [
    normalizeAbsoluteUrl(process.env.INTERNAL_API_URL),
    normalizeAbsoluteUrl(process.env.API_URL),
    normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_API_URL),
    "http://127.0.0.1:8811",
  ];
  return [...new Set(candidates.filter((c): c is string => c !== null))];
}
