import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { EXTERNAL_PEER } from './source-graph.constants';

export interface SourceGraphNodeRow {
  sourceId: string;
  assetCount: number;
  connectedAssetCount: number;
  internalEdgeCount: number;
  findingCount: number;
  severityCounts: Record<string, number>;
}

export interface SourceGraphLinkRow {
  sourceAId: string;
  sourceBId: string;
  relationClass: string;
  edgeCount: number;
  assetCount: number;
}

export interface SourceGraphBoundaryRow {
  assetId: string;
  sourceId: string;
  peerSourceId: string;
  relationClass: string;
  edgeCount: number;
}

/** A source pairing whose boundary assets are too many to draw individually. */
export interface SourceGraphBundleRow {
  sourceId: string;
  peerSourceId: string;
  assetCount: number;
  edgeCount: number;
}

export interface SourceGraphFreshness {
  refreshedAt: Date | null;
  durationMs: number | null;
  isBuilt: boolean;
}

const SINGLETON = 'singleton';

/**
 * Builds and reads the source connection map.
 *
 * Two rules shape everything here.
 *
 * The aggregation never leaves Postgres. Answering "how many edges run between
 * these two sources" needs `edges` joined to `assets` twice, which is millions
 * of rows on a real corpus; streaming that into Node to count it is the mistake
 * the finding-stats rollup already exists to avoid repeating.
 *
 * Nothing is truncated. The response stays small because the grain is the
 * source, not the asset — a workspace with two million assets across twelve
 * sources still produces twelve node rows. The only per-asset rows are the ones
 * whose edges leave their own source, which is the minority the map exists to
 * draw, and even those aggregate rather than being cut off.
 */
