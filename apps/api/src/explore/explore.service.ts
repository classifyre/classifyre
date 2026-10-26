import {
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { GraphService, type GraphTraceResult } from '../graph.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { SemanticBoardLayerService } from '../semantic/board/semantic-board-layer.service';
import { InquiryMatchingService } from '../matching/inquiry-matching.service';
import type {
  ExploreAssetRefDto,
  ExploreDuplicatesFilterDto,
  ExploreNeighbourhoodRequestDto,
  ExploreNeighbourhoodResponseDto,
  ExploreStartersResponseDto,
} from './explore.dto';
import {
  EDGE_WALK_KINDS,
  EXPLORE_ALIKE_PER_SEED,
  EXPLORE_ALIKE_SEEDS,
  EXPLORE_KINDS,
  EXPLORE_MEANING_LIMIT,
  EXPLORE_PER_KIND,
  EXPLORE_SOURCE_SEEDS,
  EXPLORE_TRACE_LIMIT,
  SCORED_DEPTH_MAX,
  TRACED_KINDS,
  type ExploreKind,
  type ExploreScope,
} from './explore-kinds';
import { TRACE_KIND_SQL, type TraceEdgeRow } from '../graph-trace';
import {
  mergeNeighbourhood,
  withEdgesAmong,
  withMarks,
  withScope,
  duplicateWalks,
  pairKey,
  pickDuplicateHubs,
  type DuplicatePairRow,
  type ScoredEdge,
  type ExploreMarks,
  type AlikePart,
  type ExploreAsset,
  type MeaningPart,
} from './explore-merge';

const MAX_SEEDS = 10;
/** Pairs read for the duplicates map, strongest first, before the hubs are picked. */
const DUPLICATE_PAIRS_READ = 2000;
/** Lineage edges sampled for hubs before the review index has been built. */
const LINEAGE_SAMPLE = 20_000;
/** Edges read between the assets already on the canvas. */
const EXPLORE_AMONG_LIMIT = 400;
/** Open findings read to tell which assets a watch is answering. */
const WATCH_FINDING_LIMIT = 3000;

/**
 * Explore: start from a few assets and see what they are connected to, by
 * kind of connection, each link with its reason. Lineage and links are
 * traced as far as asked, upstream, downstream or both; the rest is one or
 * two steps. Every read is bounded per kind, so a hub of look-alikes never
 * hides lineage and a workspace of millions answers like one of hundreds.
 */
@Injectable()
export class ExploreService {
  private readonly logger = new Logger(ExploreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly embeddings: EmbeddingService,
    @Optional() private readonly semanticLayer?: SemanticBoardLayerService,
    @Optional() private readonly matching?: InquiryMatchingService,
  ) {}

  async neighbourhood(
    input: ExploreNeighbourhoodRequestDto,
  ): Promise<ExploreNeighbourhoodResponseDto> {
    const kinds = new Set<ExploreKind>(
      input.kinds?.length ? input.kinds : EXPLORE_KINDS,
    );
    const depth = Math.min(Math.max(Math.trunc(input.depth ?? 1), 1), 6);
    const direction = input.direction ?? 'both';
    const scope = input.scope ?? 'all';
    const asked = input.assetIds?.length ? input.assetIds : null;
    // Duplicate review's pairs are drawn as they are, not walked from seeds.
    if (!asked && input.duplicates) {
      return this.duplicatesMap(input.duplicates, scope, kinds);
    }
    // A term is explored from the assets that carry it most; a source from
    // its most connected assets.
    const seeds = await this.resolveSeeds(
      asked ??
        (input.termId
          ? await this.termSeeds(input.termId)
          : input.sourceId
            ? await this.sourceSeeds(input.sourceId, kinds, scope)
            : []),
      !asked && input.sourceId && !input.termId
        ? EXPLORE_SOURCE_SEEDS
        : MAX_SEEDS,
    );
    if (!seeds.length) {
      return mergeNeighbourhood({
        seeds: [],
        walks: [],
        meaning: null,
        alike: [],
        alikeStatus: 'ok',
      });
    }
    const seedIds = seeds.map((s) => s.id);
    const refs = seedIds.map((id) => ({ type: 'asset', id }));

    const [walks, repeated, meaning, alike] = await Promise.all([
      // One walk per kind: each gets its own bound.
      Promise.all(
        EDGE_WALK_KINDS.filter((kind) => kinds.has(kind)).map(async (kind) => {
          // Lineage and links are traced as far and as one-way as asked;
          // two steps of "the same as" is as far as sameness goes.
          const traced = TRACED_KINDS.has(kind);
          const hops = traced ? depth : Math.min(depth, SCORED_DEPTH_MAX);
          return {
            kind,
            result: await this.graph.trace({
              seeds: refs,
              depth: hops,
              direction: traced ? direction : 'both',
              kinds: [kind],
              limit:
                (hops > 1 && traced ? EXPLORE_TRACE_LIMIT : EXPLORE_PER_KIND) +
                seedIds.length,
              activeOnly: true,
            }),
          };
        }),
      ),
      kinds.has('duplicates')
        ? this.repeatedText(seedIds)
        : Promise.resolve(null),
      kinds.has('meaning') ? this.meaning(seedIds) : Promise.resolve(null),
      kinds.has('alike')
        ? this.alike(seedIds)
        : Promise.resolve({ status: 'ok' as const, parts: [] }),
    ]);

    const view = mergeNeighbourhood({
      seeds,
      walks: repeated
        ? [...walks, { kind: 'duplicates', result: repeated }]
        : walks,
      meaning,
      alike: alike.parts,
      alikeStatus: alike.status,
    });
    // A walk reads the edges that touch what it walks from; two neighbours
    // can be linked too (a link someone drew between them, lineage running
    // across), and that line belongs on the canvas.
    const assetIds = view.nodes
      .filter((n) => n.type === 'asset')
      .map((n) => n.id);
    const [among, marks, sourceOf] = await Promise.all([
      this.edgesAmong(
        assetIds,
        EDGE_WALK_KINDS.filter((kind) => kinds.has(kind)),
      ),
      this.marks(assetIds),
      this.sourcesOf(assetIds),
    ]);
    // A term's carriers come from everywhere: no source is home to them.
    const home = input.sourceId
      ? [input.sourceId]
      : !asked && input.termId
        ? []
        : [...new Set(seeds.flatMap((s) => (s.sourceId ? [s.sourceId] : [])))];
    return withMarks(
      withScope(withEdgesAmong(view, among), { home, scope, sourceOf }),
      marks,
    );
  }

  /**
   * A source's most connected assets, to explore the source from: counted
   * over the kinds asked for and the scope (connections to its own assets, to
   * other sources', or both). Repeated-text pairs count as "same as". A
   * source with no connections at all starts from what it scanned last, for
   * meaning and likeness to tie together.
   */
  private async sourceSeeds(
    sourceId: string,
    kinds: ReadonlySet<ExploreKind>,
    scope: ExploreScope,
  ): Promise<string[]> {
    const walk = EDGE_WALK_KINDS.filter((kind) => kinds.has(kind));
    const repeated = kinds.has('duplicates');
    const scoped =
      scope === 'internal'
        ? Prisma.sql`AND o.source_id = ${sourceId}`
        : scope === 'external'
          ? Prisma.sql`AND o.source_id IS DISTINCT FROM ${sourceId}`
          : Prisma.empty;
    try {
      const rows = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '4s'`;
          return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            WITH src AS (
              SELECT id FROM assets
              WHERE source_id = ${sourceId} AND status <> 'DELETED'::"AssetStatus"
            ),
            ends AS (
              SELECT e.from_id AS id, e.to_id AS other FROM edges e
              JOIN src ON src.id = e.from_id
              WHERE e.from_type = 'asset' AND e.to_type = 'asset'
                AND ${TRACE_KIND_SQL} = ANY(${walk}::text[])
              UNION ALL
              SELECT e.to_id, e.from_id FROM edges e
              JOIN src ON src.id = e.to_id
              WHERE e.from_type = 'asset' AND e.to_type = 'asset'
                AND ${TRACE_KIND_SQL} = ANY(${walk}::text[])
              UNION ALL
              SELECT s.a_id, s.b_id FROM correlation_pair_signatures s
              JOIN src ON src.id = s.a_id
              WHERE ${repeated} AND s.family = 'NEAR_DUPLICATE_TEXT'::"CorrelationPatternFamily"
              UNION ALL
              SELECT s.b_id, s.a_id FROM correlation_pair_signatures s
              JOIN src ON src.id = s.b_id
              WHERE ${repeated} AND s.family = 'NEAR_DUPLICATE_TEXT'::"CorrelationPatternFamily"
            )
            SELECT ends.id FROM ends
            JOIN assets o ON o.id = ends.other AND o.status <> 'DELETED'::"AssetStatus"
            WHERE ends.id <> ends.other ${scoped}
            GROUP BY ends.id
            ORDER BY count(*) DESC, ends.id
            LIMIT ${EXPLORE_SOURCE_SEEDS}
          `);
        },
        { timeout: 8_000, maxWait: 3_000 },
      );
      if (rows.length) return rows.map((r) => r.id);
    } catch (error) {
      this.logger.warn(`Most connected assets failed: ${String(error)}`);
    }
    if (scope === 'external') return [];
    const recent = await this.prisma.asset.findMany({
      where: { sourceId, status: { not: 'DELETED' } },
      orderBy: { lastScannedAt: 'desc' },
      take: EXPLORE_SOURCE_SEEDS,
      select: { id: true },
    });
    return recent.map((a) => a.id);
  }

  /**
   * The assets that carry a term most: the most severe findings first, then
   * the most support, then the latest. As the meaning trace ranks them.
   */
  private async termSeeds(termId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ asset_id: string }>>(
      Prisma.sql`
        SELECT t.asset_id FROM asset_terms t
        JOIN assets a ON a.id = t.asset_id AND a.status <> 'DELETED'::"AssetStatus"
        WHERE t.term_id = ${termId} AND t.gone_at IS NULL
        GROUP BY t.asset_id
        ORDER BY min(t.max_severity) ASC NULLS LAST, sum(t.support_count) DESC,
                 max(t.last_linked_at) DESC, t.asset_id
        LIMIT ${MAX_SEEDS}
      `,
    );
    return rows.map((r) => r.asset_id);
  }

  /**
   * Duplicate review's pairs that match a filter, drawn as they are: the
   * assets in the most of them are the starting points, and each of their
   * pairs is a line, with the same reason the pair screen gives. Lineage and
   * links between what is drawn come along; other pairs do not, so the
   * canvas shows exactly what the filter asked for. A pair someone ruled
   * apart is never drawn as the same.
   */
  private async duplicatesMap(
    filter: ExploreDuplicatesFilterDto,
    scope: ExploreScope,
    kinds: ReadonlySet<ExploreKind>,
  ): Promise<ExploreNeighbourhoodResponseDto> {
    const pairs = await this.matchingPairs(filter, scope);
    const { hubs, drawn, truncated } = pickDuplicateHubs(pairs, MAX_SEEDS);
    const assets = await this.hydrate([
      ...new Set(drawn.flatMap((p) => [p.a_id, p.b_id])),
    ]);
    const live = drawn.filter((p) => assets.has(p.a_id) && assets.has(p.b_id));
    const seeds = hubs.flatMap((id) => assets.get(id) ?? []);
    const scored = await this.scoredEdges(
      live.filter(
        (p) => p.family === 'SHARED_LABELS' || p.family === 'PHONETIC',
      ),
    );
    const view = mergeNeighbourhood({
      seeds,
      walks: duplicateWalks(live, assets, new Set(hubs), scored, truncated),
      meaning: null,
      alike: [],
      alikeStatus: 'ok',
    });
    const assetIds = view.nodes.map((n) => n.id);
    const [among, marks, sourceOf] = await Promise.all([
      // Lines of other kinds between what is drawn; other pairs would break the filter.
      this.edgesAmong(
        assetIds,
        (['lineage', 'links'] as const).filter((kind) => kinds.has(kind)),
      ),
      this.marks(assetIds),
      this.sourcesOf(assetIds),
    ]);
    return withMarks(
      withScope(withEdgesAmong(view, among), {
        home: [],
        scope: 'all',
        sourceOf,
      }),
      marks,
    );
  }

  /** Pairs of duplicate review that match, strongest first. Bounded and timed. */
  private async matchingPairs(
    filter: ExploreDuplicatesFilterDto,
    scope: ExploreScope,
  ): Promise<DuplicatePairRow[]> {
    const where: Prisma.Sql[] = [];
    if (filter.patternKey)
      where.push(Prisma.sql`s.pattern_key = ${filter.patternKey}`);
    if (filter.family) {
      where.push(
        Prisma.sql`s.family = ${filter.family}::"CorrelationPatternFamily"`,
      );
    }
    if (filter.minScore != null)
      where.push(Prisma.sql`s.weighted >= ${filter.minScore}`);
    if (filter.sourceId) {
      where.push(
        Prisma.sql`(s.source_a_id = ${filter.sourceId} OR s.source_b_id = ${filter.sourceId})`,
      );
    }
    if (scope === 'internal')
      where.push(Prisma.sql`s.source_a_id = s.source_b_id`);
    if (scope === 'external')
      where.push(Prisma.sql`s.source_a_id <> s.source_b_id`);
    const review = filter.review ?? 'any';
    where.push(
      review === 'confirmed'
        ? Prisma.sql`v.verdict = 'CONFIRMED'::"CorrelationVerdict"`
        : review === 'open'
          ? Prisma.sql`(v.verdict IS NULL OR v.verdict = 'UNSURE'::"CorrelationVerdict")`
          : Prisma.sql`(v.verdict IS NULL OR v.verdict::text NOT IN ('REJECTED', 'SPLIT'))`,
    );
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '4s'`;
          return tx.$queryRaw<DuplicatePairRow[]>(Prisma.sql`
            SELECT s.a_id, s.b_id, s.family::text AS family,
                   s.weighted::float8 AS weighted, v.verdict::text AS verdict
            FROM correlation_pair_signatures s
            LEFT JOIN correlation_pair_verdicts v ON v.a_id = s.a_id AND v.b_id = s.b_id
            WHERE ${Prisma.join(where, ' AND ')}
            ORDER BY s.weighted DESC, s.a_id, s.b_id
            LIMIT ${DUPLICATE_PAIRS_READ}
          `);
        },
        { timeout: 8_000, maxWait: 3_000 },
      );
    } catch (error) {
      this.logger.warn(`Duplicate pairs failed: ${String(error)}`);
      return [];
    }
  }

  /**
   * The scorer's own edges for pairs matched on values: whether it calls them
   * likely the same or only sharing values, and which values, per label.
   */
  private async scoredEdges(
    pairs: DuplicatePairRow[],
  ): Promise<Map<string, ScoredEdge>> {
    if (!pairs.length) return new Map();
    const rows = await this.prisma.$queryRaw<ScoredEdge[]>(Prisma.sql`
      SELECT e.id, e.from_id, e.to_id, e.relation_type,
             e.metadata->'sharedByLabel' AS shared_by_label
      FROM edges e
      WHERE e.from_type = 'asset' AND e.to_type = 'asset'
        AND e.relation_type IN ('likely_duplicate', 'related')
        AND e.from_id = ANY(${pairs.map((p) => p.a_id)}::text[])
        AND e.to_id = ANY(${pairs.map((p) => p.b_id)}::text[])
    `);
    return new Map(rows.map((r) => [pairKey(r.from_id, r.to_id), r]));
  }

  /** Each asset's source, for telling what comes from elsewhere. */
  private async sourcesOf(ids: string[]): Promise<Map<string, string | null>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.asset.findMany({
      where: { id: { in: ids } },
      select: { id: true, sourceId: true },
    });
    return new Map(rows.map((r) => [r.id, r.sourceId]));
  }

  /**
   * Where to start when nothing is on the canvas, from the data itself: the
   * assets with the most lineage, the duplicate patterns with the most pairs
   * (each with its strongest pair), and the links people drew last. All
   * three are reads of small, indexed tables.
   */
  async starters(): Promise<ExploreStartersResponseDto> {
    const [lineage, patterns, links] = await Promise.all([
      this.lineageStarters(),
      this.patternStarters(),
      this.linkStarters(),
    ]);
    return { lineage, patterns, links };
  }

  private async resolveSeeds(
    assetIds: string[],
    max: number,
  ): Promise<ExploreAsset[]> {
    const wanted = [...new Set(assetIds.filter(Boolean))].slice(0, max);
    if (!wanted.length) return [];
    const found = await this.hydrate(wanted);
    return wanted.flatMap((id) => found.get(id) ?? []);
  }

  /** Edges whose two ends are both among `ids`, of the given kinds. Bounded and timed. */
  private async edgesAmong(
    ids: string[],
    kinds: string[],
  ): Promise<TraceEdgeRow[]> {
    if (ids.length < 2 || !kinds.length) return [];
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '3s'`;
          return tx.$queryRaw<TraceEdgeRow[]>(Prisma.sql`
            SELECT 'asset'::text AS src_type, e.from_id AS src_id, 'out'::text AS dir,
                   e.id, e.from_type, e.from_id, e.to_type, e.to_id,
                   e.relation_type, e.relation_class::text AS relation_class,
                   e.confidence::float8 AS confidence, ${TRACE_KIND_SQL} AS kind,
                   e.origin::text AS origin,
                   e.metadata->'sharedByLabel' AS shared_by_label,
                   e.metadata->>'note' AS note
            FROM edges e
            WHERE e.from_type = 'asset' AND e.from_id = ANY(${ids}::text[])
              AND e.to_type = 'asset' AND e.to_id = ANY(${ids}::text[])
              AND ${TRACE_KIND_SQL} = ANY(${kinds}::text[])
            LIMIT ${EXPLORE_AMONG_LIMIT}
          `);
        },
        { timeout: 6_000, maxWait: 3_000 },
      );
    } catch (error) {
      // The canvas is whole without them; never fail the view for these.
      this.logger.warn(`Edges among the canvas failed: ${String(error)}`);
      return [];
    }
  }

  private async hydrate(ids: string[]): Promise<Map<string, ExploreAsset>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.asset.findMany({
      where: { id: { in: ids }, status: { not: 'DELETED' } },
      select: {
        id: true,
        name: true,
        assetType: true,
        sourceType: true,
        sourceId: true,
        source: { select: { name: true } },
      },
    });
    return new Map(
      rows.map((a) => [
        a.id,
        {
          id: a.id,
          label: a.name,
          assetType: a.assetType ? String(a.assetType) : null,
          sourceType: a.sourceType ? String(a.sourceType) : null,
          sourceName: a.source?.name ?? null,
          sourceId: a.sourceId,
        },
      ]),
    );
  }

  /**
   * Repeated text: pairs duplicate review found by reading alike passage for
   * passage (the near-duplicate-text family), which the scorer does not write
   * as edges. Read from the review index, as "same as". A pair someone ruled
   * not the same (rejected, or split apart) is left out.
   */
  private async repeatedText(
    seedIds: string[],
  ): Promise<GraphTraceResult | null> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{
          a_id: string;
          b_id: string;
          weighted: number;
          verdict: string | null;
        }>
      >(Prisma.sql`
        SELECT s.a_id, s.b_id, s.weighted::float8 AS weighted, v.verdict::text AS verdict
        FROM correlation_pair_signatures s
        LEFT JOIN correlation_pair_verdicts v ON v.a_id = s.a_id AND v.b_id = s.b_id
        WHERE s.family = 'NEAR_DUPLICATE_TEXT'::"CorrelationPatternFamily"
          AND (s.a_id = ANY(${seedIds}::text[]) OR s.b_id = ANY(${seedIds}::text[]))
          AND (v.verdict IS NULL OR v.verdict::text NOT IN ('REJECTED', 'SPLIT'))
        ORDER BY s.weighted DESC
        LIMIT ${EXPLORE_PER_KIND}
      `);
      if (!rows.length) return null;
      const seedSet = new Set(seedIds);
      const others = rows.map((r) => (seedSet.has(r.a_id) ? r.b_id : r.a_id));
      const assets = await this.hydrate(others);
      const nodes: GraphTraceResult['nodes'] = [];
      for (const id of new Set(others)) {
        const a = assets.get(id);
        if (!a || seedSet.has(id)) continue;
        nodes.push({
          ...a,
          type: 'asset',
          status: null,
          missing: false,
          depth: 1,
          side: 'side',
          via: null,
          viaKind: 'duplicates',
        });
      }
      return {
        nodes,
        edges: rows.map((r) => ({
          id: `px:${r.a_id}:${r.b_id}`,
          fromType: 'asset',
          fromId: r.a_id,
          toType: 'asset',
          toId: r.b_id,
          relationType:
            r.verdict === 'CONFIRMED'
              ? 'repeated_text_confirmed'
              : 'repeated_text',
          relationClass: 'IDENTITY',
          kind: 'duplicates',
          confidence: Number(r.weighted),
          origin: 'INFERRED',
          sharedByLabel: null,
          note: null,
        })),
        truncated: rows.length >= EXPLORE_PER_KIND,
      };
    } catch (error) {
      this.logger.warn(`Repeated-text pairs failed: ${String(error)}`);
      return null;
    }
  }

  private async meaning(seedIds: string[]): Promise<MeaningPart | null> {
    if (!this.semanticLayer) return null;
    try {
      return await this.semanticLayer.meaningTrace(
        seedIds,
        EXPLORE_MEANING_LIMIT,
      );
    } catch (error) {
      // One kind failing must not blank the others.
      this.logger.warn(`Meaning lookup failed: ${String(error)}`);
      return null;
    }
  }

  private async alike(
    seedIds: string[],
  ): Promise<{ status: 'ok' | 'off'; parts: AlikePart[] }> {
    const parts: AlikePart[] = [];
    for (const seedId of seedIds.slice(0, EXPLORE_ALIKE_SEEDS)) {
      let hits: Array<{ id: string; score: number; text?: string | null }>;
      try {
        hits = await this.embeddings.assetsAlike(
          seedId,
          EXPLORE_ALIKE_PER_SEED,
        );
      } catch (error) {
        if (error instanceof ServiceUnavailableException) {
          return { status: 'off', parts: [] };
        }
        this.logger.warn(`Alike lookup failed for ${seedId}: ${String(error)}`);
        continue;
      }
      const assets = await this.hydrate(hits.map((h) => h.id));
      parts.push({
        seedId,
        hits: hits.flatMap((h) => {
          const asset = assets.get(h.id);
          return asset
            ? [{ asset, score: Number(h.score), text: h.text ?? null }]
            : [];
        }),
      });
    }
    return { status: 'ok', parts };
  }

  private async patternStarters() {
    const patterns = await this.prisma.correlationPattern.findMany({
      orderBy: { pairCount: 'desc' },
      take: 4,
      select: {
        patternKey: true,
        family: true,
        labels: true,
        pairCount: true,
        assetCount: true,
      },
    });
    const pairs = await Promise.all(
      patterns.map((p) =>
        this.prisma.correlationPairSignature.findFirst({
          where: { patternKey: p.patternKey },
          orderBy: { weighted: 'desc' },
          select: { aId: true, bId: true },
        }),
      ),
    );
    const refs = await this.assetRefs(
      pairs.flatMap((pair) => (pair ? [pair.aId, pair.bId] : [])),
    );
    return patterns.flatMap((p, i) => {
      const pair = pairs[i];
      const a = pair && refs.get(pair.aId);
      const b = pair && refs.get(pair.bId);
      if (!a || !b) return [];
      return [
        {
          patternKey: p.patternKey,
          family: String(p.family),
          labels: p.labels,
          pairCount: p.pairCount,
          assetCount: p.assetCount,
          pair: [a, b],
        },
      ];
    });
  }

  /**
   * The assets with the most lineage. The review index keeps each asset's
   * lineage degree; before it has been built, a bounded sample of lineage
   * edges stands in for it.
   */
  private async lineageStarters() {
    let rows = await this.prisma.$queryRaw<
      Array<{ asset_id: string; degree: number }>
    >(Prisma.sql`
      SELECT asset_id, degree FROM asset_lineage_profiles
      WHERE degree > 0 ORDER BY degree DESC LIMIT 12
    `);
    if (!rows.length) {
      rows = await this.prisma.$queryRaw<
        Array<{ asset_id: string; degree: number }>
      >(Prisma.sql`
        SELECT x.id AS asset_id, count(*)::int AS degree
        FROM (
          SELECT from_id AS id FROM edges
          WHERE relation_class = 'FLOW'::"EdgeClass" AND from_type = 'asset'
          LIMIT ${LINEAGE_SAMPLE}
        ) x
        GROUP BY x.id ORDER BY degree DESC LIMIT 12
      `);
    }
    const refs = await this.assetRefs(rows.map((r) => r.asset_id));
    return rows
      .flatMap((r) => {
        const asset = refs.get(r.asset_id);
        return asset ? [{ asset, degree: Number(r.degree) }] : [];
      })
      .slice(0, 6);
  }

  /**
   * Which assets on the canvas are evidence in a case, and which carry open
   * findings a watch (inquiry) is answering. Bounded; a failure marks nothing.
   */
  private async marks(assetIds: string[]): Promise<ExploreMarks> {
    const none: ExploreMarks = { cases: [], inquiries: [] };
    if (!assetIds.length) return none;
    try {
      const evidence = await this.prisma.caseEvidence.findMany({
        where: { entityType: 'asset', entityId: { in: assetIds } },
        select: {
          entityId: true,
          investigation: { select: { id: true, title: true, status: true } },
        },
      });
      const cases = new Map<string, ExploreMarks['cases'][number]>();
      for (const e of evidence) {
        const c = e.investigation;
        const mark = cases.get(c.id) ?? {
          id: c.id,
          title: c.title,
          status: String(c.status),
          assetIds: [],
        };
        mark.assetIds.push(e.entityId);
        cases.set(c.id, mark);
      }

      const inquiries = new Map<string, ExploreMarks['inquiries'][number]>();
      if (this.matching) {
        const findings = await this.prisma.finding.findMany({
          where: { assetId: { in: assetIds }, status: 'OPEN' },
          select: { id: true, assetId: true },
          take: WATCH_FINDING_LIMIT,
        });
        const watched = await this.matching.watchedBy(
          findings.map((f) => f.id),
        );
        const assetOf = new Map(findings.map((f) => [f.id, f.assetId]));
        const byInquiry = new Map<string, Set<string>>();
        for (const [findingId, inquiryIds] of watched) {
          const assetId = assetOf.get(findingId);
          if (!assetId) continue;
          for (const id of inquiryIds) {
            const set = byInquiry.get(id) ?? new Set<string>();
            set.add(assetId);
            byInquiry.set(id, set);
          }
        }
        if (byInquiry.size) {
          const rows = await this.prisma.inquiry.findMany({
            where: { id: { in: [...byInquiry.keys()] } },
            select: { id: true, title: true, status: true },
          });
          for (const q of rows) {
            inquiries.set(q.id, {
              id: q.id,
              title: q.title,
              status: String(q.status),
              assetIds: [...(byInquiry.get(q.id) ?? [])],
            });
          }
        }
      }
      return { cases: [...cases.values()], inquiries: [...inquiries.values()] };
    } catch (error) {
      this.logger.warn(`Case and watch marks failed: ${String(error)}`);
      return none;
    }
  }

  private async linkStarters() {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        from_id: string;
        to_id: string;
        relation_type: string;
        note: string | null;
        created_at: Date;
      }>
    >(Prisma.sql`
      SELECT id, from_id, to_id, relation_type, metadata->>'note' AS note, created_at
      FROM edges
      WHERE origin = 'MANUAL'::"EdgeOrigin"
        AND from_type = 'asset' AND to_type = 'asset'
      ORDER BY created_at DESC
      LIMIT 6
    `);
    const refs = await this.assetRefs(
      rows.flatMap((r) => [r.from_id, r.to_id]),
    );
    return rows.flatMap((r) => {
      const from = refs.get(r.from_id);
      const to = refs.get(r.to_id);
      if (!from || !to) return [];
      return [
        {
          id: r.id,
          relationType: r.relation_type,
          note: r.note,
          from,
          to,
          createdAt: r.created_at,
        },
      ];
    });
  }

  private async assetRefs(
    ids: string[],
  ): Promise<Map<string, ExploreAssetRefDto>> {
    const assets = await this.hydrate([...new Set(ids)]);
    return new Map(
      [...assets.values()].map((a) => [
        a.id,
        { id: a.id, name: a.label, sourceName: a.sourceName },
      ]),
    );
  }
}
