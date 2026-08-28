import { Injectable, Logger } from '@nestjs/common';
import { type EdgeClass, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  DERIVATION_CLASSES,
  DERIVATION_EXCLUDED_TYPES,
} from '../../graph/edge-class';
import { UnionFind } from '../../utils/union-find';
import {
  BOILERPLATE_PAIR_CAP,
  FANOUT_CAP,
  LINEAGE_HAIRBALL_MIN_ASSETS,
  LINEAGE_HAIRBALL_SHARE,
  LINEAGE_ROOT_CAP,
  LINEAGE_ROOT_DEPTH,
  MIN_PATTERN_PAIRS,
  PATTERN_LABEL_CAP,
  SCORE_BUCKET_COUNT,
} from '../correlation.constants';

const ASSET_REL = 'asset';
const STREAM_PAGE = 5000;

/** Relation types the review queue reads pairs from. */
const REVIEWABLE_RELATION_TYPES = [
  'related',
  'likely_duplicate',
  'identical_content',
];

export interface ReviewIndexStats {
  pairs: number;
  patterns: number;
  lineageCovered: number;
  hairballDemoted: boolean;
  durationMs: number;
}

/**
 * Builds the derived tables behind the fingerprints review queue.
 *
 * Everything here is a rollup of what the correlation engine already wrote:
 * asset-to-asset edges, their `sharedByLabel` metadata, the clusters, and the
 * lineage graph. Nothing is re-scored.
 *
 * The reason it is materialised rather than computed per request is that the
 * natural grouping key — the set of labels that made two assets match — lives
 * inside a JsonB column with variable arity. No index can serve a GROUP BY over
 * it, so a live aggregate is a sequential scan of every correlation edge on
 * every page load and every cutoff drag. That is the same mistake as the
 * unscoped graph this queue replaced, and it is why the level-1 read here is a
 * few dozen rows instead.
 *
 * Every phase is an `INSERT ... SELECT` or a paged stream. This file's
 * neighbours have a long history of heap exhaustion; nothing may materialise a
 * corpus-sized array in Node.
 */