@Injectable()
export class SourceGraphService {
  private readonly logger = new Logger(SourceGraphService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Build ─────────────────────────────────────────────────────────────────

  async rebuild(): Promise<{ sources: number; links: number }> {
    const started = Date.now();

    await this.rebuildLinks();
    await this.rebuildBoundaryAssets();
    await this.rebuildNodes();

    const [{ sources, links }] = await this.prisma.$queryRaw<
      Array<{ sources: bigint; links: bigint }>
    >`
      SELECT (SELECT COUNT(*) FROM source_graph_nodes) AS sources,
             (SELECT COUNT(*) FROM source_graph_links) AS links`;

    await this.markBuilt(started);
    this.logger.log(
      `Rebuilt source connection map in ${Date.now() - started} ms ` +
        `(${Number(sources)} sources, ${Number(links)} links).`,
    );
    return { sources: Number(sources), links: Number(links) };
  }

  /**
   * Edge counts per unordered source pair per class.
   *
   * The cast direction is load-bearing: `a.id::text = e.from_id`, never
   * `e.from_id::uuid`. `edges.from_id` holds a URN, not a UUID, whenever the
   * endpoint type is `external`, and Postgres is free to evaluate the cast
   * before the `from_type = 'asset'` filter — which turns the whole rebuild
   * into `invalid input syntax for type uuid`.
   *
   * `Asset.links` is folded in as REFERENCE. Those hash references are the same
   * connections the source-detail canvas draws, and a source whose only links
   * come from them would otherwise appear completely isolated.
   */
  private async rebuildLinks(): Promise<void> {
    await this.prisma.$executeRaw`TRUNCATE TABLE source_graph_links`;
    await this.prisma.$executeRaw`
      INSERT INTO source_graph_links (source_a_id, source_b_id, relation_class, edge_count, asset_count)
      WITH typed AS (
        SELECT LEAST(a.source_id, b.source_id)    AS source_a_id,
               GREATEST(a.source_id, b.source_id) AS source_b_id,
               e.relation_class                   AS relation_class,
               a.id                               AS a_id,
               b.id                               AS b_id
        FROM edges e
        JOIN assets a ON e.from_type = 'asset' AND a.id::text = e.from_id
        JOIN assets b ON e.to_type   = 'asset' AND b.id::text = e.to_id
      ),
      linked AS (
        SELECT LEAST(a.source_id, b.source_id)    AS source_a_id,
               GREATEST(a.source_id, b.source_id) AS source_b_id,
               'REFERENCE'::"EdgeClass"           AS relation_class,
               a.id                               AS a_id,
               b.id                               AS b_id
        FROM assets a
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(a.links) = 'array' THEN a.links ELSE '[]'::jsonb END
        ) AS l(hash)
        JOIN assets b ON b.hash = l.hash AND b.id <> a.id
      ),
      combined AS (
        SELECT * FROM typed
        UNION ALL
        SELECT * FROM linked
      ),
      counts AS (
        SELECT source_a_id, source_b_id, relation_class, COUNT(*)::int AS edge_count
        FROM combined
        GROUP BY 1, 2, 3
      ),
      -- Both endpoints unnested into one column before the DISTINCT, so an
      -- asset appearing on either side of the pairing is counted once. Summing
      -- two separate DISTINCTs (which is what the older correlation source-pair
      -- rollup does) double-counts every asset that appears on both, and on an
      -- intra-source pairing that is most of them.
      participants AS (
        SELECT source_a_id, source_b_id, relation_class,
               COUNT(DISTINCT asset_id)::int AS asset_count
        FROM combined, LATERAL (VALUES (a_id), (b_id)) AS t(asset_id)
        GROUP BY 1, 2, 3
      )
      SELECT c.source_a_id, c.source_b_id, c.relation_class, c.edge_count, p.asset_count
      FROM counts c
      JOIN participants p USING (source_a_id, source_b_id, relation_class)`;
  }

  /**
   * The assets that reach outside their own source.
   *
   * Both directions are collected and unioned rather than joined with an `OR`,
   * because an `OR` across `(from_type, from_id)` and `(to_type, to_id)` cannot
   * use either of the edge indexes.
   */
  private async rebuildBoundaryAssets(): Promise<void> {
    await this.prisma.$executeRaw`TRUNCATE TABLE source_graph_boundary_assets`;
    await this.prisma.$executeRaw`
      INSERT INTO source_graph_boundary_assets (asset_id, source_id, peer_source_id, relation_class, edge_count)
      WITH outgoing AS (
        SELECT a.id AS asset_id, a.source_id,
               COALESCE(b.source_id, ${EXTERNAL_PEER}) AS peer_source_id,
               e.relation_class
        FROM edges e
        JOIN assets a ON e.from_type = 'asset' AND a.id::text = e.from_id
        LEFT JOIN assets b ON e.to_type = 'asset' AND b.id::text = e.to_id
        WHERE b.source_id IS DISTINCT FROM a.source_id
      ),
      incoming AS (
        SELECT a.id AS asset_id, a.source_id,
               COALESCE(b.source_id, ${EXTERNAL_PEER}) AS peer_source_id,
               e.relation_class
        FROM edges e
        JOIN assets a ON e.to_type = 'asset' AND a.id::text = e.to_id
        LEFT JOIN assets b ON e.from_type = 'asset' AND b.id::text = e.from_id
        WHERE b.source_id IS DISTINCT FROM a.source_id
      ),
      crossing AS (
        SELECT * FROM outgoing
        UNION ALL
        SELECT * FROM incoming
      )
      SELECT asset_id, source_id, peer_source_id, relation_class, COUNT(*)::int
      FROM crossing
      GROUP BY 1, 2, 3, 4`;
  }

  /**
   * Per-source totals.
   *
   * Driven from `sources`, not `assets`, so a source that has never been
   * scanned still gets a bubble instead of vanishing from the map.
   *
   * `connected_asset_count` counts EVERY edge class, not the derivation subset:
   * an asset joined to anything at all is worth drawing. Subtracting it from
   * `asset_count` produces the muted "unconnected" caption, which is what keeps
   * this payload independent of how large the corpus is.
   */
  private async rebuildNodes(): Promise<void> {
    await this.prisma.$executeRaw`TRUNCATE TABLE source_graph_nodes`;
    await this.prisma.$executeRaw`
      INSERT INTO source_graph_nodes (source_id, asset_count, connected_asset_count, internal_edge_count, finding_count, severity_counts)
      WITH endpoints AS (
        SELECT from_id AS asset_id FROM edges WHERE from_type = 'asset'
        UNION
        SELECT to_id   AS asset_id FROM edges WHERE to_type   = 'asset'
        UNION
        SELECT a.id::text FROM assets a
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(a.links) = 'array' THEN a.links ELSE '[]'::jsonb END
        ) AS l(hash)
        JOIN assets b ON b.hash = l.hash AND b.id <> a.id
      ),
      connected AS (
        SELECT a.source_id, COUNT(*)::int AS n
        FROM assets a
        JOIN endpoints ep ON a.id::text = ep.asset_id
        GROUP BY 1
      ),
      sized AS (
        SELECT source_id, COUNT(*)::int AS n FROM assets GROUP BY 1
      ),
      internal AS (
        SELECT source_a_id AS source_id, SUM(edge_count)::int AS n
        FROM source_graph_links
        WHERE source_a_id = source_b_id
        GROUP BY 1
      ),
      per_severity AS (
        SELECT source_id, severity::text AS severity, COUNT(*)::int AS c
        FROM findings
        WHERE status = 'OPEN'
        GROUP BY 1, 2
      ),
      findings_by_source AS (
        SELECT source_id,
               SUM(c)::int AS n,
               jsonb_object_agg(severity, c) AS mix
        FROM per_severity
        GROUP BY source_id
      )
      SELECT s.id,
             COALESCE(z.n, 0),
             COALESCE(c.n, 0),
             COALESCE(i.n, 0),
             COALESCE(f.n, 0),
             COALESCE(f.mix, '{}'::jsonb)
      FROM sources s
      LEFT JOIN sized z             ON z.source_id = s.id
      LEFT JOIN connected c         ON c.source_id = s.id
      LEFT JOIN internal i          ON i.source_id = s.id
      LEFT JOIN findings_by_source f ON f.source_id = s.id`;
  }

  // ── State ─────────────────────────────────────────────────────────────────

  private async markBuilt(started: number): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO source_graph_state (id, refreshed_at, duration_ms, is_built, updated_at)
      VALUES (${SINGLETON}, NOW(), ${Date.now() - started}, true, NOW())
      ON CONFLICT (id) DO UPDATE SET
        refreshed_at = EXCLUDED.refreshed_at,
        duration_ms = EXCLUDED.duration_ms,
        is_built = true,
        updated_at = NOW()`;
  }

  async getFreshness(): Promise<SourceGraphFreshness> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        refreshed_at: Date | null;
        duration_ms: number | null;
        is_built: boolean;
      }>
    >`SELECT refreshed_at, duration_ms, is_built
      FROM source_graph_state WHERE id = ${SINGLETON}`;
    const row = rows[0];
    return {
      refreshedAt: row?.refreshed_at ?? null,
      durationMs: row?.duration_ms ?? null,
      isBuilt: row?.is_built ?? false,
    };
  }

  async isUsable(): Promise<boolean> {
    return (await this.getFreshness()).isBuilt;
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * The whole map.
   *
   * There is no limit parameter and nothing is truncated. What keeps the result
   * small is the grain: one row per source, one per source pairing per class.
   *
   * Boundary assets are the exception that had to be measured rather than
   * assumed. On a real corpus 44,452 of 69,350 assets touch something outside
   * their own source — so "only the ones that cross a boundary" is not a small
   * set, and reading them all to decide they should be aggregated would be the
   * unbounded read this rollup exists to avoid. The per-pairing summary is
   * counted in SQL first (tens of rows), and only pairings small enough to draw
   * individually have their assets fetched.
   */
  async readMap(bundleThreshold: number): Promise<{
    nodes: SourceGraphNodeRow[];
    links: SourceGraphLinkRow[];
    boundary: SourceGraphBoundaryRow[];
    bundles: SourceGraphBundleRow[];
  }> {
    const [nodes, links, pairSummary] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          source_id: string;
          asset_count: number;
          connected_asset_count: number;
          internal_edge_count: number;
          finding_count: number;
          severity_counts: Record<string, number>;
        }>
      >`SELECT source_id, asset_count, connected_asset_count, internal_edge_count,
               finding_count, severity_counts
        FROM source_graph_nodes`,
      this.prisma.$queryRaw<
        Array<{
          source_a_id: string;
          source_b_id: string;
          relation_class: string;
          edge_count: number;
          asset_count: number;
        }>
      >`SELECT source_a_id, source_b_id, relation_class::text AS relation_class,
               edge_count, asset_count
        FROM source_graph_links`,
      this.prisma.$queryRaw<
        Array<{
          source_id: string;
          peer_source_id: string;
          asset_count: bigint;
          edge_count: bigint;
        }>
      >`SELECT source_id, peer_source_id,
               COUNT(DISTINCT asset_id) AS asset_count,
               SUM(edge_count)          AS edge_count
        FROM source_graph_boundary_assets
        GROUP BY 1, 2`,
    ]);

    const drawable = pairSummary.filter(
      (row) => Number(row.asset_count) <= bundleThreshold,
    );
    const bundles: SourceGraphBundleRow[] = pairSummary
      .filter((row) => Number(row.asset_count) > bundleThreshold)
      .map((row) => ({
        sourceId: row.source_id,
        peerSourceId: row.peer_source_id,
        assetCount: Number(row.asset_count),
        edgeCount: Number(row.edge_count),
      }));

    // Only the pairings small enough to draw asset-by-asset are fetched, so the
    // row count here is bounded by (pairings x threshold), not by corpus size.
    const boundary = drawable.length
      ? await this.prisma.$queryRaw<
          Array<{
            asset_id: string;
            source_id: string;
            peer_source_id: string;
            relation_class: string;
            edge_count: number;
          }>
        >`SELECT asset_id, source_id, peer_source_id,
                 relation_class::text AS relation_class, edge_count
          FROM source_graph_boundary_assets
          WHERE (source_id, peer_source_id) IN (
            SELECT * FROM UNNEST(
              ${drawable.map((r) => r.source_id)}::text[],
              ${drawable.map((r) => r.peer_source_id)}::text[]
            )
          )`
      : [];

    return {
      nodes: nodes.map((row) => ({
        sourceId: row.source_id,
        assetCount: row.asset_count,
        connectedAssetCount: row.connected_asset_count,
        internalEdgeCount: row.internal_edge_count,
        findingCount: row.finding_count,
        severityCounts: row.severity_counts ?? {},
      })),
      links: links.map((row) => ({
        sourceAId: row.source_a_id,
        sourceBId: row.source_b_id,
        relationClass: row.relation_class,
        edgeCount: row.edge_count,
        assetCount: row.asset_count,
      })),
      boundary: boundary.map((row) => ({
        assetId: row.asset_id,
        sourceId: row.source_id,
        peerSourceId: row.peer_source_id,
        relationClass: row.relation_class,
        edgeCount: row.edge_count,
      })),
      bundles,
    };
  }
}
