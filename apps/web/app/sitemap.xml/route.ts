import {
  STATIC_SITEMAP_FILE,
  childSitemapUrl,
  entitySitemapFile,
  isSitemapEnabled,
  renderSitemapIndex,
  resolveBaseUrl,
  sitemapChunkSize,
  type SitemapIndexEntry,
} from "@/lib/sitemap-config";
import {
  fetchSitemapIndex,
  fetchSitemapNamespaces,
  type SitemapNamespace,
} from "@/lib/sitemap-api";
import {
  SITEMAP_CACHE_CONTROL,
  sitemapDisabledResponse,
  sitemapUnavailableResponse,
  xmlResponse,
} from "@/lib/sitemap-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sitemap index (`/sitemap.xml`).
 *
 * Fans out to one child sitemap per namespace section chunk, so a workspace
 * with a million findings stays inside the 50 000-URL-per-file protocol limit
 * and crawlers can tell from `<lastmod>` alone which chunks changed since the
 * last visit.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isSitemapEnabled()) return sitemapDisabledResponse();

  const baseUrl = resolveBaseUrl(request.headers);
  if (!baseUrl) {
    return sitemapUnavailableResponse("Could not resolve the request hostname");
  }

  const chunkSize = sitemapChunkSize();

  let namespaces: SitemapNamespace[];
  try {
    namespaces = await fetchSitemapNamespaces();
  } catch (error) {
    return sitemapUnavailableResponse(errorMessage(error));
  }

  const entries: SitemapIndexEntry[] = [
    {
      url: childSitemapUrl(baseUrl, null, STATIC_SITEMAP_FILE),
      lastModified: newest(namespaces.map((ns) => ns.updatedAt)),
    },
  ];

  const indexes = await Promise.allSettled(
    namespaces.map((ns) => fetchSitemapIndex(ns.slug, chunkSize)),
  );

  for (const [position, namespace] of namespaces.entries()) {
    const result = indexes[position];
    if (result?.status !== "fulfilled") {
      // One unreachable workspace must not blank out the whole index: serve
      // 503 so the crawler retries instead of concluding the URLs are gone.
      return sitemapUnavailableResponse(
        `namespace '${namespace.slug}': ${errorMessage(
          result?.status === "rejected" ? result.reason : undefined,
        )}`,
      );
    }

    const sections = result.value.sections ?? [];
    entries.push({
      url: childSitemapUrl(baseUrl, namespace.slug, STATIC_SITEMAP_FILE),
      lastModified:
        newest([
          ...sections.map((section) => section.lastModified),
          namespace.updatedAt,
        ]) ?? null,
    });

    for (const section of sections) {
      for (const chunk of section.chunks ?? []) {
        entries.push({
          url: childSitemapUrl(
            baseUrl,
            namespace.slug,
            entitySitemapFile(section.type, chunk.index),
          ),
          lastModified: chunk.lastModified,
        });
      }
    }
  }

  return xmlResponse(renderSitemapIndex(entries), SITEMAP_CACHE_CONTROL);
}

function newest(values: (string | null | undefined)[]): string | null {
  return values.reduce<string | null>(
    (max, value) => (value && (max === null || value > max) ? value : max),
    null,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown");
}