@Injectable()
export class CorrelationReviewIndexService {
  private readonly logger = new Logger(CorrelationReviewIndexService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rebuild the whole review index.
   *
   * Must run AFTER cluster maintenance: cluster ids are an input, and a pair
   * rolled up against a stale cluster would put the reviewer in front of a
   * group that no longer exists.
   */
  async refresh(opts: {
    labelWeights: Record<string, number>;
    defaultWeight: number;
  }): Promise<ReviewIndexStats> {
    const started = Date.now();
    const computedAt = new Date();

    await this.refreshLabelProfiles(opts);
    const lineage = await this.refreshLineageProfiles();
    const pairs = await this.refreshPairSignatures(computedAt);
    await this.applyPatternKeyBucketing();
    const patterns = await this.refreshRollups(computedAt);
    await this.refreshSourcePairs();

    const durationMs = Date.now() - started;
    this.logger.log(
      `Review index rebuilt: ${pairs} pairs, ${patterns} patterns, ` +
        `${lineage.covered} lineage-covered assets in ${durationMs}ms`,
    );
    return {
      pairs,
      patterns,
      lineageCovered: lineage.covered,
      hairballDemoted: lineage.hairball,
      durationMs,
    };
  }

  // ── 1. Per-asset label profiles ────────────────────────────────────────────

  /**
   * Fanout-filtered value counts and weights per asset per label.
   *
   * Same CTE shape as CorrelationService.loadAssetTotals, one grouping level
   * deeper. It has to be materialised because `owners <= FANOUT_CAP` is a
   * corpus-scoped question: whether a value is distinctive depends on how many
   * OTHER assets hold it, which cannot be answered for a single pair without
   * scanning the whole table. Without it the waterfall could only show what
   * matched, never what failed to.
   */
  private async refreshLabelProfiles(opts: {
    labelWeights: Record<string, number>;
    defaultWeight: number;
  }): Promise<void> {
    const weightsJson = JSON.stringify(opts.labelWeights);
    await this.prisma.$executeRaw(Prisma.sql`
      WITH hash_counts AS (
        SELECT value_hash, COUNT(*) AS owners
        FROM asset_correlation_values
        GROUP BY value_hash
      ),
      profiles AS (
        SELECT v.asset_id,
               v.label,
               COUNT(*) FILTER (WHERE hc.owners <= ${FANOUT_CAP})::int AS nf_count,
               COALESCE(SUM(COALESCE((${weightsJson}::jsonb ->> v.label)::numeric, ${opts.defaultWeight}))
                 FILTER (WHERE hc.owners <= ${FANOUT_CAP}), 0) AS nf_weight
        FROM asset_correlation_values v
        JOIN hash_counts hc ON hc.value_hash = v.value_hash
        GROUP BY v.asset_id, v.label
      )
      INSERT INTO asset_label_profiles (asset_id, label, nf_count, nf_weight)
      SELECT asset_id, label, nf_count, nf_weight FROM profiles
      ON CONFLICT (asset_id, label)
      DO UPDATE SET nf_count = EXCLUDED.nf_count, nf_weight = EXCLUDED.nf_weight
    `);

    // Drop rows for (asset, label) pairs that no longer produce any value —
    // an ON CONFLICT upsert cannot notice a disappearance.
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM asset_label_profiles p
      WHERE NOT EXISTS (
        SELECT 1 FROM asset_correlation_values v
        WHERE v.asset_id = p.asset_id AND v.label = p.label
      )
    `);
  }

  // ── 2. Per-asset lineage profiles ─────────────────────────────────────────

  /**
   * Connected components over the derivation graph.
   *
   * Pairwise reachability would mean a bounded breadth-first search from every
   * distinct asset in the queue — tens of thousands of seeds over a graph that
   * can be dense. Components are one O(E) pass and turn the per-pair test into
   * a map lookup.
   *
   * The trade is real and is handled rather than hidden: "same component" is a
   * weaker claim than "there is a path", so a single dominant component is
   * demoted to UNKNOWN by the caller rather than reported as evidence.
   */
  private async refreshLineageProfiles(): Promise<{
    covered: number;
    hairball: boolean;
  }> {
    const uf = new UnionFind([]);
    const degree = new Map<string, number>();

    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.edge.findMany({
        where: {
          fromType: ASSET_REL,
          toType: ASSET_REL,
          relationClass: { in: DERIVATION_CLASSES as EdgeClass[] },
          relationType: { notIn: [...DERIVATION_EXCLUDED_TYPES] },
        },
        select: { id: true, fromId: true, toId: true },
        orderBy: { id: 'asc' },
        take: STREAM_PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      for (const e of rows) {
        uf.union(e.fromId, e.toId);
        degree.set(e.fromId, (degree.get(e.fromId) ?? 0) + 1);
        degree.set(e.toId, (degree.get(e.toId) ?? 0) + 1);
      }
      if (rows.length < STREAM_PAGE) break;
      cursor = rows.at(-1)!.id;
    }

    await this.prisma.$executeRaw(Prisma.sql`TRUNCATE TABLE asset_lineage_profiles`);

    const covered = degree.size;
    if (covered === 0) return { covered: 0, hairball: false };

    const sizes = new Map<string, number>();
    for (const id of degree.keys()) {
      const root = uf.find(id);
      sizes.set(root, (sizes.get(root) ?? 0) + 1);
    }
    const largest = Math.max(...sizes.values());
    // The floor matters as much as the share: on a small estate a component of
    // two IS most of the graph, and demoting it would throw away the only
    // lineage evidence there is.
    const hairball =
      covered >= LINEAGE_HAIRBALL_MIN_ASSETS &&
      largest > covered * LINEAGE_HAIRBALL_SHARE;
    if (hairball) {
      this.logger.warn(
        `Lineage component covers ${largest}/${covered} assets ` +
          `(> ${LINEAGE_HAIRBALL_SHARE * 100}%): membership in it is not evidence, ` +
          `so those pairs report UNKNOWN rather than a derivation path.`,
      );
    }

    const roots = await this.upstreamRoots();
    const computedAt = new Date();

    const ids = Array.from(degree.keys());
    for (let i = 0; i < ids.length; i += 1000) {
      const slice = ids.slice(i, i + 1000);
      await this.prisma.assetLineageProfile.createMany({
        data: slice.map((assetId) => {
          const root = uf.find(assetId);
          return {
            assetId,
            degree: degree.get(assetId) ?? 0,
            // A component that swallows the corpus explains nothing, so it is
            // recorded as no component at all rather than as a shared origin.
            componentId: hairball && sizes.get(root) === largest ? null : root,
            componentSize: sizes.get(root) ?? 1,
            upstreamRoots: roots.get(assetId) ?? [],
            computedAt,
          };
        }),
        skipDuplicates: true,
      });
    }

    return { covered, hairball };
  }

  /**
   * Up to LINEAGE_ROOT_CAP FLOW ancestors within LINEAGE_ROOT_DEPTH hops.
   *
   * FLOW only, and only upstream: an ancestor is what explains two assets
   * resembling each other, whereas containment or identity would fold in
   * relationships that say nothing about where the data came from.
   */
  private async upstreamRoots(): Promise<Map<string, string[]>> {
    const rows = await this.prisma.$queryRaw<
      Array<{ asset_id: string; roots: string[] }>
    >(Prisma.sql`
      WITH RECURSIVE up AS (
        SELECT e.to_id AS asset_id, e.from_id AS root, 1 AS depth
        FROM edges e
        WHERE e.from_type = ${ASSET_REL}
          AND e.to_type = ${ASSET_REL}
          AND e.relation_class = 'FLOW'
        UNION
        SELECT up.asset_id, e.from_id, up.depth + 1
        FROM up
        JOIN edges e ON e.to_id = up.root
          AND e.from_type = ${ASSET_REL}
          AND e.to_type = ${ASSET_REL}
          AND e.relation_class = 'FLOW'
        WHERE up.depth < ${LINEAGE_ROOT_DEPTH}
      )
      SELECT asset_id, (ARRAY_AGG(DISTINCT root))[1:${LINEAGE_ROOT_CAP}] AS roots
      FROM up
      GROUP BY asset_id
    `);
    return new Map(rows.map((r) => [r.asset_id, r.roots ?? []]));
  }

  // ── 3. Pair signatures + the similarity/lineage 2x2 ───────────────────────

  /**
   * One row per scored pair, carrying its raw pattern key and its lineage
   * verdict.
   *
   * The 2x2 is the reason lineage is worth joining in at all. Fingerprints come
   * from finding values; lineage comes from connectors, query logs and manifests.
   * Because the two signals do not share a source, combining them adds
   * information — unlike stacking two lexical measures, which mostly agree.
   *
   *   similar + path      → a derived copy. Expected redundancy; a mart that
   *                         resembles its source is doing its job. Reporting it
   *                         is the main reason metadata-only duplicate detection
   *                         gets ignored, so it is deprioritised.
   *   similar + no path   → convergent duplication. Two teams built the same
   *                         thing independently and nothing connects them. This
   *                         is the expensive, invisible case worth escalating.
   *   unknown             → we have no lineage for one of these assets. Not
   *                         evidence of anything, and never presented as such.
   */
  private async refreshPairSignatures(computedAt: Date): Promise<number> {
    await this.prisma.$executeRaw(
      Prisma.sql`TRUNCATE TABLE correlation_pair_signatures`,
    );

    // Membership in a component that was demoted (component_id nulled) is not
    // evidence — see refreshLineageProfiles.
    const hairballGuard = Prisma.sql`
      (la.component_id IS NULL OR lb.component_id IS NULL)
    `;
    // A declared FLOW ancestor, or a shared one. Derived from explicit root
    // sets rather than component membership, so it holds regardless of how the
    // rest of the graph is shaped.
    const rootEvidence = Prisma.sql`(
      n.a_id = ANY(lb.upstream_roots)
      OR n.b_id = ANY(la.upstream_roots)
      OR la.upstream_roots && lb.upstream_roots
    )`;

    await this.prisma.$executeRaw(Prisma.sql`
      -- Normalised so a_id < b_id ALWAYS.
      --
      -- The scorer writes an edge in whatever order its self-join produced, so
      -- from_id/to_id are not sorted. Storing them raw meant a reader that
      -- canonicalises the pair (which every reader must, since a pair has no
      -- inherent direction) could not find the row — the pair 404'd from its
      -- own list. Worse, a verdict is keyed canonically, so a decision on such
      -- a pair would never match its signature and the pair would keep coming
      -- back to be decided again.
      WITH normalised AS (
        SELECT
          LEAST(e.from_id, e.to_id)    AS a_id,
          GREATEST(e.from_id, e.to_id) AS b_id,
          e.metadata,
          e.relation_type,
          e.confidence
        FROM edges e
        WHERE e.from_type = ${ASSET_REL}
          AND e.to_type = ${ASSET_REL}
          AND e.relation_type IN (${Prisma.join(REVIEWABLE_RELATION_TYPES)})
      )
      INSERT INTO correlation_pair_signatures (
        a_id, b_id, pattern_key, family, weighted, shared_count, labels,
        cluster_id, source_a_id, source_b_id,
        lineage_state, lineage_relation, computed_at
      )
      SELECT
        n.a_id,
        n.b_id,
        CASE
          WHEN n.relation_type = 'identical_content' THEN 'identical:'
          WHEN COALESCE((n.metadata ->> 'phoneticOnly')::boolean, false)
            THEN 'phonetic:' || COALESCE((
              SELECT string_agg(k, '+' ORDER BY k)
              FROM jsonb_object_keys(n.metadata -> 'sharedByLabel') k), 'unknown')
          ELSE COALESCE((
            SELECT string_agg(k, '+' ORDER BY k)
            FROM jsonb_object_keys(n.metadata -> 'sharedByLabel') k), 'unknown')
        END,
        CASE
          WHEN n.relation_type = 'identical_content' THEN 'IDENTICAL_CONTENT'
          WHEN COALESCE((n.metadata ->> 'phoneticOnly')::boolean, false) THEN 'PHONETIC'
          ELSE 'SHARED_LABELS'
        END::"CorrelationPatternFamily",
        -- Recomputed from the 4dp numerator/denominator rather than read from
        -- the "weighted" key, which the scorer rounds to two decimals for
        -- display. At 2dp a score of 0.714286 is stored as 0.71, and the pair
        -- screen would print bars that add to 0.714 under a headline of 0.71.
        --
        -- Clamped to [0,1], not 0.999: numeric(4,3) holds up to 9.999, and
        -- shaving a perfect match would reintroduce the same mismatch.
        LEAST(1, GREATEST(0, COALESCE(
          CASE
            WHEN COALESCE((n.metadata ->> 'denom')::numeric, 0) > 0
            THEN 2 * (n.metadata ->> 'weightedShared')::numeric
                   / (n.metadata ->> 'denom')::numeric
          END,
          (n.metadata ->> 'weighted')::numeric,
          n.confidence))),
        COALESCE((n.metadata ->> 'sharedCount')::int, 0),
        COALESCE(ARRAY(
          SELECT k FROM jsonb_object_keys(n.metadata -> 'sharedByLabel') k ORDER BY k
        ), ARRAY[]::text[]),
        m.cluster_id,
        aa.source_id,
        ab.source_id,
        CASE
          WHEN la.asset_id IS NULL OR lb.asset_id IS NULL THEN 'UNKNOWN'
          WHEN ${rootEvidence} THEN 'PATH'
          WHEN ${hairballGuard} THEN 'UNKNOWN'
          WHEN la.component_id = lb.component_id THEN 'PATH'
          ELSE 'NO_PATH'
        END::"CorrelationLineageState",
        CASE
          WHEN la.asset_id IS NULL OR lb.asset_id IS NULL THEN 'UNKNOWN'
          WHEN n.a_id = ANY(lb.upstream_roots)
            OR n.b_id = ANY(la.upstream_roots) THEN 'ANCESTOR_DESCENDANT'
          WHEN la.upstream_roots && lb.upstream_roots THEN 'SIBLING'
          WHEN ${hairballGuard} THEN 'UNKNOWN'
          WHEN la.component_id = lb.component_id THEN 'CONNECTED_OTHER'
          ELSE 'DISCONNECTED'
        END::"CorrelationLineageRelation",
        ${computedAt}
      FROM normalised n
      JOIN assets aa ON aa.id = n.a_id
      JOIN assets ab ON ab.id = n.b_id
      LEFT JOIN asset_cluster_members m ON m.asset_id = n.a_id
      LEFT JOIN asset_lineage_profiles la ON la.asset_id = n.a_id
      LEFT JOIN asset_lineage_profiles lb ON lb.asset_id = n.b_id
      ON CONFLICT (a_id, b_id) DO NOTHING
    `);

    await this.foldInBoilerplate(computedAt);

    const [{ count }] = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count FROM correlation_pair_signatures`,
    );
    return Number(count);
  }

