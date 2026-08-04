/**
 * The tenant entities that have a public detail page in the web app, and how to
 * read their sitemap coordinates (identity + last-modified) out of Postgres.
 *
 * This registry is the ONLY place table/column names enter the sitemap SQL —
 * every fragment below is a compile-time constant, never request input, so the
 * queries in `SitemapService` can interpolate them with `Prisma.raw` safely.
 * The matching web paths live in `apps/web/lib/sitemap-config.ts`; adding an
 * entity means touching both.
 */

/** Entity kinds the sitemap can enumerate. Wire values, kept stable. */
export const SITEMAP_ENTITY_TYPES = [
  'source',
  'asset',
  'finding',
  'case',
  'inquiry',
  'detector',
  'scan',
] as const;

export type SitemapEntityType = (typeof SITEMAP_ENTITY_TYPES)[number];

interface SitemapEntityConfig {
  /** Physical table in the tenant schema (see `@@map` in schema.prisma). */
  table: string;
  /**
   * SQL expression yielding the row's last-modified instant. Feeds `<lastmod>`,
   * so it must never be NULL for a row that exists.
   */
  lastModified: string;
  /**
   * Deterministic, append-only ordering. Chunk membership is derived from it,
   * so ordering by a mutable column (e.g. `updated_at`) would shuffle URLs
   * between chunks on every edit and make crawlers re-fetch every chunk. Ties
   * are broken by id to keep the order total.
   */
  orderBy: string;
}

export const SITEMAP_ENTITIES: Record<SitemapEntityType, SitemapEntityConfig> =
  {
    source: {
      table: 'sources',
      lastModified: 'updated_at',
      orderBy: 'created_at, id',
    },
    asset: {
      table: 'assets',
      lastModified: 'updated_at',
      orderBy: 'created_at, id',
    },
    finding: {
      table: 'findings',
      lastModified: 'updated_at',
      orderBy: 'created_at, id',
    },
    case: {
      table: 'cases',
      lastModified: 'updated_at',
      orderBy: 'created_at, id',
    },
    inquiry: {
      table: 'inquiries',
      lastModified: 'updated_at',
      orderBy: 'created_at, id',
    },
    detector: {
      table: 'custom_detectors',
      lastModified: 'updated_at',
      orderBy: 'created_at, id',
    },
    // Runners have no `updated_at`: a run's lifecycle is triggered → started →
    // completed, so the newest of those is when the page last changed.
    scan: {
      table: 'runners',
      lastModified: 'COALESCE(completed_at, started_at, triggered_at)',
      orderBy: 'triggered_at, id',
    },
  };

export function isSitemapEntityType(value: string): value is SitemapEntityType {
  return (SITEMAP_ENTITY_TYPES as readonly string[]).includes(value);
}
