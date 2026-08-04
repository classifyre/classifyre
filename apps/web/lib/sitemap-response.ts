/**
 * Shared HTTP responses for the sitemap/robots routes.
 *
 * The failure mode matters for SEO: when the data behind a sitemap cannot be
 * read, a crawler must get a 503 (retry later) and never a 200 with a short or
 * empty `<urlset>` — the latter reads as "these URLs no longer exist" and gets
 * them dropped from the index.
 */

/** Sitemaps change with the data, so a modest TTL with a long stale window. */
export const SITEMAP_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

export const ROBOTS_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400";

export function xmlResponse(body: string, cacheControl: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": cacheControl,
      "x-robots-tag": "noindex",
    },
  });
}

/** 404 for every sitemap route when `SITEMAP_ENABLED` is not `true`. */
export function sitemapDisabledResponse(): Response {
  return new Response("Not Found\n", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function sitemapUnavailableResponse(reason: string): Response {
  console.error(`[sitemap] unavailable: ${reason}`);
  return new Response("Service Unavailable\n", {
    status: 503,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "600",
    },
  });
}
