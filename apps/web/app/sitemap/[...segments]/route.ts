import {
  GLOBAL_STATIC_PATHS,
  NAMESPACE_STATIC_PATHS,
  appUrl,
  entityChangeFrequency,
  entityPriority,
  entityUrl,
  isSitemapEnabled,
  parseChildSitemapPath,
  renderUrlSet,
  resolveBaseUrl,
  sitemapChunkSize,
  type ChildSitemapTarget,
  type SitemapUrlEntry,
} from "@/lib/sitemap-config";
import {
  fetchSitemapEntries,
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

type RouteContext = { params: Promise<{ segments?: string[] }> };

/**
 * Child sitemaps referenced by `/sitemap.xml`:
 *
 *   `/sitemap/pages.xml`                    instance-wide pages
 *   `/sitemap/<namespace>/pages.xml`        a workspace's list pages
 *   `/sitemap/<namespace>/<type>-<n>.xml`   one chunk of detail pages
 *
 * A single top-level `sitemap` segment (reserved against namespace slugs) keeps
 * these clear of the `[namespaceSlug]` page tree.
 */
export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  if (!isSitemapEnabled()) return sitemapDisabledResponse();

  const { segments = [] } = await context.params;
  const target = parseChildSitemapPath(segments);
  if (!target) return sitemapDisabledResponse();

  const baseUrl = resolveBaseUrl(request.headers);
  if (!baseUrl) {
    return sitemapUnavailableResponse("Could not resolve the request hostname");
  }

  try {
    const entries = await buildEntries(target, baseUrl);
    if (entries === null) return sitemapDisabledResponse();
    return xmlResponse(renderUrlSet(entries), SITEMAP_CACHE_CONTROL);
  } catch (error) {
    return sitemapUnavailableResponse(
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Entries for the requested child sitemap; null when it does not exist. */
async function buildEntries(
  target: ChildSitemapTarget,
  baseUrl: string,
): Promise<SitemapUrlEntry[] | null> {
  if (target.kind === "global") {
    const namespaces = await fetchSitemapNamespaces();
    const lastModified = namespaces.reduce<string | null>(
      (max, ns) =>
        ns.updatedAt && (max === null || ns.updatedAt > max)
          ? ns.updatedAt
          : max,
      null,
    );
    return GLOBAL_STATIC_PATHS.map((page) => ({
      url: appUrl(baseUrl, null, page.path),
      lastModified,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    }));
  }

  // Every other child sitemap belongs to a namespace: resolve it first so an
  // unknown or remote workspace 404s instead of emitting URLs for pages that
  // this instance does not serve.
  const namespace = await findNamespace(target.namespaceSlug);
  if (!namespace) return null;

  if (target.kind === "static") {
    return NAMESPACE_STATIC_PATHS.map((page) => ({
      url: appUrl(baseUrl, namespace.slug, page.path),
      lastModified: namespace.updatedAt,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    }));
  }

  const entries = await fetchSitemapEntries(
    namespace.slug,
    target.type,
    target.chunk,
    sitemapChunkSize(),
  );
  // A chunk past the end is not an error state, but it is also not a document
  // worth serving — the index no longer references it.
  if (entries.length === 0) return null;

  const changeFrequency = entityChangeFrequency(target.type);
  const priority = entityPriority(target.type);

  return entries.map((entry) => ({
    url: entityUrl(baseUrl, namespace.slug, target.type, entry.id),
    lastModified: entry.lastModified,
    changeFrequency,
    priority,
  }));
}

async function findNamespace(
  slug: string,
): Promise<SitemapNamespace | undefined> {
  const namespaces = await fetchSitemapNamespaces();
  return namespaces.find((ns) => ns.slug === slug);
}
