/**
 * Sitemap/robots configuration and rendering. Server-side only — every reader
 * is a route handler.
 *
 * The sitemap is **off by default**: a Classifyre instance is usually private
 * (and the desktop app has no server at all), so it is opt-in per deployment
 * via `SITEMAP_ENABLED` (Helm: `frontend.sitemap.enabled`). When it is off the
 * sitemap routes 404 and robots.txt disallows everything.
 *
 * URL shapes live here and nowhere else. They must match the App Router tree
 * under `apps/web/app/[namespaceSlug]/(dashboard)` and the entity registry in
 * `apps/api/src/sitemap/sitemap.entities.ts`.
 */

/** Entity kinds with a detail page. Mirrors the API's `SitemapEntityType`. */
export const SITEMAP_ENTITY_TYPES = [
  "source",
  "asset",
  "finding",
  "case",
  "inquiry",
  "detector",
  "scan",
] as const;

export type SitemapEntityType = (typeof SITEMAP_ENTITY_TYPES)[number];

export type ChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

interface EntitySitemapConfig {
  /** Detail path relative to the namespace root, without a trailing slash. */
  path: (id: string) => string;
  changeFrequency: ChangeFrequency;
  priority: number;
}

const ENTITY_CONFIG: Record<SitemapEntityType, EntitySitemapConfig> = {
  source: {
    path: (id) => `/sources/${encodeURIComponent(id)}`,
    changeFrequency: "daily",
    priority: 0.7,
  },
  asset: {
    path: (id) => `/assets/${encodeURIComponent(id)}`,
    changeFrequency: "weekly",
    priority: 0.5,
  },
  finding: {
    path: (id) => `/findings/${encodeURIComponent(id)}`,
    changeFrequency: "weekly",
    priority: 0.6,
  },
  // Cases are the investigations detail route; inquiries sit one level deeper.
  case: {
    path: (id) => `/investigations/${encodeURIComponent(id)}`,
    changeFrequency: "weekly",
    priority: 0.7,
  },
  inquiry: {
    path: (id) => `/investigations/inquiries/${encodeURIComponent(id)}`,
    changeFrequency: "weekly",
    priority: 0.6,
  },
  detector: {
    path: (id) => `/detectors/${encodeURIComponent(id)}`,
    changeFrequency: "monthly",
    priority: 0.6,
  },
  scan: {
    path: (id) => `/scans/${encodeURIComponent(id)}`,
    changeFrequency: "monthly",
    priority: 0.4,
  },
};

/**
 * Namespace-relative list pages worth indexing. Deliberately excludes routes
 * that are per-visitor or write-oriented (settings, notifications, `new`,
 * `edit`) — those are also disallowed in robots.txt.
 */
export const NAMESPACE_STATIC_PATHS: ReadonlyArray<{
  path: string;
  changeFrequency: ChangeFrequency;
  priority: number;
}> = [
  { path: "", changeFrequency: "daily", priority: 0.9 },
  { path: "/sources", changeFrequency: "daily", priority: 0.8 },
  { path: "/assets", changeFrequency: "daily", priority: 0.8 },
  { path: "/findings", changeFrequency: "daily", priority: 0.8 },
  { path: "/discovery", changeFrequency: "daily", priority: 0.7 },
  { path: "/investigations", changeFrequency: "daily", priority: 0.7 },
  { path: "/scans", changeFrequency: "daily", priority: 0.6 },
  { path: "/detectors", changeFrequency: "weekly", priority: 0.6 },
  { path: "/duplicates", changeFrequency: "weekly", priority: 0.5 },
  { path: "/duplicates/decisions", changeFrequency: "weekly", priority: 0.4 },
  { path: "/glossary", changeFrequency: "weekly", priority: 0.5 },
  { path: "/harness", changeFrequency: "weekly", priority: 0.4 },
];

/** Instance-wide pages that live outside any namespace. */
export const GLOBAL_STATIC_PATHS: ReadonlyArray<{
  path: string;
  changeFrequency: ChangeFrequency;
  priority: number;
}> = [
  { path: "", changeFrequency: "daily", priority: 1 },
  { path: "/docs", changeFrequency: "weekly", priority: 0.7 },
];