  /**
   * Near-duplicate text groups, projected onto asset pairs.
   *
   * A different engine entirely: these come from cosine similarity over finding
   * content embeddings, not from shared values. They belong in the same queue
   * because they answer the same question and because their fix is a real one —
   * an exclusion rule that stops boilerplate from driving matches at all.
   *
   * Projection is lossy in both directions and quadratic, so it is capped. The
   * pattern header keeps the uncapped size; a row that says "N pairs" where N
   * was silently truncated is worse than no row.
   */
  private async foldInBoilerplate(computedAt: Date): Promise<void> {
    const hasEmbeddings = await this.prisma.$queryRaw<Array<{ ok: boolean }>>(
      Prisma.sql`
        SELECT EXISTS (
          SELECT 1 FROM finding_evidence_analyses
          WHERE duplicate_group_hash IS NOT NULL LIMIT 1
        ) AS ok
      `,
    );
    if (!hasEmbeddings[0]?.ok) return;

    await this.prisma.$executeRaw(Prisma.sql`
      WITH members AS (
        SELECT a.duplicate_group_hash AS gh,
               f.asset_id,
               MAX(a.importance_score) AS importance,
               MAX(COALESCE((a.signals ->> 'duplicateSimilarity')::numeric, 0)) AS sim
        FROM finding_evidence_analyses a
        JOIN findings f ON f.id = a.finding_id
        WHERE a.duplicate_group_hash IS NOT NULL
        GROUP BY a.duplicate_group_hash, f.asset_id
      ),
      ranked AS (
        SELECT gh, asset_id, sim,
               ROW_NUMBER() OVER (PARTITION BY gh ORDER BY importance DESC) AS rn
        FROM members
      ),
      pairs AS (
        SELECT x.gh,
               LEAST(x.asset_id, y.asset_id) AS a_id,
               GREATEST(x.asset_id, y.asset_id) AS b_id,
               LEAST(x.sim, y.sim) AS sim,
               ROW_NUMBER() OVER (PARTITION BY x.gh ORDER BY x.rn, y.rn) AS pair_rn
        FROM ranked x
        JOIN ranked y ON y.gh = x.gh AND y.asset_id > x.asset_id
      )
      INSERT INTO correlation_pair_signatures (
        a_id, b_id, pattern_key, family, weighted, shared_count, labels,
        cluster_id, source_a_id, source_b_id,
        lineage_state, lineage_relation, computed_at
      )
      SELECT
        p.a_id, p.b_id,
        'boilerplate:' || left(p.gh, 8),
        'NEAR_DUPLICATE_TEXT'::"CorrelationPatternFamily",
        LEAST(1, GREATEST(0, p.sim)),
        0,
        ARRAY[]::text[],
        m.cluster_id,
        aa.source_id,
        ab.source_id,
        CASE
          WHEN la.asset_id IS NULL OR lb.asset_id IS NULL THEN 'UNKNOWN'
          WHEN la.component_id IS NULL OR lb.component_id IS NULL THEN 'UNKNOWN'
          WHEN la.component_id = lb.component_id THEN 'PATH'
          ELSE 'NO_PATH'
        END::"CorrelationLineageState",
        'UNKNOWN'::"CorrelationLineageRelation",
        ${computedAt}
      FROM pairs p
      JOIN assets aa ON aa.id = p.a_id
      JOIN assets ab ON ab.id = p.b_id
      LEFT JOIN asset_cluster_members m ON m.asset_id = p.a_id
      LEFT JOIN asset_lineage_profiles la ON la.asset_id = p.a_id
      LEFT JOIN asset_lineage_profiles lb ON lb.asset_id = p.b_id
      WHERE p.pair_rn <= ${BOILERPLATE_PAIR_CAP}
      -- A pair already explained by shared values keeps that explanation; the
      -- value overlap is the more actionable of the two.
      ON CONFLICT (a_id, b_id) DO NOTHING
    `);
  }

