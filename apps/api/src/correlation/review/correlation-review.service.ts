import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { UnionFind } from '../../utils/union-find';
import { CorrelationService } from '../correlation.service';
import { DuplicatesFinderAgentService } from '../duplicates-finder-agent.service';
import { InquiriesService } from '../../inquiries.service';
import { AI_ACTOR, originOf } from '../../autopilot/autopilot.constants';
import {
  AGENT_SAFE_BAND_MIN,
  SCORE_BUCKET_COUNT,
} from '../correlation.constants';
import {
  normalizeLabel,
  normalizeValue,
  valueHash,
} from '../value-normalizer';
import { buildWaterfall } from './waterfall';
import {
  REVIEW_VERDICTS,
  type ReviewVerdictName,
} from '../../dto/correlation-review.dto';
import type {
  DecisionsToCaseDto,
  PatternExclusionCandidatesResponseDto,
  DecisionsToInquiryDto,
  RejectCauseDto,
  ReviewDecisionsResponseDto,
  PatternActionDto,
  PatternApplyResponseDto,
  PatternPreviewResponseDto,
  RecordVerdictDto,
  RecordVerdictResponseDto,
  ReviewClustersResponseDto,
  ReviewPairResponseDto,
  ReviewPortfolioResponseDto,
  ReviewSampleResponseDto,
  SplitPairResponseDto,
  UndoBatchResponseDto,
  UndoLogResponseDto,
} from '../../dto/correlation-review.dto';

const ASSET_REL = 'asset';

/** The relation types the scorer writes; the only ones carrying a decomposition. */
const REVIEWABLE_RELATION_TYPES = [
  'related',
  'likely_duplicate',
  'identical_content',
];
const EGO_NODE_CAP = 12;
/** Pattern-key prefix for a near-duplicate text group; the rest is its hash. */
const BOILERPLATE_PREFIX = 'boilerplate:';
/**
 * Findings read out of one near-duplicate group when deriving what it contains.
 *
 * A template on ten thousand documents produces a group of that size, and the
 * DISTINCT values inside it converge long before the end — the thousandth copy
 * of the same footer contributes nothing the first ten did not. Reading the
 * whole group to learn the same handful of values would be a scan for no
 * information, so it is capped and the response says when it was.
 */
const GROUP_FINDING_CAP = 2000;
/** Values offered for exclusion, and the most one action may write. */
const EXCLUSION_CANDIDATE_CAP = 25;
const VALUES_PER_SIDE_CAP = 200;
/** A re-score this far from the recorded one makes a standing verdict suspect. */
const STALE_SCORE_DELTA = 0.1;

interface PairKey {
  aId: string;
  bId: string;
}

/**
 * Read and write side of the fingerprints review queue.
 *
 * Kept out of CorrelationService, which is already 2,600 lines and owns a
 * different job: that one computes, this one presents and records decisions.
 *
 * There is no global ValidationPipe in this application, so every input that
 * reaches here is normalised defensively rather than trusted.
 */
@Injectable()
export class CorrelationReviewService {
  private readonly logger = new Logger(CorrelationReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly correlation: CorrelationService,
    private readonly duplicatesFinder: DuplicatesFinderAgentService,
    private readonly inquiries: InquiriesService,
  ) {}

  // ── Normalisation ─────────────────────────────────────────────────────────