/** Paths crawlers should never spend budget on, or that leak nothing useful. */
export const ROBOTS_DISALLOW = [
  "/api/",
  "/classifyre-usr/",
  "/classifyre-cfg/",
  "/remote/",
  "/namespaces/",
  "/*/settings/",
  "/*/notifications/",
  "/*/new/",
  "/*/edit/",
] as const;

export const DEFAULT_SITEMAP_CHUNK_SIZE = 10_000;
const MIN_CHUNK_SIZE = 100;
const MAX_CHUNK_SIZE = 50_000;

/**
 * Reads an env var without letting Next.js inline it at build time — the web
 * image is built in CI long before Helm supplies these values (same reason as
 * `app/classifyre-cfg/route.ts`).
 */
function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/** Whether this deployment publishes a sitemap and invites crawlers. */
export function isSitemapEnabled(): boolean {
  return readEnv("SITEMAP_ENABLED") === "true";
}

export function sitemapChunkSize(): number {
  const raw = Number.parseInt(readEnv("SITEMAP_CHUNK_SIZE") ?? "", 10);
  if (!Number.isFinite(raw)) return DEFAULT_SITEMAP_CHUNK_SIZE;
  return Math.min(MAX_CHUNK_SIZE, Math.max(MIN_CHUNK_SIZE, raw));
}

/**
 * The public origin to build absolute URLs from.
 *
 * Derived from the request the crawler actually made — behind an ingress that
 * means `x-forwarded-*` — so the same image serves correct URLs on any
 * hostname. `SITEMAP_BASE_URL` overrides it when the canonical origin differs
 * from what reaches the pod (e.g. a CDN in front, or http inside the cluster).
 */
export function resolveBaseUrl(headers: Headers): string | null {
  const override = readEnv("SITEMAP_BASE_URL") ?? readEnv("PUBLIC_BASE_URL");
  if (override) return stripTrailingSlash(override);

  const forwardedHost = firstHeaderValue(headers.get("x-forwarded-host"));
  const host = forwardedHost ?? headers.get("host");
  if (!host) return null;

  const forwardedProto = firstHeaderValue(headers.get("x-forwarded-proto"));
  const proto = forwardedProto ?? (isLocalHost(host) ? "http" : "https");
  return stripTrailingSlash(`${proto}://${host}`);
}

function firstHeaderValue(value: string | null): string | undefined {
  // Chained proxies append: `x-forwarded-proto: https,http`. The client-facing
  // hop is the first one.
  const first = value?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

function isLocalHost(host: string): boolean {
  const hostname = host.split(":")[0] ?? "";
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".localhost")
  );
}

function stripTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * Absolute URL of an app page.
 *
 * `next.config.mjs` sets `trailingSlash: true`, so `/x` 308-redirects to `/x/`.
 * Emitting the pre-redirect form would make every URL in the sitemap a
 * redirect, so canonical URLs here always end in a slash.
 */
export function appUrl(
  baseUrl: string,
  namespaceSlug: string | null,
  path: string,
): string {
  const namespace = namespaceSlug
    ? `/${encodeURIComponent(namespaceSlug)}`
    : "";
  const suffix = path === "" || path === "/" ? "" : path;
  return `${baseUrl}${namespace}${suffix}/`;
}

/** Absolute URL of an entity's detail page. */
export function entityUrl(
  baseUrl: string,
  namespaceSlug: string,
  type: SitemapEntityType,
  id: string,
): string {
  return appUrl(baseUrl, namespaceSlug, ENTITY_CONFIG[type].path(id));
}

export function entityChangeFrequency(type: SitemapEntityType): ChangeFrequency {
  return ENTITY_CONFIG[type].changeFrequency;
}

export function entityPriority(type: SitemapEntityType): number {
  return ENTITY_CONFIG[type].priority;
}

/**
 * Absolute URL of a child sitemap. Child sitemaps live at
 * `/sitemap/<namespace>/<file>.xml` — a single top-level `sitemap` segment
 * (reserved against namespace slugs on both the API and the api-client) keeps
 * them clear of the `[namespaceSlug]` page tree.
 */