  // ── 4. Pattern key bucketing ──────────────────────────────────────────────

  /**
   * Collapse raw label sets into display keys.
   *
   * Sorted ALPHABETICALLY rather than by weight, deliberately. A weight-ordered
   * key changes whenever someone edits the tuning, which would rename patterns
   * under the reviewer and make the level-1 counts jump for no reason the
   * reviewer caused. Verdicts are keyed by asset pair so nothing is lost when a
   * key does drift, but the drift itself is worth avoiding.
   */
  private async applyPatternKeyBucketing(): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE correlation_pair_signatures s
      SET pattern_key = t.bucketed
      FROM (
        SELECT p.pattern_key AS raw,
               CASE
                 WHEN p.prefix <> '' THEN p.prefix || p.head
                 WHEN p.extra > 0 THEN p.head || '+' || p.extra
                 ELSE p.head
               END AS bucketed
        FROM (
          SELECT DISTINCT
            sig.pattern_key,
            CASE
              WHEN sig.pattern_key LIKE 'phonetic:%' THEN 'phonetic:'
              WHEN sig.pattern_key LIKE 'boilerplate:%' THEN 'boilerplate:'
              WHEN sig.pattern_key LIKE 'identical:%' THEN 'identical:'
              ELSE ''
            END AS prefix,
            array_to_string((string_to_array(
              regexp_replace(sig.pattern_key, '^(phonetic:|boilerplate:|identical:)', ''),
              '+'))[1:${PATTERN_LABEL_CAP}], '+') AS head,
            GREATEST(0, array_length(string_to_array(
              regexp_replace(sig.pattern_key, '^(phonetic:|boilerplate:|identical:)', ''),
              '+'), 1) - ${PATTERN_LABEL_CAP}) AS extra
          FROM correlation_pair_signatures sig
        ) p
      ) t
      WHERE s.pattern_key = t.raw AND s.pattern_key <> t.bucketed
    `);

    // A pattern is something you write one rule for. Below the floor it is just
    // a handful of pairs, and a level-1 list of those is a diagnostic again.
    //
    // The remainder bucket is per FAMILY, not global. Folding a phonetic pair
    // and a byte-identical pair into one row would produce a pattern with no
    // coherent bulk action and a family picked arbitrarily from whichever
    // member sorted first — the row would then offer the wrong rule.
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE correlation_pair_signatures s
      SET pattern_key = CASE s.family
            WHEN 'PHONETIC' THEN 'phonetic:misc'
            WHEN 'IDENTICAL_CONTENT' THEN 'identical:'
            ELSE 'misc'
          END
      WHERE s.family <> 'NEAR_DUPLICATE_TEXT'
        AND s.pattern_key IN (
          SELECT pattern_key FROM correlation_pair_signatures
          WHERE family <> 'NEAR_DUPLICATE_TEXT'
          GROUP BY pattern_key
          HAVING COUNT(*) < ${MIN_PATTERN_PAIRS}
        )
    `);
  }

  // ── 5. Rollups ────────────────────────────────────────────────────────────

  private async refreshRollups(computedAt: Date): Promise<number> {
    await this.refreshClusterPatterns();
    return this.refreshPatterns(computedAt);
  }

  private async refreshClusterPatterns(): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`TRUNCATE TABLE correlation_cluster_patterns`,
    );
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO correlation_cluster_patterns (
        cluster_id, pattern_key, pair_count, undecided_pairs, member_count,
        source_count, max_weighted, avg_weighted, shape, lineage_state, labels
      )
      SELECT
        s.cluster_id,
        s.pattern_key,
        COUNT(*)::int,
        COUNT(*) FILTER (WHERE v.a_id IS NULL)::int,
        COALESCE(MAX(c.member_count), 0),
        COALESCE(MAX(c.source_count), 0),
        MAX(s.weighted),
        AVG(s.weighted),
        -- Topology from pair count against member count. A clique is every
        -- member matching every other; a chain has ends that do not match at
        -- all, which is usually where a cluster should be cut.
        --
        -- Everything else is 'partial' — deliberately NOT named for a specific
        -- structure. Detecting a true bridge means finding an articulation
        -- point, which is not something to do in this aggregate; labelling the
        -- catch-all 'bridge' would put a precise structural claim on screen
        -- for every cluster that merely failed the two cheap tests above.
        CASE
          WHEN COALESCE(MAX(c.member_count), 0) = 2 THEN 'pair'
          WHEN COUNT(*) = MAX(c.member_count) * (MAX(c.member_count) - 1) / 2 THEN 'clique'
          WHEN COUNT(*) = MAX(c.member_count) - 1 THEN 'chain'
          ELSE 'partial'
        END,
        -- The cluster inherits the strongest claim any of its pairs makes:
        -- one unexplained pair is enough to make the cluster worth a look.
        CASE
          WHEN bool_or(s.lineage_state = 'NO_PATH') THEN 'NO_PATH'
          WHEN bool_or(s.lineage_state = 'PATH') THEN 'PATH'
          ELSE 'UNKNOWN'
        END::"CorrelationLineageState",
        COALESCE(ARRAY(
          SELECT DISTINCT unnest(s2.labels)
          FROM correlation_pair_signatures s2
          WHERE s2.cluster_id = s.cluster_id
          ORDER BY 1
        ), ARRAY[]::text[])
      FROM correlation_pair_signatures s
      LEFT JOIN asset_clusters c ON c.id = s.cluster_id
      LEFT JOIN correlation_pair_verdicts v ON v.a_id = s.a_id AND v.b_id = s.b_id
      WHERE s.cluster_id IS NOT NULL
      GROUP BY s.cluster_id, s.pattern_key
    `);
  }

  private async refreshPatterns(computedAt: Date): Promise<number> {
    await this.prisma.$executeRaw(Prisma.sql`TRUNCATE TABLE correlation_patterns`);
    await this.prisma.$executeRaw(Prisma.sql`
      WITH buckets AS (
        SELECT s.pattern_key,
               b.bucket,
               COUNT(s.a_id)::int AS pairs,
               COUNT(v.a_id)::int AS decided,
               COUNT(DISTINCT s.cluster_id)::int AS clusters
        FROM (SELECT generate_series(0, ${SCORE_BUCKET_COUNT - 1}) AS bucket) b
        -- LEFT JOIN, not a filter: an empty bin must still emit a zero, or the
        -- histogram silently shifts and every cutoff lands on the wrong bar.
        LEFT JOIN correlation_pair_signatures s
          ON LEAST(${SCORE_BUCKET_COUNT - 1}, FLOOR(s.weighted * ${SCORE_BUCKET_COUNT})::int) = b.bucket
        LEFT JOIN correlation_pair_verdicts v ON v.a_id = s.a_id AND v.b_id = s.b_id
        WHERE s.pattern_key IS NOT NULL
        GROUP BY s.pattern_key, b.bucket
      ),
      series AS (
        SELECT k.pattern_key, b.bucket
        FROM (SELECT DISTINCT pattern_key FROM correlation_pair_signatures) k
        CROSS JOIN (SELECT generate_series(0, ${SCORE_BUCKET_COUNT - 1}) AS bucket) b
      ),
      filled AS (
        SELECT se.pattern_key, se.bucket,
               COALESCE(bu.pairs, 0) AS pairs,
               COALESCE(bu.decided, 0) AS decided,
               COALESCE(bu.clusters, 0) AS clusters
        FROM series se
        LEFT JOIN buckets bu
          ON bu.pattern_key = se.pattern_key AND bu.bucket = se.bucket
      ),
      hist AS (
        SELECT pattern_key,
               array_agg(pairs ORDER BY bucket) AS score_buckets,
               array_agg(decided ORDER BY bucket) AS decided_buckets,
               array_agg(clusters ORDER BY bucket) AS cluster_buckets
        FROM filled GROUP BY pattern_key
      ),
      agg AS (
        SELECT s.pattern_key,
               -- Safe because the remainder buckets are family-scoped, so a
               -- pattern key never spans two families.
               MIN(s.family::text) AS family,
               COALESCE((SELECT ARRAY(
                 SELECT DISTINCT unnest(s3.labels) FROM correlation_pair_signatures s3
                 WHERE s3.pattern_key = s.pattern_key ORDER BY 1
               )), ARRAY[]::text[]) AS labels,
               COUNT(*)::int AS pair_count,
               COUNT(DISTINCT s.cluster_id)::int AS cluster_count,
               AVG(s.weighted) AS avg_weighted,
               MAX(s.weighted) AS max_weighted,
               COUNT(*) FILTER (WHERE s.lineage_state = 'PATH')::int AS path_pairs,
               COUNT(*) FILTER (WHERE s.lineage_state = 'NO_PATH')::int AS no_path_pairs,
               COUNT(*) FILTER (WHERE s.lineage_state = 'UNKNOWN')::int AS unknown_pairs
        FROM correlation_pair_signatures s
        GROUP BY s.pattern_key
      ),
      assets AS (
        SELECT pattern_key, COUNT(DISTINCT id)::int AS asset_count FROM (
          SELECT pattern_key, a_id AS id FROM correlation_pair_signatures
          UNION ALL
          SELECT pattern_key, b_id AS id FROM correlation_pair_signatures
        ) u GROUP BY pattern_key
      ),
      shapes AS (
        SELECT pattern_key, mode() WITHIN GROUP (ORDER BY shape) AS shape
        FROM correlation_cluster_patterns GROUP BY pattern_key
      )
      INSERT INTO correlation_patterns (
        pattern_key, family, labels, pair_count, cluster_count, asset_count,
        true_pair_count, avg_weighted, max_weighted,
        score_buckets, decided_buckets, cluster_buckets,
        lineage_path_pairs, lineage_no_path_pairs, lineage_unknown_pairs,
        topology_shape, rule_kind, computed_at
      )
      SELECT
        agg.pattern_key,
        agg.family::"CorrelationPatternFamily",
        agg.labels,
        agg.pair_count,
        agg.cluster_count,
        COALESCE(assets.asset_count, 0),
        agg.pair_count,
        agg.avg_weighted,
        agg.max_weighted,
        hist.score_buckets, hist.decided_buckets, hist.cluster_buckets,
        agg.path_pairs, agg.no_path_pairs, agg.unknown_pairs,
        COALESCE(shapes.shape, 'mixed'),
        -- What the bulk action can offer. Boilerplate has a real fix (stop the
        -- text from matching at all); byte-identical content needs no judgement;
        -- a single very tight label set is a threshold question; the rest is a
        -- human call and the card must not pretend otherwise.
        CASE
          WHEN agg.family = 'NEAR_DUPLICATE_TEXT' THEN 'EXCLUSION'
          WHEN agg.family = 'IDENTICAL_CONTENT' THEN 'MERGE'
          WHEN agg.avg_weighted >= 0.85 THEN 'THRESHOLD'
          ELSE 'JUDGEMENT'
        END,
        ${computedAt}
      FROM agg
      JOIN hist ON hist.pattern_key = agg.pattern_key
      LEFT JOIN assets ON assets.pattern_key = agg.pattern_key
      LEFT JOIN shapes ON shapes.pattern_key = agg.pattern_key
    `);

    // Boilerplate pair counts are capped per group; restore the true size so
    // the level-1 row does not understate the pattern's reach.
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE correlation_patterns p
      SET true_pair_count = t.true_pairs
      FROM (
        SELECT 'boilerplate:' || left(a.duplicate_group_hash, 8) AS pattern_key,
               (COUNT(DISTINCT f.asset_id) * (COUNT(DISTINCT f.asset_id) - 1) / 2)::int AS true_pairs
        FROM finding_evidence_analyses a
        JOIN findings f ON f.id = a.finding_id
        WHERE a.duplicate_group_hash IS NOT NULL
        GROUP BY a.duplicate_group_hash
      ) t
      WHERE p.pattern_key = t.pattern_key AND t.true_pairs > p.pair_count
    `);

    const [{ count }] = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT COUNT(*)::bigint AS count FROM correlation_patterns`,
    );
    return Number(count);
  }

  /**
   * Which systems the duplicates run between.
   *
   * Nodes are sources, not assets. Duplicates concentrated between two systems
   * point at a real integration problem with a findable cause; duplicates spread
   * evenly across every pairing point at the matcher instead. Two very different
   * responses, and nothing else on the page distinguishes them.
   */
  private async refreshSourcePairs(): Promise<void> {
    await this.prisma.$executeRaw(
      Prisma.sql`TRUNCATE TABLE correlation_source_pairs`,
    );
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO correlation_source_pairs (source_a_id, source_b_id, pair_count, asset_count)
      SELECT LEAST(source_a_id, source_b_id),
             GREATEST(source_a_id, source_b_id),
             COUNT(*)::int,
             COUNT(DISTINCT a_id) + COUNT(DISTINCT b_id)
      FROM correlation_pair_signatures
      GROUP BY 1, 2
    `);
  }
}
