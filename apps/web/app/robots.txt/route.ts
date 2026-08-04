import { renderRobots, resolveBaseUrl } from "@/lib/sitemap-config";
import { ROBOTS_CACHE_CONTROL } from "@/lib/sitemap-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * robots.txt, resolved per request so the advertised `Sitemap:` URL matches
 * whatever hostname the crawler actually used.
 *
 * Crawling is invited only when `SITEMAP_ENABLED=true`; otherwise this serves
 * a blanket `Disallow: /`, which is the right default for the private
 * deployments that make up most Classifyre installs.
 */
export function GET(request: Request): Response {
  const body = renderRobots(resolveBaseUrl(request.headers));

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": ROBOTS_CACHE_CONTROL,
    },
  });
}