export function childSitemapUrl(
  baseUrl: string,
  namespaceSlug: string | null,
  file: string,
): string {
  const namespace = namespaceSlug
    ? `/${encodeURIComponent(namespaceSlug)}`
    : "";
  return `${baseUrl}/sitemap${namespace}/${file}`;
}

/**
 * Filename of the child sitemap holding list pages — the instance-wide ones at
 * `/sitemap/pages.xml`, a workspace's at `/sitemap/<namespace>/pages.xml`.
 */
export const STATIC_SITEMAP_FILE = "pages.xml";

export function entitySitemapFile(
  type: SitemapEntityType,
  chunk: number,
): string {
  return `${type}-${chunk}.xml`;
}

export type ChildSitemapTarget =
  | { kind: "global" }
  | { kind: "static"; namespaceSlug: string }
  | {
      kind: "entity";
      namespaceSlug: string;
      type: SitemapEntityType;
      chunk: number;
    };

/**
 * Parse a child sitemap path back into what to render — `/sitemap/pages.xml`
 * for the instance-wide pages, `/sitemap/<namespace>/<file>.xml` for a
 * workspace. Returns null for anything unrecognised so the route can 404
 * rather than guess.
 */
export function parseChildSitemapPath(
  segments: string[],
): ChildSitemapTarget | null {
  if (segments.length === 1) {
    return segments[0] === STATIC_SITEMAP_FILE ? { kind: "global" } : null;
  }
  if (segments.length !== 2) return null;
  const [rawNamespace, file] = segments;
  if (!rawNamespace || !file) return null;

  const namespaceSlug = decodeURIComponent(rawNamespace);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(namespaceSlug)) {
    return null;
  }

  if (file === STATIC_SITEMAP_FILE) return { kind: "static", namespaceSlug };

  const match = /^([a-z]+)-(\d{1,6})\.xml$/.exec(file);
  if (!match) return null;
  const [, type, chunk] = match;
  if (!isSitemapEntityType(type)) return null;

  return {
    kind: "entity",
    namespaceSlug,
    type,
    chunk: Number.parseInt(chunk as string, 10),
  };
}

export function isSitemapEntityType(
  value: string | undefined,
): value is SitemapEntityType {
  return (
    value !== undefined &&
    (SITEMAP_ENTITY_TYPES as readonly string[]).includes(value)
  );
}

export interface SitemapUrlEntry {
  url: string;
  lastModified?: string | null;
  changeFrequency?: ChangeFrequency;
  priority?: number;
}

export interface SitemapIndexEntry {
  url: string;
  lastModified?: string | null;
}

export function renderUrlSet(entries: SitemapUrlEntry[]): string {
  const body = entries
    .map((entry) => {
      const parts = [`    <loc>${escapeXml(entry.url)}</loc>`];
      const lastmod = toW3cDate(entry.lastModified);
      if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
      if (entry.changeFrequency) {
        parts.push(`    <changefreq>${entry.changeFrequency}</changefreq>`);
      }
      if (entry.priority !== undefined) {
        parts.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
      }
      return `  <url>\n${parts.join("\n")}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export function renderSitemapIndex(entries: SitemapIndexEntry[]): string {
  const body = entries
    .map((entry) => {
      const parts = [`    <loc>${escapeXml(entry.url)}</loc>`];
      const lastmod = toW3cDate(entry.lastModified);
      if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
      return `  <sitemap>\n${parts.join("\n")}\n  </sitemap>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>
`;
}

/** ISO-8601/W3C datetime, or undefined when the input is unusable. */
export function toW3cDate(
  value: string | number | Date | null | undefined,
): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** robots.txt body. Crawling is invited only when the sitemap is enabled. */
export function renderRobots(baseUrl: string | null): string {
  if (!isSitemapEnabled() || !baseUrl) {
    return ["User-agent: *", "Disallow: /", ""].join("\n");
  }

  return [
    "User-agent: *",
    "Allow: /",
    ...ROBOTS_DISALLOW.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${baseUrl}/sitemap.xml`,
    "",
  ].join("\n");
}