  private unit(value: unknown, fallback: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, n));
  }

  private lineageFilter(value: unknown): string | null {
    return value === 'PATH' || value === 'NO_PATH' || value === 'UNKNOWN'
      ? value
      : null;
  }

  /**
   * Edges are written with `aId` < `bId`, so a request naming the pair the
   * other way round has to be normalised or it silently finds nothing.
   */
  private canonical(aId: string, bId: string): PairKey {
    return aId <= bId ? { aId, bId } : { aId: bId, bId: aId };
  }

  private cleanPairs(input: unknown): PairKey[] {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const out: PairKey[] = [];
    for (const raw of input) {
      const a = (raw as { aId?: unknown })?.aId;
      const b = (raw as { bId?: unknown })?.bId;
      if (typeof a !== 'string' || typeof b !== 'string') continue;
      if (!a || !b || a === b) continue;
      const key = this.canonical(a, b);
      const k = `${key.aId}|${key.bId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(key);
    }
    return out;
  }

  /**
   * The verdict, or a 400.
   *
   * This application registers no global ValidationPipe, so the `@IsIn` on the
   * DTO never executes — the value arrives exactly as the caller sent it and
   * is written straight into a Postgres enum column. Without this check a
   * misspelled verdict surfaced as a 500 from Prisma rather than a 400 naming
   * the bad field, and any caller could trigger it.
   */
  private assertVerdict(value: unknown): ReviewVerdictName {
    if (
      typeof value === 'string' &&
      (REVIEW_VERDICTS as readonly string[]).includes(value)
    ) {
      return value as ReviewVerdictName;
    }
    throw new BadRequestException(
      `verdict must be one of ${REVIEW_VERDICTS.join(', ')}`,
    );
  }

  /** Ids the caller narrowed to, cleaned; empty means no narrowing. */
  private cleanSourceIds(input: unknown): string[] {
    const raw = Array.isArray(input)
      ? input
      : typeof input === 'string' && input
        ? input.split(',')
        : [];
    return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
  }

  /**
   * Pairs touching any of these sources — either side counts.
   *
   * "Show me the duplicates involving this system" means a pair with one foot
   * in it, not only pairs wholly inside it; restricting to both sides would
   * hide exactly the cross-system pairs the breakdown is pointing at.
   */
  private sourceFilterSql(sourceIds: string[]) {
    if (sourceIds.length === 0) return Prisma.empty;
    return Prisma.sql`AND (s.source_a_id IN (${Prisma.join(sourceIds)})
                        OR s.source_b_id IN (${Prisma.join(sourceIds)}))`;
  }

  // ── Work remaining ────────────────────────────────────────────────────────

  /**
   * Undecided scored pairs. This is the number the whole page leads with, so
   * it is counted rather than estimated.
   */
  private async workRemaining(): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM correlation_pair_signatures s
        LEFT JOIN correlation_pair_verdicts v
          ON v.a_id = s.a_id AND v.b_id = s.b_id
        WHERE v.a_id IS NULL
      `,
    );
    return Number(row?.count ?? 0);
  }

  /**
   * Rebuild the rollups on demand.
   *
   * The index refreshes itself as part of every recompute, but a namespace
   * scanned before this feature existed has correlation data and no rollups,
   * and waiting for the next scan is not an answer when someone is looking at
   * an empty queue right now.
   */
  async rebuild() {
    return this.correlation.refreshReviewIndexNow();
  }

  // ── Level 1 ───────────────────────────────────────────────────────────────

  async portfolio(query?: {
    sourceIds?: unknown;
  }): Promise<ReviewPortfolioResponseDto> {
    const sourceIds = this.cleanSourceIds(query?.sourceIds);
    const totalsFilter = this.sourceFilterSql(sourceIds);
    const [patterns, sourcePairs, sources, config, totals] = await Promise.all([
      // Unfiltered, the pattern rollups are read straight off their own table.
      // Filtered, they are recomputed from the (narrow, indexed) signature
      // table — the rollup has no source dimension, and adding one would mean
      // patterns x sources rows for a view that is not the default path.
      sourceIds.length === 0
        ? this.prisma.correlationPattern.findMany({
            orderBy: { pairCount: 'desc' },
          })
        : this.patternsForSources(sourceIds),
      this.prisma.correlationSourcePair.findMany(),
      this.prisma.source.findMany({
        select: { id: true, name: true, type: true },
      }),
      this.correlation.getConfig(),
      // Totals honour the same filter as the pattern list. A filtered list
      // over unfiltered totals would put a duplicate rate on screen that
      // describes a different population than the rows underneath it — and
      // would leave the empty state unreachable when a filter matches nothing.
      this.prisma.$queryRaw<
        Array<{
          total_pairs: bigint;
          decided_pairs: bigint;
          decided_by_agent: bigint;
          assets_affected: bigint;
          total_assets: bigint;
        }>
      >(Prisma.sql`
        SELECT
          (SELECT COUNT(*) FROM correlation_pair_signatures s
            WHERE TRUE ${totalsFilter})::bigint AS total_pairs,
          (SELECT COUNT(*) FROM correlation_pair_verdicts v
             WHERE EXISTS (SELECT 1 FROM correlation_pair_signatures s
                           WHERE s.a_id = v.a_id AND s.b_id = v.b_id
                             ${totalsFilter}))::bigint AS decided_pairs,
          (SELECT COUNT(*) FROM correlation_pair_verdicts v
             WHERE v.decided_by = ${AI_ACTOR}
               AND EXISTS (SELECT 1 FROM correlation_pair_signatures s
                           WHERE s.a_id = v.a_id AND s.b_id = v.b_id
                             ${totalsFilter}))::bigint AS decided_by_agent,
          (SELECT COUNT(*) FROM (
             SELECT s.a_id AS id FROM correlation_pair_signatures s
               WHERE TRUE ${totalsFilter}
             UNION
             SELECT s.b_id FROM correlation_pair_signatures s
               WHERE TRUE ${totalsFilter}) u)::bigint AS assets_affected,
          (SELECT COUNT(*) FROM assets)::bigint AS total_assets
      `),
    ]);

    const sourceById = new Map(sources.map((s) => [s.id, s]));
    const nodeCounts = new Map<string, number>();
    const internalCounts = new Map<string, number>();
    for (const p of sourcePairs) {
      nodeCounts.set(
        p.sourceAId,
        (nodeCounts.get(p.sourceAId) ?? 0) + p.pairCount,
      );
      if (p.sourceBId === p.sourceAId) {
        // Duplicates inside one system are a different problem from duplicates
        // between two, so they are counted separately rather than folded in.
        internalCounts.set(p.sourceAId, p.pairCount);
      } else {
        nodeCounts.set(
          p.sourceBId,
          (nodeCounts.get(p.sourceBId) ?? 0) + p.pairCount,
        );
      }
    }
    const totalSourcePairs = sourcePairs.reduce((a, p) => a + p.pairCount, 0);
    const heaviest = sourcePairs.reduce((a, p) => Math.max(a, p.pairCount), 0);

    const t = totals[0];
    return {
      patterns: patterns.map((p) => ({
        patternKey: p.patternKey,
        family: p.family,
        labels: p.labels,
        pairCount: p.pairCount,
        truePairCount: p.truePairCount,
        clusterCount: p.clusterCount,
        assetCount: p.assetCount,
        avgWeighted: Number(p.avgWeighted),
        maxWeighted: Number(p.maxWeighted),
        scoreBuckets: p.scoreBuckets,
        decidedBuckets: p.decidedBuckets,
        clusterBuckets: p.clusterBuckets,
        lineagePathPairs: p.lineagePathPairs,
        lineageNoPathPairs: p.lineageNoPathPairs,
        lineageUnknownPairs: p.lineageUnknownPairs,
        topologyShape: p.topologyShape,
        ruleKind: p.ruleKind,
      })),
      sources: {
        nodes: Array.from(nodeCounts.entries()).map(([id, pairCount]) => ({
          id,
          name: sourceById.get(id)?.name ?? id,
          type: sourceById.get(id)?.type ?? 'filesystem',
          pairCount,
          internalPairs: internalCounts.get(id) ?? 0,
        })),
        edges: sourcePairs.map((p) => ({
          sourceAId: p.sourceAId,
          sourceBId: p.sourceBId,
          pairCount: p.pairCount,
          assetCount: p.assetCount,
        })),
        topShare: totalSourcePairs > 0 ? heaviest / totalSourcePairs : 0,
      },
      totalPairs: Number(t?.total_pairs ?? 0),
      decidedPairs: Number(t?.decided_pairs ?? 0),
      decidedByAgent: Number(t?.decided_by_agent ?? 0),
      assetsAffected: Number(t?.assets_affected ?? 0),
      totalAssets: Number(t?.total_assets ?? 0),
      relatedMin: config.relatedMin,
      duplicateMin: config.duplicateMin,
      computedAt: patterns[0]?.computedAt?.toISOString() ?? null,
      // A dominant lineage component means the derivation test could not be
      // trusted, and the UI has to say so rather than showing UNKNOWN as if it
      // were a property of the data.
      lineageHairball: await this.hairballActive(),
    };
  }

  /**
   * Pattern rollups recomputed for a source selection.
   *
   * Returns the same shape the rollup table does so the caller cannot tell the
   * difference, including the bucket arrays the client does its cutoff
   * arithmetic on — a filtered view whose histogram still described the whole
   * corpus would make every count on the page wrong.
   */
  private async patternsForSources(sourceIds: string[]) {
    const where = this.sourceFilterSql(sourceIds);
    const rows = await this.prisma.$queryRaw<
      Array<{
        pattern_key: string;
        family: string;
        labels: string[];
        pair_count: number;
        cluster_count: number;
        asset_count: number;
        avg_weighted: string;
        max_weighted: string;
        score_buckets: number[];
        decided_buckets: number[];
        cluster_buckets: number[];
        path_pairs: number;
        no_path_pairs: number;
        unknown_pairs: number;
      }>
    >(Prisma.sql`
      WITH scoped AS (
        SELECT s.*,
               LEAST(${SCORE_BUCKET_COUNT - 1},
                     FLOOR(s.weighted * ${SCORE_BUCKET_COUNT})::int) AS bucket,
               (v.a_id IS NOT NULL) AS decided
        FROM correlation_pair_signatures s
        LEFT JOIN correlation_pair_verdicts v
          ON v.a_id = s.a_id AND v.b_id = s.b_id
        WHERE TRUE ${where}
      ),
      bins AS (
        SELECT k.pattern_key, b.bucket,
               COUNT(sc.a_id)::int AS pairs,
               COUNT(sc.a_id) FILTER (WHERE sc.decided)::int AS decided,
               COUNT(DISTINCT sc.cluster_id)::int AS clusters
        FROM (SELECT DISTINCT pattern_key FROM scoped) k
        CROSS JOIN (SELECT generate_series(0, ${SCORE_BUCKET_COUNT - 1}) AS bucket) b
        LEFT JOIN scoped sc
          ON sc.pattern_key = k.pattern_key AND sc.bucket = b.bucket
        GROUP BY k.pattern_key, b.bucket
      ),
      hist AS (
        SELECT pattern_key,
               array_agg(pairs ORDER BY bucket) AS score_buckets,
               array_agg(decided ORDER BY bucket) AS decided_buckets,
               array_agg(clusters ORDER BY bucket) AS cluster_buckets
        FROM bins GROUP BY pattern_key
      ),
      assets AS (
        SELECT pattern_key, COUNT(DISTINCT id)::int AS asset_count FROM (
          SELECT pattern_key, a_id AS id FROM scoped
          UNION ALL SELECT pattern_key, b_id FROM scoped
        ) u GROUP BY pattern_key
      )
      SELECT sc.pattern_key,
             MIN(sc.family::text) AS family,
             COALESCE((SELECT ARRAY(SELECT DISTINCT unnest(s2.labels)
                                    FROM scoped s2
                                    WHERE s2.pattern_key = sc.pattern_key
                                    ORDER BY 1)), ARRAY[]::text[]) AS labels,
             COUNT(*)::int AS pair_count,
             COUNT(DISTINCT sc.cluster_id)::int AS cluster_count,
             COALESCE(MAX(a.asset_count), 0) AS asset_count,
             AVG(sc.weighted)::text AS avg_weighted,
             MAX(sc.weighted)::text AS max_weighted,
             MAX(h.score_buckets::text)::int[] AS score_buckets,
             MAX(h.decided_buckets::text)::int[] AS decided_buckets,
             MAX(h.cluster_buckets::text)::int[] AS cluster_buckets,
             COUNT(*) FILTER (WHERE sc.lineage_state = 'PATH')::int AS path_pairs,
             COUNT(*) FILTER (WHERE sc.lineage_state = 'NO_PATH')::int AS no_path_pairs,
             COUNT(*) FILTER (WHERE sc.lineage_state = 'UNKNOWN')::int AS unknown_pairs
      FROM scoped sc
      JOIN hist h ON h.pattern_key = sc.pattern_key
      LEFT JOIN assets a ON a.pattern_key = sc.pattern_key
      GROUP BY sc.pattern_key
      ORDER BY pair_count DESC
    `);

    const now = new Date();
    return rows.map((r) => ({
      patternKey: r.pattern_key,
      family: r.family as never,
      labels: r.labels ?? [],
      pairCount: r.pair_count,
      truePairCount: r.pair_count,
      clusterCount: r.cluster_count,
      assetCount: r.asset_count,
      avgWeighted: new Prisma.Decimal(r.avg_weighted ?? 0),
      maxWeighted: new Prisma.Decimal(r.max_weighted ?? 0),
      scoreBuckets: r.score_buckets ?? [],
      decidedBuckets: r.decided_buckets ?? [],
      clusterBuckets: r.cluster_buckets ?? [],
      lineagePathPairs: r.path_pairs,
      lineageNoPathPairs: r.no_path_pairs,
      lineageUnknownPairs: r.unknown_pairs,
      topologyShape: 'mixed',
      ruleKind: 'JUDGEMENT',
      computedAt: now,
    }));
  }

  private async hairballActive(): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<Array<{ demoted: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS demoted
        FROM asset_lineage_profiles
        WHERE component_id IS NULL AND degree > 0
      `,
    );
    return Number(row?.demoted ?? 0) > 0;
  }

  // ── Level 2 ───────────────────────────────────────────────────────────────

  async clusters(
    patternKey: string,
    query: {
      min?: unknown;
      max?: unknown;
      lineage?: unknown;
      cursor?: unknown;
      limit?: unknown;
      sourceIds?: unknown;
    },
  ): Promise<ReviewClustersResponseDto> {
    const min = this.unit(query.min, 0);
    const max = this.unit(query.max, 1);
    const lineage = this.lineageFilter(query.lineage);
    const limitRaw = Number(query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(200, Math.max(1, Math.trunc(limitRaw)))
      : 50;
    const cursor = typeof query.cursor === 'string' ? query.cursor : null;

    // Filter on whether the cluster HAS pairs in the band, not on whether its
    // own max score falls in it. A cluster holding one perfect match and forty
    // borderline ones has maxWeighted = 1, and matching that against the review
    // band excluded it entirely — so a pattern with hundreds of reviewable
    // pairs showed an empty list, which read as "no information" rather than
    // as a filter doing something surprising.
    const inBand = await this.prisma.$queryRaw<Array<{ cluster_id: string }>>(
      Prisma.sql`
        SELECT DISTINCT s.cluster_id
        FROM correlation_pair_signatures s
        WHERE s.pattern_key = ${patternKey}
          AND s.cluster_id IS NOT NULL
          AND s.weighted BETWEEN ${min} AND ${max}
          ${
            lineage
              ? Prisma.sql`AND s.lineage_state = ${lineage}::"CorrelationLineageState"`
              : Prisma.empty
          }
          ${this.sourceFilterSql(this.cleanSourceIds(query.sourceIds))}
      `,
    );
    const bandClusterIds = inBand.map((r) => r.cluster_id);
    if (bandClusterIds.length === 0) {
      return { rows: [], nextCursor: null, total: 0 };
    }

    const rows = await this.prisma.correlationClusterPattern.findMany({
      where: {
        patternKey,
        clusterId: {
          in: bandClusterIds,
          ...(cursor ? { gt: cursor } : {}),
        },
        ...(lineage ? { lineageState: lineage as never } : {}),
      },
      orderBy: [
        { undecidedPairs: 'desc' },
        { maxWeighted: 'desc' },
        { clusterId: 'asc' },
      ],
      take: limit + 1,
    });

    const page = rows.slice(0, limit);
    const members = page.length
      ? await this.prisma.assetClusterMember.findMany({
          where: { clusterId: { in: page.map((r) => r.clusterId) } },
          select: { clusterId: true, assetId: true },
        })
      : [];
    const byCluster = new Map<string, string[]>();
    for (const m of members) {
      const list = byCluster.get(m.clusterId) ?? [];
      if (list.length < 4) list.push(m.assetId);
      byCluster.set(m.clusterId, list);
    }

    const total = await this.prisma.correlationClusterPattern.count({
      where: {
        patternKey,
        clusterId: { in: bandClusterIds },
        ...(lineage ? { lineageState: lineage as never } : {}),
      },
    });

    return {
      rows: page.map((r) => ({
        clusterId: r.clusterId,
        patternKey: r.patternKey,
        pairCount: r.pairCount,
        undecidedPairs: r.undecidedPairs,
        memberCount: r.memberCount,
        sourceCount: r.sourceCount,
        maxWeighted: Number(r.maxWeighted),
        avgWeighted: Number(r.avgWeighted),
        shape: r.shape,
        lineageState: r.lineageState,
        labels: r.labels,
        sampleAssetIds: byCluster.get(r.clusterId) ?? [],
      })),
      nextCursor: rows.length > limit ? page.at(-1)!.clusterId : null,
      total,
    };
  }

  /** The next undecided pairs in a pattern, strongest first. */
  async sample(
    patternKey: string,
    query: {
      n?: unknown;
      min?: unknown;
      max?: unknown;
      lineage?: unknown;
      sourceIds?: unknown;
    },
  ): Promise<ReviewSampleResponseDto> {
    const sourceFilter = this.sourceFilterSql(
      this.cleanSourceIds(query.sourceIds),
    );
    const min = this.unit(query.min, 0);
    const max = this.unit(query.max, 1);
    const lineage = this.lineageFilter(query.lineage);
    const nRaw = Number(query.n);
    const n = Number.isFinite(nRaw)
      ? Math.min(100, Math.max(1, Math.trunc(nRaw)))
      : 5;

    const lineageSql = lineage
      ? Prisma.sql`AND s.lineage_state = ${lineage}::"CorrelationLineageState"`
      : Prisma.empty;

    const pairs = await this.prisma.$queryRaw<
      Array<{
        a_id: string;
        b_id: string;
        weighted: string;
        lineage_state: string;
        labels: string[];
        cluster_id: string | null;
      }>
    >(Prisma.sql`
      SELECT s.a_id, s.b_id, s.weighted::text, s.lineage_state::text,
             s.labels, s.cluster_id
      FROM correlation_pair_signatures s
      WHERE s.pattern_key = ${patternKey}
        AND s.weighted BETWEEN ${min} AND ${max}
        ${lineageSql}
        ${sourceFilter}
        AND NOT EXISTS (
          SELECT 1 FROM correlation_pair_verdicts v
          WHERE v.a_id = s.a_id AND v.b_id = s.b_id
        )
      ORDER BY s.weighted DESC, s.a_id
      LIMIT ${n}
    `);

    const [count] = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM correlation_pair_signatures s
        WHERE s.pattern_key = ${patternKey}
          AND s.weighted BETWEEN ${min} AND ${max}
          ${lineageSql}
          ${sourceFilter}
          AND NOT EXISTS (
            SELECT 1 FROM correlation_pair_verdicts v
            WHERE v.a_id = s.a_id AND v.b_id = s.b_id
          )
      `,
    );

    // The values both sides hold, resolved in one query for the whole page
    // rather than per row — the reviewer needs to see what matched, and a
    // per-pair lookup here would be fifty round trips.
    const assetIds = [...new Set(pairs.flatMap((p) => [p.a_id, p.b_id]))];
    const sharedByPair = new Map<string, string[]>();
    if (pairs.length > 0) {
      const values = await this.prisma.assetCorrelationValue.findMany({
        where: { assetId: { in: assetIds } },
        select: { assetId: true, normalizedValue: true },
        take: assetIds.length * 200,
      });
      const byAsset = new Map<string, Set<string>>();
      for (const v of values) {
        const set = byAsset.get(v.assetId) ?? new Set<string>();
        set.add(v.normalizedValue);
        byAsset.set(v.assetId, set);
      }
      for (const p of pairs) {
        const a = byAsset.get(p.a_id);
        const b = byAsset.get(p.b_id);
        sharedByPair.set(
          `${p.a_id}|${p.b_id}`,
          a && b ? [...a].filter((x) => b.has(x)).slice(0, 12) : [],
        );
      }
    }

    const names = pairs.length
      ? await this.prisma.asset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = new Map<string, string>(
      names.map((a) => [a.id, a.name] as const),
    );

    return {
      pairs: pairs.map((p) => ({
        aId: p.a_id,
        bId: p.b_id,
        aName: nameOf.get(p.a_id) ?? p.a_id,
        bName: nameOf.get(p.b_id) ?? p.b_id,
        weighted: Number(p.weighted),
        lineageState: p.lineage_state,
        labels: p.labels ?? [],
        sharedValues: sharedByPair.get(`${p.a_id}|${p.b_id}`) ?? [],
        clusterId: p.cluster_id,
      })),
      undecidedTotal: Number(count?.count ?? 0),
    };
  }

  // ── Level 3 ───────────────────────────────────────────────────────────────

  async pair(aIdRaw: string, bIdRaw: string): Promise<ReviewPairResponseDto> {
    const { aId, bId } = this.canonical(aIdRaw, bIdRaw);
    if (aId === bId) throw new NotFoundException('A pair needs two assets');

    const signature = await this.prisma.correlationPairSignature.findUnique({
      where: { aId_bId: { aId, bId } },
    });
    if (!signature) {
      throw new NotFoundException('That pair is not in the review index');
    }

    const [assets, edge, profiles, values, lineageProfiles, verdict, config] =
      await Promise.all([
        this.prisma.asset.findMany({
          where: { id: { in: [aId, bId] } },
          select: {
            id: true,
            name: true,
            assetType: true,
            sourceId: true,
            externalUrl: true,
            source: { select: { name: true } },
          },
        }),
        // Must be filtered by relation type. Two assets can be joined by more
        // than one edge — and a pair the lineage graph explains has BOTH a
        // correlation edge and a FLOW edge between the same ids. Taking
        // whichever came first would pick up the lineage edge, whose metadata
        // carries no scoring, and the decomposition would silently render
        // empty on precisely the derived-copy pairs that are most common.
        this.prisma.edge.findFirst({
          where: {
            fromType: ASSET_REL,
            toType: ASSET_REL,
            fromId: aId,
            toId: bId,
            relationType: { in: REVIEWABLE_RELATION_TYPES },
          },
          orderBy: { confidence: 'desc' },
          select: { metadata: true, relationType: true },
        }),
        this.prisma.assetLabelProfile.findMany({
          where: { assetId: { in: [aId, bId] } },
        }),
        this.prisma.assetCorrelationValue.findMany({
          where: { assetId: { in: [aId, bId] } },
          select: {
            assetId: true,
            label: true,
            normalizedValue: true,
            valueHash: true,
          },
          take: VALUES_PER_SIDE_CAP * 2,
        }),
        this.prisma.assetLineageProfile.findMany({
          where: { assetId: { in: [aId, bId] } },
        }),
        this.prisma.correlationPairVerdict.findUnique({
          where: { aId_bId: { aId, bId } },
        }),
        this.correlation.getConfig(),
      ]);

    const assetById = new Map(assets.map((a) => [a.id, a]));
    const a = assetById.get(aId);
    const b = assetById.get(bId);
    if (!a || !b) throw new NotFoundException('One of those assets is gone');

    const weightOf = (label: string): number =>
      config.labels.find((l) => l.label === label)?.weight ??
      config.defaultWeight;

    const lineageA = lineageProfiles.find((p) => p.assetId === aId);
    const lineageB = lineageProfiles.find((p) => p.assetId === bId);

    const waterfall = buildWaterfall({
      metadata: (edge?.metadata ?? {}) as Record<string, unknown>,
      storedScore: Number(signature.weighted),
      profiles: profiles.map((p) => ({
        assetId: p.assetId,
        label: p.label,
        nfCount: p.nfCount,
      })),
      aId,
      bId,
      weightOf,
    });

    const sharedRoots = (lineageA?.upstreamRoots ?? []).filter((r) =>
      (lineageB?.upstreamRoots ?? []).includes(r),
    );

    return {
      a: this.toPairAsset(a, lineageA?.degree ?? 0),
      b: this.toPairAsset(b, lineageB?.degree ?? 0),
      patternKey: signature.patternKey,
      // The exact score, from the same numbers the bars are built from, so the
      // headline and the decomposition below it cannot disagree. The signature
      // carries a three-decimal copy for ordering and filtering; rounding is
      // fine for deciding what comes next in a queue and not fine for a number
      // a reviewer is asked to reconcile against a set of bars.
      weighted: waterfall.rows.length
        ? waterfall.total
        : Number(signature.weighted),
      labels: signature.labels,
      clusterId: signature.clusterId,
      fields: this.buildFields(values, aId),
      waterfall,
      ego: await this.buildEgoGraph(signature.clusterId, aId, bId),
      lineage: {
        state: signature.lineageState,
        relation: signature.lineageRelation,
        sharedRoots,
        aDegree: lineageA?.degree ?? 0,
        bDegree: lineageB?.degree ?? 0,
        // Only the middle cell escalates. A pair with no lineage coverage is
        // not evidence of unexplained duplication — it is evidence of nothing.
        escalate: signature.lineageState === 'NO_PATH',
      },
      verdict: verdict?.verdict ?? null,
      verdictStale:
        verdict != null &&
        Math.abs(Number(verdict.scoreAtVerdict) - Number(signature.weighted)) >
          STALE_SCORE_DELTA,
    };
  }

  private toPairAsset(
    asset: {
      id: string;
      name: string;
      assetType: string;
      sourceId: string;
      externalUrl: string | null;
      source: { name: string } | null;
    },
    lineageDegree: number,
  ) {
    return {
      id: asset.id,
      name: asset.name,
      assetType: asset.assetType,
      sourceId: asset.sourceId,
      sourceName: asset.source?.name ?? asset.sourceId,
      externalUrl: asset.externalUrl,
      lineageDegree,
    };
  }

  private buildFields(
    values: Array<{
      assetId: string;
      label: string;
      normalizedValue: string;
      valueHash: string;
    }>,
    aId: string,
  ) {
    // Values are only fetched for the two assets in the pair, so "not A" is B.
    const byLabel = new Map<string, { a: Set<string>; b: Set<string> }>();
    const hashes = new Map<string, string>();
    for (const v of values) {
      const entry = byLabel.get(v.label) ?? { a: new Set(), b: new Set() };
      (v.assetId === aId ? entry.a : entry.b).add(v.normalizedValue);
      byLabel.set(v.label, entry);
      hashes.set(`${v.label}:${v.normalizedValue}`, v.valueHash);
    }
    return (
      Array.from(byLabel.entries())
        .map(([label, { a, b }]) => {
          const shared = [...a].filter((x) => b.has(x));
          return {
            label,
            aValues: [...a].slice(0, 20),
            bValues: [...b].slice(0, 20),
            sharedValues: shared.slice(0, 20).map((value) => ({
              value,
              valueHash: hashes.get(`${label}:${value}`) ?? '',
            })),
            differs: shared.length === 0 || a.size !== b.size,
          };
        })
        // Strongest agreement first: what matched is what the reviewer is being
        // asked to accept.
        .sort((x, y) => y.sharedValues.length - x.sharedValues.length)
    );
  }

  /**
   * The cluster around this pair, small enough to read at a glance.
   *
   * Its only job is to make one action available: cut the weak edge. So the
   * weakest edge whose removal actually splits the cluster is identified here
   * rather than left to the eye — on anything past four nodes, "which line is
   * thinnest" and "which line is holding this together" are different
   * questions.
   */
  private async buildEgoGraph(
    clusterId: string | null,
    aId: string,
    bId: string,
  ) {
    if (!clusterId) {
      return { nodes: [], edges: [], truncated: 0 };
    }
    const members = await this.prisma.assetClusterMember.findMany({
      where: { clusterId },
      select: { assetId: true },
    });
    const all = members.map((m) => m.assetId);
    // Seeds first so a big cluster still shows the pair being judged.
    const ordered = [
      aId,
      bId,
      ...all.filter((id) => id !== aId && id !== bId),
    ].filter((id, i, arr) => arr.indexOf(id) === i);
    const kept = ordered.slice(0, EGO_NODE_CAP);
    const keptSet = new Set(kept);

    const [assets, edges] = await Promise.all([
      this.prisma.asset.findMany({
        where: { id: { in: kept } },
        select: { id: true, name: true, sourceId: true },
      }),
      this.prisma.correlationPairSignature.findMany({
        where: { aId: { in: kept }, bId: { in: kept } },
        select: { aId: true, bId: true, weighted: true },
        orderBy: { weighted: 'desc' },
        take: 40,
      }),
    ]);

    const usable = edges.filter(
      (e) => keptSet.has(e.aId) && keptSet.has(e.bId),
    );
    const weakest = this.weakestBridge(kept, usable);
    const assetById = new Map(assets.map((a) => [a.id, a]));

    return {
      nodes: kept.map((id) => ({
        id,
        name: assetById.get(id)?.name ?? id,
        sourceId: assetById.get(id)?.sourceId ?? '',
        isSeed: id === aId || id === bId,
      })),
      edges: usable.map((e) => ({
        aId: e.aId,
        bId: e.bId,
        weighted: Number(e.weighted),
        isWeakest:
          weakest != null && e.aId === weakest.aId && e.bId === weakest.bId,
      })),
      truncated: Math.max(0, all.length - kept.length),
    };
  }

  /**
   * Lowest-weight edge that is a bridge — removing it disconnects the cluster.
   *
   * Brute force (drop one edge, re-run union-find) because the graph is capped
   * at twelve nodes: a proper bridge-finding algorithm would be more code for
   * no measurable gain at this size.
   */
  private weakestBridge(
    nodes: string[],
    edges: Array<{ aId: string; bId: string; weighted: Prisma.Decimal }>,
  ): { aId: string; bId: string } | null {
    if (edges.length === 0) return null;
    const componentCount = (skip: number): number => {
      const uf = new UnionFind(nodes);
      edges.forEach((e, i) => {
        if (i !== skip) uf.union(e.aId, e.bId);
      });
      return new Set(nodes.map((n) => uf.find(n))).size;
    };
    const base = componentCount(-1);
    const bridges: Array<{ aId: string; bId: string; weighted: number }> = [];
    edges.forEach((e, i) => {
      if (componentCount(i) <= base) return; // not a bridge
      bridges.push({ aId: e.aId, bId: e.bId, weighted: Number(e.weighted) });
    });
    if (bridges.length === 0) return null;
    bridges.sort((x, y) => x.weighted - y.weighted);
    return { aId: bridges[0].aId, bId: bridges[0].bId };
  }

  // ── Verdicts ──────────────────────────────────────────────────────────────

  async recordVerdicts(
    dto: RecordVerdictDto,
  ): Promise<RecordVerdictResponseDto> {
    const verdict = this.assertVerdict(dto?.verdict);
    const pairs = this.cleanPairs(dto?.pairs);
    if (pairs.length === 0) {
      return {
        batchId: '',
        applied: 0,
        skipped: 0,
        workRemaining: await this.workRemaining(),
      };
    }

    const known = await this.prisma.correlationPairSignature.findMany({
      where: { OR: pairs.map((p) => ({ aId: p.aId, bId: p.bId })) },
      select: { aId: true, bId: true, patternKey: true, weighted: true },
    });
    const skipped = pairs.length - known.length;

    const batchId = randomUUID();
    const note = typeof dto.note === 'string' ? dto.note.slice(0, 2000) : null;

    await this.prisma.$transaction([
      this.prisma.correlationReviewBatch.create({
        data: {
          id: batchId,
          action: verdict.toLowerCase(),
          patternKey: known[0]?.patternKey ?? null,
          pairCount: known.length,
          clusterCount: 0,
          assetCount: new Set(known.flatMap((k) => [k.aId, k.bId])).size,
          summary: `${verdict} on ${known.length} pair(s)`,
        },
      }),
      // A pair can be re-decided; the newest judgement wins and joins the new
      // batch, so undoing that batch restores nothing older than itself.
      this.prisma.correlationPairVerdict.deleteMany({
        where: { OR: known.map((k) => ({ aId: k.aId, bId: k.bId })) },
      }),
      this.prisma.correlationPairVerdict.createMany({
        data: known.map((k) => ({
          aId: k.aId,
          bId: k.bId,
          verdict: verdict as never,
          patternKey: k.patternKey,
          scoreAtVerdict: k.weighted,
          batchId,
          note,
        })),
        skipDuplicates: true,
      }),
    ]);

    await this.refreshUndecidedCounts();
    return {
      batchId,
      applied: known.length,
      skipped,
      workRemaining: await this.workRemaining(),
    };
  }

  /**
   * Keep the level-2 "undecided" counts in step with the verdicts just written,
   * without waiting for the next full index rebuild — the reviewer has to see
   * their own decision reflected immediately or the queue feels broken.
   */
  private async refreshUndecidedCounts(): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE correlation_cluster_patterns cp
      SET undecided_pairs = t.undecided
      FROM (
        SELECT s.cluster_id, s.pattern_key,
               COUNT(*) FILTER (WHERE v.a_id IS NULL)::int AS undecided
        FROM correlation_pair_signatures s
        LEFT JOIN correlation_pair_verdicts v
          ON v.a_id = s.a_id AND v.b_id = s.b_id
        WHERE s.cluster_id IS NOT NULL
        GROUP BY s.cluster_id, s.pattern_key
      ) t
      WHERE cp.cluster_id = t.cluster_id AND cp.pattern_key = t.pattern_key
        AND cp.undecided_pairs <> t.undecided
    `);
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE correlation_patterns p
      SET decided_buckets = t.buckets
      FROM (
        SELECT s.pattern_key, array_agg(cnt ORDER BY bucket) AS buckets
        FROM (
          SELECT k.pattern_key, b.bucket,
                 COUNT(v.a_id)::int AS cnt
          FROM (SELECT DISTINCT pattern_key FROM correlation_pair_signatures) k
          CROSS JOIN (SELECT generate_series(0, ${SCORE_BUCKET_COUNT - 1}) AS bucket) b
          LEFT JOIN correlation_pair_signatures s
            ON s.pattern_key = k.pattern_key
           AND LEAST(${SCORE_BUCKET_COUNT - 1}, FLOOR(s.weighted * ${SCORE_BUCKET_COUNT})::int) = b.bucket
          LEFT JOIN correlation_pair_verdicts v
            ON v.a_id = s.a_id AND v.b_id = s.b_id
          GROUP BY k.pattern_key, b.bucket
        ) s
        GROUP BY s.pattern_key
      ) t
      WHERE p.pattern_key = t.pattern_key
    `);
  }

  async undoLog(limit = 20): Promise<UndoLogResponseDto> {
    const n = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 20)));
    const [batches, pattern] = await Promise.all([
      this.prisma.correlationReviewBatch.findMany({
        orderBy: { createdAt: 'desc' },
        take: n,
      }),
      this.prisma.correlationPattern.findFirst({
        select: { computedAt: true },
      }),
    ]);
    const rebuiltAt = pattern?.computedAt ?? null;
    return {
      entries: batches.map((b) => ({
        id: b.id,
        action: b.action,
        patternKey: b.patternKey,
        pairCount: b.pairCount,
        clusterCount: b.clusterCount,
        assetCount: b.assetCount,
        summary: b.summary,
        createdAt: b.createdAt.toISOString(),
        undoneAt: b.undoneAt?.toISOString() ?? null,
        // Undo is not time travel. Once the index has been rebuilt the pairs a
        // batch referred to may have been re-scored or re-clustered, so the
        // entry is shown greyed rather than offered and then failing.
        undoable:
          b.undoneAt == null &&
          (rebuiltAt == null || b.createdAt.getTime() >= rebuiltAt.getTime()),
      })),
    };
  }

  async undo(batchId: string): Promise<UndoBatchResponseDto> {
    if (typeof batchId !== 'string' || !batchId) {
      throw new NotFoundException('No such batch');
    }
    const batch = await this.prisma.correlationReviewBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException('No such batch');
    if (batch.undoneAt) {
      return {
        batchId,
        reverted: 0,
        workRemaining: await this.workRemaining(),
      };
    }

    const removed = await this.prisma.correlationPairVerdict.deleteMany({
      where: { batchId },
    });

    const payload = (batch.undoPayload ?? null) as {
      kind?: string;
      edge?: Record<string, unknown>;
      // `ruleId` is the single-rule shape written before a bulk exclusion
      // could create several. Batches in that shape are still in undo logs, so
      // both are read.
      ruleId?: string;
      ruleIds?: string[];
      aId?: string;
      bId?: string;
    } | null;

    if (payload?.kind === 'split' && payload.aId && payload.bId) {
      // Deleting the SPLIT verdict above is what actually undoes the split:
      // it stops cluster union from skipping the pair. The recompute then
      // re-derives the edge from the evidence as it stands now and re-clusters
      // that neighbourhood, so the reviewer sees the change immediately rather
      // than at the next scan.
      //
      // The edge JSON in the payload is kept as an audit record of what was
      // removed, and deliberately NOT replayed: scoreAndLink deletes and
      // rewrites every correlation edge for these assets, so an inserted row
      // would be overwritten microseconds later. Re-inserting it would look
      // like a restore while changing nothing — and would be wrong in the case
      // that matters, where the evidence has since changed and the pair should
      // no longer be linked at all.
      await this.correlation.recomputeForAssets([payload.aId, payload.bId]);
    } else if (payload?.kind === 'exclusion') {
      const ruleIds = [
        ...(Array.isArray(payload.ruleIds) ? payload.ruleIds : []),
        ...(payload.ruleId ? [payload.ruleId] : []),
      ].filter((id): id is string => typeof id === 'string' && id.length > 0);
      // One write, so undoing a batch of six rules schedules one recompute
      // rather than six.
      if (ruleIds.length > 0) {
        await this.correlation.removeExclusions(ruleIds);
      }
    }

    await this.prisma.correlationReviewBatch.update({
      where: { id: batchId },
      data: { undoneAt: new Date() },
    });
    await this.refreshUndecidedCounts();

    return {
      batchId,
      reverted: removed.count,
      workRemaining: await this.workRemaining(),
    };
  }

  /**
   * Let an agent clear the safe band.
   *
   * "Safe" is deliberately narrow: a near-perfect score AND a lineage path that
   * explains it. That combination is a derived copy — a mart resembling its
   * source — where a human decision adds nothing. Anything unexplained is left
   * alone however high it scores, because an unexplained near-identical pair is
   * the single most interesting thing this tool can surface and is exactly what
   * a person should see.
   *
   * Every row is stamped AI_ACTOR so the queue can report human work and agent
   * work separately. An agent quietly inflating "work remaining: 0" would make
   * the headline number a lie.
   */
  async agentClearSafeBand(limit = 500): Promise<{
    confirmed: number;
    batchId: string | null;
    workRemaining: number;
  }> {
    const take = Math.min(5000, Math.max(1, Math.trunc(Number(limit) || 500)));
    const targets = await this.prisma.$queryRaw<
      Array<{
        a_id: string;
        b_id: string;
        weighted: string;
        pattern_key: string;
      }>
    >(Prisma.sql`
      SELECT s.a_id, s.b_id, s.weighted::text, s.pattern_key
      FROM correlation_pair_signatures s
      WHERE s.weighted >= ${AGENT_SAFE_BAND_MIN}
        AND s.lineage_state = 'PATH'::"CorrelationLineageState"
        AND NOT EXISTS (
          SELECT 1 FROM correlation_pair_verdicts v
          WHERE v.a_id = s.a_id AND v.b_id = s.b_id
        )
      ORDER BY s.weighted DESC
      LIMIT ${take}
    `);

    if (targets.length === 0) {
      return {
        confirmed: 0,
        batchId: null,
        workRemaining: await this.workRemaining(),
      };
    }

    const batchId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.correlationReviewBatch.create({
        data: {
          id: batchId,
          action: 'confirm',
          patternKey: null,
          pairCount: targets.length,
          clusterCount: 0,
          assetCount: new Set(targets.flatMap((t) => [t.a_id, t.b_id])).size,
          summary: `Agent confirmed ${targets.length} derived-copy pair(s) at or above ${AGENT_SAFE_BAND_MIN}`,
          createdBy: AI_ACTOR,
        },
      }),
      this.prisma.correlationPairVerdict.createMany({
        data: targets.map((t) => ({
          aId: t.a_id,
          bId: t.b_id,
          verdict: 'CONFIRMED' as never,
          patternKey: t.pattern_key,
          scoreAtVerdict: t.weighted,
          batchId,
          decidedBy: AI_ACTOR,
        })),
        skipDuplicates: true,
      }),
    ]);

    await this.refreshUndecidedCounts();
    this.logger.log(
      `Agent cleared ${targets.length} pair(s) in the safe band (>= ${AGENT_SAFE_BAND_MIN}, lineage-explained).`,
    );
    return {
      confirmed: targets.length,
      batchId,
      workRemaining: await this.workRemaining(),
    };
  }

  // ── Decisions: the record of what was judged ─────────────────────────────

  /**
   * Everything decided, with what became of it.
   *
   * The queue on its own is write-only: you judge a pair and it vanishes. That
   * makes the judgement worthless five minutes later — you cannot check it,
   * change your mind, or act on it. This is the other half. `unactionedOnly`
   * is the interesting filter: pairs someone confirmed as duplicates and then
   * did nothing with are exactly the backlog worth revisiting.
   */
  async decisions(query: {
    verdict?: unknown;
    patternKey?: unknown;
    unactionedOnly?: unknown;
    cursor?: unknown;
    limit?: unknown;
  }): Promise<ReviewDecisionsResponseDto> {
    const verdict = (REVIEW_VERDICTS as readonly string[]).includes(
      String(query.verdict),
    )
      ? (String(query.verdict) as ReviewVerdictName)
      : undefined;
    const patternKey =
      typeof query.patternKey === 'string' && query.patternKey
        ? query.patternKey
        : undefined;
    const unactionedOnly =
      query.unactionedOnly === true || query.unactionedOnly === 'true';
    const limitRaw = Number(query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(200, Math.max(1, Math.trunc(limitRaw)))
      : 50;
    const cursor = typeof query.cursor === 'string' ? query.cursor : null;

    const where = {
      ...(verdict ? { verdict: verdict as never } : {}),
      ...(patternKey ? { patternKey } : {}),
      ...(unactionedOnly ? { caseId: null, inquiryId: null } : {}),
      ...(cursor ? { id: { gt: cursor } } : {}),
    };

    const [rows, total, unactioned, grouped, byAgent] = await Promise.all([
      this.prisma.correlationPairVerdict.findMany({
        where,
        orderBy: [{ decidedAt: 'desc' }, { id: 'asc' }],
        take: limit + 1,
      }),
      this.prisma.correlationPairVerdict.count({
        where: {
          ...(verdict ? { verdict: verdict as never } : {}),
          ...(patternKey ? { patternKey } : {}),
          ...(unactionedOnly ? { caseId: null, inquiryId: null } : {}),
        },
      }),
      this.prisma.correlationPairVerdict.count({
        where: { caseId: null, inquiryId: null },
      }),
      this.prisma.correlationPairVerdict.groupBy({
        by: ['verdict'],
        _count: { _all: true },
      }),
      this.prisma.correlationPairVerdict.count({
        where: { decidedBy: AI_ACTOR },
      }),
    ]);

    const page = rows.slice(0, limit);
    const ids = [...new Set(page.flatMap((r) => [r.aId, r.bId]))];
    const [assets, signatures] = await Promise.all([
      ids.length
        ? this.prisma.asset.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        : [],
      page.length
        ? this.prisma.correlationPairSignature.findMany({
            where: { OR: page.map((r) => ({ aId: r.aId, bId: r.bId })) },
            select: { aId: true, bId: true, weighted: true },
          })
        : [],
    ]);
    const nameOf = new Map<string, string>(
      assets.map((a) => [a.id, a.name] as const),
    );
    const scoreOf = new Map<string, number>(
      signatures.map((x) => [`${x.aId}|${x.bId}`, Number(x.weighted)] as const),
    );

    return {
      rows: page.map((r) => {
        const current = scoreOf.get(`${r.aId}|${r.bId}`) ?? null;
        return {
          aId: r.aId,
          bId: r.bId,
          // An asset can be deleted after the decision; the verdict outlives it
          // on purpose, so fall back to the id rather than dropping the row.
          aName: nameOf.get(r.aId) ?? r.aId,
          bName: nameOf.get(r.bId) ?? r.bId,
          verdict: r.verdict,
          patternKey: r.patternKey,
          scoreAtVerdict: Number(r.scoreAtVerdict),
          currentScore: current,
          stale:
            current != null &&
            Math.abs(current - Number(r.scoreAtVerdict)) > STALE_SCORE_DELTA,
          decidedByKind: originOf(r.decidedBy),
          decidedAt: r.decidedAt.toISOString(),
          caseId: r.caseId,
          inquiryId: r.inquiryId,
          note: r.note,
        };
      }),
      nextCursor: rows.length > limit ? page.at(-1)!.id : null,
      total,
      unactioned,
      byVerdict: Object.fromEntries(
        grouped.map((g) => [g.verdict, g._count._all]),
      ),
      byAgent,
    };
  }

  /**
   * Put decided pairs back in the queue.
   *
   * A judgement you cannot revise is not a judgement. Reopening deletes the
   * verdict, which also releases the suppression that kept a REJECTED or SPLIT
   * pair out of its cluster — so the neighbourhood is recomputed to put things
   * back the way the evidence says they should be.
   */
  async reopen(dto: { pairs?: unknown }) {
    const pairs = this.cleanPairs(dto?.pairs);
    if (pairs.length === 0) {
      return { reopened: 0, workRemaining: await this.workRemaining() };
    }
    const suppressing = await this.prisma.correlationPairVerdict.findMany({
      where: {
        OR: pairs.map((p) => ({ aId: p.aId, bId: p.bId })),
        verdict: { in: ['REJECTED', 'SPLIT'] },
      },
      select: { aId: true, bId: true },
    });

    const removed = await this.prisma.correlationPairVerdict.deleteMany({
      where: { OR: pairs.map((p) => ({ aId: p.aId, bId: p.bId })) },
    });

    // Only the suppressing verdicts changed what clustering does, so only they
    // need the neighbourhood rebuilt.
    if (suppressing.length > 0) {
      await this.correlation.recomputeForAssets([
        ...new Set(suppressing.flatMap((v) => [v.aId, v.bId])),
      ]);
    }
    await this.refreshUndecidedCounts();
    return {
      reopened: removed.count,
      workRemaining: await this.workRemaining(),
    };
  }

  /**
   * Push decided pairs into a case as evidence.
   *
   * Reuses the same path the fingerprints case action already used, so these
   * land with the normal CaseActivity audit trail and DUPLICATES agent run
   * rather than through a second, subtly different route. The verdicts are then
   * stamped with the case id, which is what lets the decisions view show what
   * has been followed through and what has not.
   */
  async decisionsToCase(dto: DecisionsToCaseDto) {
    const pairs = this.cleanPairs(dto?.pairs);
    if (pairs.length === 0) {
      throw new NotFoundException('No pairs given');
    }
    const assetIds = [...new Set(pairs.flatMap((p) => [p.aId, p.bId]))];

    const result = await this.duplicatesFinder.runCaseAction({
      assetIds,
      caseId: dto.caseId ?? null,
      title: dto.title ?? null,
      description: dto.description ?? null,
      severity: (dto.severity as never) ?? null,
      attachFindings: dto.attachFindings ?? false,
    });

    const linked = await this.prisma.correlationPairVerdict.updateMany({
      where: { OR: pairs.map((p) => ({ aId: p.aId, bId: p.bId })) },
      data: { caseId: result.caseId },
    });

    return {
      caseId: result.caseId,
      caseTitle: result.caseTitle,
      created: result.created,
      assetsAdded: result.assetsAdded,
      findingsAttached: result.findingsAttached,
      pairsLinked: linked.count,
    };
  }

  /**
   * Open an inquiry that keeps watching for what these pairs had in common.
   *
   * The matchers come from the pairs themselves — the labels that made them
   * match, scoped to the sources they came from — so the inquiry watches for
   * the same signature rather than starting from a blank form.
   */
  async decisionsToInquiry(dto: DecisionsToInquiryDto) {
    const pairs = this.cleanPairs(dto?.pairs);
    if (pairs.length === 0) throw new NotFoundException('No pairs given');

    const signatures = await this.prisma.correlationPairSignature.findMany({
      where: { OR: pairs.map((p) => ({ aId: p.aId, bId: p.bId })) },
      select: {
        labels: true,
        sourceAId: true,
        sourceBId: true,
        patternKey: true,
      },
    });
    const labels = [...new Set(signatures.flatMap((s) => s.labels))];
    const sourceIds = [
      ...new Set(signatures.flatMap((s) => [s.sourceAId, s.sourceBId])),
    ];

    const created = await this.inquiries.create({
      title:
        dto.title ??
        `Duplicates matching on ${labels.join(', ') || 'shared values'}`,
      description:
        `Opened from duplicate review after confirming ${pairs.length} pair(s) ` +
        `in pattern "${signatures[0]?.patternKey ?? 'unknown'}".`,
      matchAllSources: false,
      sourceIds,
      findingTypes: labels,
    });

    const linked = await this.prisma.correlationPairVerdict.updateMany({
      where: { OR: pairs.map((p) => ({ aId: p.aId, bId: p.bId })) },
      data: { inquiryId: created.id },
    });

    return {
      inquiryId: created.id,
      title: created.title,
      matchCount: created.matchCount ?? 0,
      pairsLinked: linked.count,
    };
  }

  /**
   * Why this pair matched, framed as something to fix.
   *
   * Rejecting a pair without addressing the cause means the next scan produces
   * it again. So a rejection surfaces the label that actually drove the score
   * and how many other pairs the same combination produced — the difference
   * between dismissing one bad match and stopping a few hundred.
   */
  async rejectCause(aIdRaw: string, bIdRaw: string): Promise<RejectCauseDto> {
    const { aId, bId } = this.canonical(aIdRaw, bIdRaw);
    const signature = await this.prisma.correlationPairSignature.findUnique({
      where: { aId_bId: { aId, bId } },
    });
    if (!signature)
      throw new NotFoundException('That pair is not in the index');

    const [edge, values, config, similar] = await Promise.all([
      this.prisma.edge.findFirst({
        where: {
          fromType: ASSET_REL,
          toType: ASSET_REL,
          fromId: aId,
          toId: bId,
          relationType: { in: REVIEWABLE_RELATION_TYPES },
        },
        select: { metadata: true },
      }),
      this.prisma.assetCorrelationValue.findMany({
        where: { assetId: { in: [aId, bId] } },
        select: { assetId: true, label: true, normalizedValue: true },
        take: VALUES_PER_SIDE_CAP * 2,
      }),
      this.correlation.getConfig(),
      this.prisma.correlationPairSignature.count({
        where: { patternKey: signature.patternKey },
      }),
    ]);

    const meta = (edge?.metadata ?? {}) as Record<string, unknown>;
    const contrib = (meta.contribByLabel ?? {}) as Record<string, number>;
    const totalContrib =
      Object.values(contrib).reduce((a, b) => a + (Number(b) || 0), 0) || 1;

    const sharedByLabel = new Map<string, string[]>();
    for (const label of Object.keys(contrib)) {
      const a = new Set(
        values
          .filter((v) => v.assetId === aId && v.label === label)
          .map((v) => v.normalizedValue),
      );
      sharedByLabel.set(
        label,
        values
          .filter(
            (v) =>
              v.assetId === bId &&
              v.label === label &&
              a.has(v.normalizedValue),
          )
          .map((v) => v.normalizedValue)
          .slice(0, 8),
      );
    }

    const drivers = Object.entries(contrib)
      .map(([label, value]) => ({
        label,
        share: (Number(value) || 0) / totalContrib,
        weight:
          config.labels.find((l) => l.label === label)?.weight ??
          config.defaultWeight,
        values: sharedByLabel.get(label) ?? [],
      }))
      .sort((x, y) => y.share - x.share);

    // "Dominant" only when one label really carries the match. Offering to
    // retune on a 40/35/25 split would be advice to break the other two.
    const dominant =
      drivers.length > 0 && drivers[0].share >= 0.6 ? drivers[0].label : null;

    return { drivers, dominantLabel: dominant, similarPairs: similar };
  }

  // ── Bulk pattern actions ──────────────────────────────────────────────────

  private patternFilterSql(patternKey: string, dto: PatternActionDto) {
    const min = this.unit(dto?.min, 0);
    const max = this.unit(dto?.max, 1);
    const lineage = this.lineageFilter(dto?.lineage);
    return Prisma.sql`
      s.pattern_key = ${patternKey}
      AND s.weighted BETWEEN ${min} AND ${max}
      ${lineage ? Prisma.sql`AND s.lineage_state = ${lineage}::"CorrelationLineageState"` : Prisma.empty}
      AND NOT EXISTS (
        SELECT 1 FROM correlation_pair_verdicts v
        WHERE v.a_id = s.a_id AND v.b_id = s.b_id
      )
    `;
  }

  /** Strictly read-only. Nothing here writes. */
  async previewPattern(
    patternKey: string,
    dto: PatternActionDto,
  ): Promise<PatternPreviewResponseDto> {
    const pattern = await this.prisma.correlationPattern.findUnique({
      where: { patternKey },
    });
    if (!pattern) throw new NotFoundException('No such pattern');

    const where = this.patternFilterSql(patternKey, dto);
    const [row] = await this.prisma.$queryRaw<
      Array<{
        pairs: bigint;
        clusters: bigint;
        assets: bigint;
        sample: string[];
      }>
    >(Prisma.sql`
      WITH scoped AS (
        SELECT s.a_id, s.b_id, s.cluster_id
        FROM correlation_pair_signatures s
        WHERE ${where}
      )
      SELECT (SELECT COUNT(*) FROM scoped)::bigint AS pairs,
             (SELECT COUNT(DISTINCT cluster_id) FROM scoped)::bigint AS clusters,
             -- Distinct over BOTH sides together. Summing the two column-wise
             -- distincts counted every asset that is the left side of one pair
             -- and the right side of another twice, so this number -- the one
             -- someone reads before confirming several thousand pairs at once
             -- -- could report nearly double what the action would touch.
             (SELECT COUNT(*) FROM (
                SELECT a_id AS id FROM scoped
                UNION
                SELECT b_id FROM scoped) u)::bigint AS assets,
             (SELECT (ARRAY_AGG(DISTINCT cluster_id)
                        FILTER (WHERE cluster_id IS NOT NULL))[1:5]
                FROM scoped) AS sample
    `);

    const before = await this.workRemaining();
    const pairs = Number(row?.pairs ?? 0);
    return {
      patternKey,
      pairsAffected: pairs,
      clustersAffected: Number(row?.clusters ?? 0),
      assetsAffected: Number(row?.assets ?? 0),
      sampleClusterIds: row?.sample ?? [],
      ruleKind: pattern.ruleKind,
      ruleDescription: this.describeRule(pattern.ruleKind, pattern.labels),
      workRemainingBefore: before,
      workRemainingAfter: Math.max(0, before - pairs),
    };
  }

  private describeRule(ruleKind: string, labels: string[]): string {
    const list = labels.join(', ') || 'these values';
    switch (ruleKind) {
      case 'EXCLUSION':
        // Deliberately does NOT name `labels`. A near-duplicate text pattern
        // is built from an embedding group, and its signature rows carry an
        // empty label array — so the old wording resolved to "stops these
        // values" and promised something the row had no way to identify. What
        // is actually excludable comes from the values inside the group, which
        // is what the exclusion-candidates endpoint returns.
        return 'Shared template text is doing the matching. Excluding the values inside it stops the template from driving matches elsewhere.';
      case 'MERGE':
        return 'These assets are byte-identical. Confirming needs no judgement.';
      case 'THRESHOLD':
        return `${list} match closely and consistently across this pattern — a cutoff decision rather than a per-pair one.`;
      default:
        return `${list} overlap, but the rest does not agree. Each pair needs a look.`;
    }
  }

  /**
   * What a boilerplate pattern is actually made of, and what excluding it costs.
   *
   * A near-duplicate text pattern is the DIAGNOSIS, not the damage. Its own
   * pairs come from embedding similarity, so excluding anything will not make
   * them go away. The damage is second-order: the template contains findings —
   * the address in a footer, the support mailbox in a signature block — and
   * those values then produce shared-value matches between every asset that
   * carries the template. Those are what an exclusion removes, and they live
   * in OTHER patterns entirely. `pairsDriven` counts them so the number on the
   * button describes the actual effect rather than the pattern being viewed.
   *
   * Values are re-derived from the findings rather than read through
   * `asset_correlation_values.finding_id`, which is nullable by design (rows
   * predating that column are healed lazily). Re-normalising reproduces
   * exactly what the indexer stored and does not depend on the backfill.
   */
  async exclusionCandidates(
    patternKey: string,
  ): Promise<PatternExclusionCandidatesResponseDto> {
    const pattern = await this.prisma.correlationPattern.findUnique({
      where: { patternKey },
    });
    if (!pattern) throw new NotFoundException('No such pattern');

    const empty = {
      patternKey,
      ruleKind: pattern.ruleKind,
      candidates: [],
      totalCandidates: 0,
      pairsDriven: 0,
      truncated: false,
    };
    // Only near-duplicate text patterns carry a group to read values out of.
    if (pattern.ruleKind !== 'EXCLUSION') return empty;
    const groupPrefix = patternKey.startsWith(BOILERPLATE_PREFIX)
      ? patternKey.slice(BOILERPLATE_PREFIX.length)
      : null;
    if (!groupPrefix) return empty;

    const findings = await this.prisma.$queryRaw<
      Array<{ finding_type: string; matched_content: string | null }>
    >(Prisma.sql`
      SELECT DISTINCT f.finding_type, f.matched_content
      FROM finding_evidence_analyses a
      JOIN findings f ON f.id = a.finding_id
      WHERE a.duplicate_group_hash IS NOT NULL
        AND left(a.duplicate_group_hash, 8) = ${groupPrefix}
      LIMIT ${GROUP_FINDING_CAP + 1}
    `);
    const truncated = findings.length > GROUP_FINDING_CAP;

    const byHash = new Map<string, { label: string; value: string }>();
    for (const f of findings.slice(0, GROUP_FINDING_CAP)) {
      if (typeof f.matched_content !== 'string' || !f.matched_content) continue;
      const value = normalizeValue(f.finding_type, f.matched_content);
      if (!value) continue;
      const label = normalizeLabel(f.finding_type);
      byHash.set(valueHash(f.finding_type, value), { label, value });
    }
    if (byHash.size === 0) {
      return { ...empty, truncated };
    }

    const hashes = [...byHash.keys()];
    const [owners, driven] = await Promise.all([
      this.prisma.$queryRaw<Array<{ value_hash: string; assets: number }>>(
        Prisma.sql`
          SELECT value_hash, COUNT(DISTINCT asset_id)::int AS assets
          FROM asset_correlation_values
          WHERE value_hash = ANY(${hashes})
          GROUP BY value_hash
        `,
      ),
      // Pairs where BOTH sides hold one of these values. Written as an EXISTS
      // seeded from the pair rather than a join over the owner sets: a
      // template value can be held by thousands of assets, and pairing those
      // off would be a quadratic probe of a set that is already enumerated.
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM correlation_pair_signatures s
        WHERE s.family <> 'NEAR_DUPLICATE_TEXT'::"CorrelationPatternFamily"
          AND EXISTS (
            SELECT 1
            FROM asset_correlation_values va
            JOIN asset_correlation_values vb
              ON vb.value_hash = va.value_hash AND vb.asset_id = s.b_id
            WHERE va.asset_id = s.a_id
              AND va.value_hash = ANY(${hashes})
          )
      `),
    ]);

    const assetsBy = new Map(owners.map((o) => [o.value_hash, o.assets]));
    const candidates = hashes
      .map((valueHash_) => ({
        valueHash: valueHash_,
        label: byHash.get(valueHash_)!.label,
        value: byHash.get(valueHash_)!.value,
        assetCount: assetsBy.get(valueHash_) ?? 0,
      }))
      // Reach first: the value in every copy of the template is the one worth
      // excluding, and a value only one asset holds is not boilerplate at all.
      .filter((c) => c.assetCount > 1)
      .sort((a, b) => b.assetCount - a.assetCount || a.value.localeCompare(b.value));

    return {
      patternKey,
      ruleKind: pattern.ruleKind,
      candidates: candidates.slice(0, EXCLUSION_CANDIDATE_CAP),
      totalCandidates: candidates.length,
      pairsDriven: Number(driven[0]?.count ?? 0),
      truncated,
    };
  }

  /**
   * Turn a caller's chosen value hashes into exclusion rules.
   *
   * Hashes, not raw values: the rule can then only ever name something already
   * in the index, so a pattern endpoint cannot be used to write arbitrary
   * instance-wide config. Anything unrecognised is silently dropped rather
   * than written as a rule that matches nothing.
   */
  private async rulesForValueHashes(
    input: unknown,
  ): Promise<Array<{ mode: 'value'; label: string; value: string }>> {
    const hashes = [
      ...new Set(
        (Array.isArray(input) ? input : [])
          .map((h) => String(h).trim())
          .filter((h) => /^[0-9a-f]{64}$/.test(h)),
      ),
    ].slice(0, EXCLUSION_CANDIDATE_CAP);
    if (hashes.length === 0) return [];

    const rows = await this.prisma.$queryRaw<
      Array<{ label: string; normalized_value: string }>
    >(Prisma.sql`
      SELECT DISTINCT label, normalized_value
      FROM asset_correlation_values
      WHERE value_hash = ANY(${hashes})
    `);
    return rows.map((r) => ({
      mode: 'value' as const,
      label: r.label,
      value: r.normalized_value,
    }));
  }

  async applyPattern(
    patternKey: string,
    dto: PatternActionDto,
  ): Promise<PatternApplyResponseDto> {
    const pattern = await this.prisma.correlationPattern.findUnique({
      where: { patternKey },
    });
    if (!pattern) throw new NotFoundException('No such pattern');
    const verdict = this.assertVerdict(dto?.verdict);

    const where = this.patternFilterSql(patternKey, dto);
    const targets = await this.prisma.$queryRaw<
      Array<{
        a_id: string;
        b_id: string;
        weighted: string;
        cluster_id: string | null;
      }>
    >(Prisma.sql`
      SELECT s.a_id, s.b_id, s.weighted::text, s.cluster_id
      FROM correlation_pair_signatures s
      WHERE ${where}
    `);

    const batchId = randomUUID();
    let exclusionRuleIds: string[] = [];

    // The exclusion is the actual fix for a boilerplate pattern; the verdicts
    // just clear the backlog it produced. Written first so that if it fails the
    // queue is not silently marked done without the rule that justified it.
    //
    // Two shapes, because there are two honest fixes. Excluding VALUES is the
    // precise one and what the review screen offers: the address and the
    // mailbox inside the template stop matching, and every other use of that
    // label keeps working. Excluding a LABEL is the blunt one, kept for a
    // caller that really means "this detector's output is useless for
    // matching" — the tuning screen and the harness both have reason to say
    // that, and neither should have to go through the pair screen to do it.
    if (pattern.ruleKind === 'EXCLUSION') {
      const rules: Array<{
        mode: 'value' | 'label';
        label: string | null;
        value: string | null;
      }> = await this.rulesForValueHashes(dto.excludeValueHashes);
      if (typeof dto.excludeLabel === 'string' && dto.excludeLabel) {
        rules.push({ mode: 'label', label: dto.excludeLabel, value: null });
      }
      if (rules.length > 0) {
        const { added } = await this.correlation.addExclusions(rules);
        exclusionRuleIds = added.map((r) => r.id);
      }
    }
    const excluding = exclusionRuleIds.length > 0;

    try {
      await this.prisma.$transaction([
        this.prisma.correlationReviewBatch.create({
          data: {
            id: batchId,
            action: excluding ? 'exclude' : verdict.toLowerCase(),
            patternKey,
            pairCount: targets.length,
            clusterCount: new Set(
              targets.map((t) => t.cluster_id).filter(Boolean),
            ).size,
            assetCount: new Set(targets.flatMap((t) => [t.a_id, t.b_id])).size,
            summary: `${verdict} on pattern ${patternKey} (${targets.length} pairs)`,
            undoPayload: excluding
              ? { kind: 'exclusion', ruleIds: exclusionRuleIds }
              : Prisma.DbNull,
          },
        }),
        this.prisma.correlationPairVerdict.createMany({
          data: targets.map((t) => ({
            aId: t.a_id,
            bId: t.b_id,
            verdict: verdict as never,
            patternKey,
            scoreAtVerdict: t.weighted,
            batchId,
          })),
          skipDuplicates: true,
        }),
      ]);
    } catch (error) {
      // The exclusion has to be written before the verdicts, or a crash in
      // between marks the queue done without the rule that justified it. The
      // other order fails worse: an instance-wide matching rule with no batch
      // in the undo log, which nothing in the UI can reach to take back. So
      // roll it back by hand and let the caller see the failure.
      if (excluding) {
        await this.correlation
          .removeExclusions(exclusionRuleIds)
          .catch((e: unknown) => {
            this.logger.error(
              `Bulk action on ${patternKey} failed and its exclusion rule(s) ` +
                `${exclusionRuleIds.join(', ')} could not be rolled back: ` +
                String(e),
            );
          });
      }
      throw error;
    }

    await this.refreshUndecidedCounts();

    // REJECTED and SPLIT are the two verdicts cluster union consults, so a
    // bulk one changes what the clusters should be. `splitPair` recomputes its
    // own two assets inline; a pattern can cover thousands, which is a
    // background job rather than something to hold a request open for.
    // Without this the clusters silently disagreed with the decisions until
    // whenever the next scan happened to run.
    if (
      targets.length > 0 &&
      (verdict === 'REJECTED' || verdict === 'SPLIT') &&
      !excluding // an exclusion already scheduled one via saveConfig
    ) {
      await this.correlation.scheduleFullRecompute(
        `bulk ${verdict.toLowerCase()} on pattern ${patternKey}`,
      );
    }

    return {
      batchId,
      applied: targets.length,
      workRemaining: await this.workRemaining(),
      exclusionRuleId: exclusionRuleIds[0] ?? null,
      exclusionRuleIds,
    };
  }

  // ── Split ─────────────────────────────────────────────────────────────────

  /**
   * Cut the link between two assets and re-cluster their neighbourhood.
   *
   * The verdict is what makes this stick: cluster union consults it on every
   * later recompute, so the next scan cannot quietly rejoin what a reviewer
   * separated.
   */
  async splitPair(
    aIdRaw: string,
    bIdRaw: string,
  ): Promise<SplitPairResponseDto> {
    const { aId, bId } = this.canonical(aIdRaw, bIdRaw);
    const signature = await this.prisma.correlationPairSignature.findUnique({
      where: { aId_bId: { aId, bId } },
    });
    if (!signature)
      throw new NotFoundException('That pair is not in the index');

    // The edge is the scorer's opinion and is re-derived from the findings on
    // every recompute; the verdict is the reviewer's ruling and is not.
    // Deleting the edge here would look decisive and change nothing — the
    // recompute below rewrites it microseconds later. What actually separates
    // these two assets is the verdict, which cluster union consults on every
    // later pass. The edge is kept in the batch payload as a record of what
    // the scorer thought at the time.
    const edge = await this.prisma.edge.findFirst({
      where: {
        fromType: ASSET_REL,
        toType: ASSET_REL,
        fromId: aId,
        toId: bId,
        relationType: { in: REVIEWABLE_RELATION_TYPES },
      },
    });

    const batchId = randomUUID();
    // One transaction, like recordVerdicts and agentClearSafeBand. Written
    // separately, a crash between the batch insert and the verdict left a
    // batch in the undo log that suppressed nothing — it claimed a split that
    // had not happened — and two concurrent splits on the same pair could
    // interleave so that the surviving state had a reported batch and no
    // verdict at all.
    await this.prisma.$transaction([
      this.prisma.correlationReviewBatch.create({
        data: {
          id: batchId,
          action: 'split',
          patternKey: signature.patternKey,
          pairCount: 1,
          clusterCount: signature.clusterId ? 1 : 0,
          assetCount: 2,
          summary: `Split ${aId} from ${bId}`,
          undoPayload: {
            kind: 'split',
            aId,
            bId,
            edge: edge ? JSON.parse(JSON.stringify(edge)) : null,
          },
        },
      }),
      this.prisma.correlationPairVerdict.deleteMany({ where: { aId, bId } }),
      this.prisma.correlationPairVerdict.create({
        data: {
          aId,
          bId,
          verdict: 'SPLIT',
          patternKey: signature.patternKey,
          scoreAtVerdict: signature.weighted,
          batchId,
        },
      }),
    ]);

    // Re-cluster the neighbourhood now, so the reviewer sees the split take
    // effect instead of waiting for the next scan.
    await this.correlation.recomputeForAssets([aId, bId]);
    await this.refreshUndecidedCounts();

    // Report what actually happened. A pair inside a larger cluster can stay
    // joined through a third member, and saying "split" when they are still
    // together would be a lie the reviewer only discovers later.
    const together = await this.prisma.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM asset_cluster_members m1
        JOIN asset_cluster_members m2 ON m1.cluster_id = m2.cluster_id
        WHERE m1.asset_id = ${aId} AND m2.asset_id = ${bId}
      `,
    );

    return {
      batchId,
      clusterSplit: Number(together[0]?.count ?? 0) === 0,
      workRemaining: await this.workRemaining(),
    };
  }
}
