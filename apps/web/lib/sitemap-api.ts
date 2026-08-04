/**
 * Server-side reads of the data behind the sitemap.
 *
 * Talks to the API directly (in-cluster service URL), not through the browser
 * `/api` proxy, and deliberately does not use `@workspace/api-client`: that
 * client resolves the active namespace from module state meant for the
 * browser, whereas the sitemap routes walk *every* namespace within one
 * request. Plain `fetch` against `<base>/<namespace>/...` is the same URL
 * contract the CLI and MCP use.
 */

import type { SitemapEntityType } from "./sitemap-config";

/** Upstream request budget. A crawler should get a 503, not a hung socket. */
const REQUEST_TIMEOUT_MS = 15_000;

/** How long the sitemap index is reused across requests (seconds). */
const INDEX_REVALIDATE_SECONDS = 300;

export interface SitemapNamespace {
  id: string;
  slug: string;
  type: "local" | "remote";
  updatedAt: string | null;
}

export interface SitemapChunk {
  index: number;
  count: number;
  lastModified: string | null;
}

export interface SitemapSection {
  type: SitemapEntityType;
  total: number;
  lastModified: string | null;
  chunks: SitemapChunk[];
}

export interface SitemapIndex {
  generatedAt: string;
  chunkSize: number;
  sections: SitemapSection[];
}

export interface SitemapEntry {
  id: string;
  lastModified: string | null;
}

function normalizeAbsoluteUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/\/+$/, "") : null;
}

/**
 * Upstream candidates, in the same order and with the same fallbacks as the
 * `/api` proxy route — `NEXT_PUBLIC_API_URL` is usually the relative `/api`
 * path and is therefore skipped unless it is absolute.
 */
function apiBaseUrls(): string[] {
  const candidates = [
    normalizeAbsoluteUrl(process.env.INTERNAL_API_URL),
    normalizeAbsoluteUrl(process.env.API_URL),
    normalizeAbsoluteUrl(process.env.NEXT_PUBLIC_API_URL),
    "http://127.0.0.1:8811",
  ];
  return [...new Set(candidates.filter((c): c is string => c !== null))];
}

async function getJson<T>(
  path: string,
  init?: { revalidateSeconds?: number },
): Promise<T> {
  const errors: string[] = [];

  for (const baseUrl of apiBaseUrls()) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { accept: "application/json" },
        ...(init?.revalidateSeconds
          ? { next: { revalidate: init.revalidateSeconds } }
          : { cache: "no-store" as const }),
      });
      if (!response.ok) {
        errors.push(`${baseUrl}${path} -> HTTP ${response.status}`);
        continue;
      }
      return (await response.json()) as T;
    } catch (error) {
      errors.push(
        `${baseUrl}${path} -> ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  throw new Error(`Sitemap upstream unavailable: ${errors.join("; ")}`);
}

/**
 * Namespaces that have crawlable pages on THIS instance. Remote namespaces are
 * views onto another deployment's data, so their canonical URLs belong to that
 * deployment's sitemap, not ours.
 */
export async function fetchSitemapNamespaces(): Promise<SitemapNamespace[]> {
  const namespaces = await getJson<SitemapNamespace[]>("/namespaces", {
    revalidateSeconds: INDEX_REVALIDATE_SECONDS,
  });
  return namespaces.filter((ns) => ns.type !== "remote" && Boolean(ns.slug));
}

export async function fetchSitemapIndex(
  namespaceSlug: string,
  chunkSize: number,
): Promise<SitemapIndex> {
  return getJson<SitemapIndex>(
    `/${encodeURIComponent(namespaceSlug)}/sitemap?chunkSize=${chunkSize}`,
    { revalidateSeconds: INDEX_REVALIDATE_SECONDS },
  );
}

export async function fetchSitemapEntries(
  namespaceSlug: string,
  type: SitemapEntityType,
  chunk: number,
  chunkSize: number,
): Promise<SitemapEntry[]> {
  // Not revalidated: one chunk can approach the data cache's per-entry size
  // limit, and a crawler reads each child sitemap far less often than the index.
  const payload = await getJson<{ entries: SitemapEntry[] }>(
    `/${encodeURIComponent(namespaceSlug)}/sitemap/entries` +
      `?type=${encodeURIComponent(type)}&chunk=${chunk}&chunkSize=${chunkSize}`,
  );
  return payload.entries ?? [];
}
