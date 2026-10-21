import {
  BadRequestException,
  ServiceUnavailableException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FindingStatus, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import { UnionFind } from '../utils/union-find';
import { mapBounded } from '../utils/map-bounded';
import { EmbeddingCapabilityService } from './embedding-capability.service';
import { featureOffMessage } from '../maintenance/workspace-features.constants';
import { EmbeddingAnalysisService } from './embedding-analysis.service';
import { PutAssetChunksDto } from './dto/embedding.dto';
import { EmbeddingConfigService } from './embedding-config.service';
import {
  resolvedFromEnv,
  // A value import, not `import type`: `emitDecoratorMetadata` writes
  // design:paramtypes from the imported binding, and a type-only import is
  // erased before that metadata is emitted. Nest then cannot resolve the
  // parameter and — because it is @Optional() — quietly injects undefined, so
  // every read here fell back to the deployment defaults and the workspace's
  // own embedding settings were ignored by everything but the settings page.
  EmbeddingSettingsService,
  type ResolvedEmbeddingConfig,
} from './embedding-settings.service';
import { embeddingContentHash, windowsOntoOnePassage } from './embedding-text';
import { reasonsForStorage, type StoredReason } from './reason-labels';
import { MAX_INDEXED_DIMENSIONS, vectorCast } from './embedding-vector';
import {
  COMMON_TERM_SHARE,
  FIGURE_FLOOR,
  FIGURE_SHARE,
  LEXICAL_TIMEOUT_MS,
  MAX_QUERY_TERMS,
  PASSAGE_CHARS,
  squeezedFigures,
  type LexicalChunkHit,
} from './chunk-lexical';
import {
  MAX_MEDIA_BYTES,
  isMediaModality,
  mediaContentHash,
  mediaScanCacheKey,
  type MediaModality,
} from './embedding-modality';

type SimilarityRow = {
  id: string;
  score: number;
  /** Where in the asset the best match is: its chunk's page and text. */
  page?: number | null;
  text?: string | null;
};
/** One neighbour of a (content hash, finding type) pair. */
type NeighborhoodSeedRow = {
  targetHash: string;
  findingType: string;
  neighborHash: string;
  score: number;
};

type NeighborhoodRow = {
  findingId: string;
  targetHash: string;
  neighborHash: string;
  score: number;
};
type BoilerplateClusterRow = {
  groupHash: string;
  findingCount: bigint | number;
  findingIds: string[];
  meanImportance: number;
  sourceCount: bigint | number;
  sourceIds: string[];
  assetIds: string[];
};

// Outlier/quality adjustments need at least this many same-type neighbours to
// mean anything; below it the neighbourhood signal is treated as unavailable.
const MIN_NEIGHBORHOOD = 5;
// "Semantically unusual" must be rare to mean anything. On MiniLM over diverse
// evidence text the corpus-median outlier strength is ~0.3, so the reason/bonus
// bar sits at the top decile (~0.55) rather than the old 0.35, which flagged
// half the corpus.
const OUTLIER_BONUS_THRESHOLD = 0.55;

/**
 * Cosine from which two pieces of evidence are taken for the same text said
 * twice. One number for every model, which is a simplification: models spread
 * their scores very differently (see the embeddings docs, "How alike is
 * alike"), so the same cut-off is strict on one and loose on another.
 */
const NEAR_DUPLICATE_MIN = 0.95;
const RECALIBRATE_BATCH_SIZE = 500;
/** Findings read per page when fanning a neighbourhood back out. */
const NEIGHBORHOOD_PAGE_SIZE = 2000;

/**
 * Batches of already-scored findings one pass will refresh, after it has
 * finished scoring everything unscored.
 *
 * The refresh keeps scores corpus-relative as the space grows, but it must
 * never crowd out the phase that makes unscored evidence visible at all —
 * bounded here so a pass always terminates and the next one continues from the
 * next-stalest rows.
 */
const RECALIBRATE_REFRESH_BATCHES = 20;

/**
 * How many vectors an HNSW search may consider before anything else filters.
 *
 * A semantic search wants "the nearest N rows that also satisfy X". Written
 * literally — join and filter inside the `ORDER BY ... LIMIT` — that is a trap,
 * because `hnsw.iterative_scan = strict_order` keeps pulling more of the graph
 * until LIMIT rows SURVIVE the filter. When the filter is selective the scan
 * degenerates into a near-full traversal.
 *
 * Measured on firmenbuch-test-2 (84k assets, 40,518 vectors): only 2,003 of
 * those vectors belong to an asset chunk — the rest are finding and glossary
 * embeddings sharing the space. Asking for 1,000 asset-chunk candidates made
 * the index scan read 19,733 rows and still return only 929, at 107 seconds.
 * Bounding the vector search first and joining afterwards read exactly 1,000
 * and took 15. The failure gets worse as more content is embedded, since every
 * non-matching vector dilutes the space further.
 *
 * The trade is recall: the survivors of a fixed candidate set can be fewer than
 * the caller asked for. Over-fetching by 5x absorbs that — near neighbours of a
 * chunk query are overwhelmingly chunks themselves (58% survived in the same
 * measurement, against the 4.9% base rate) — and a bounded, slightly shorter
 * result beats an exact one nobody waits for.
 */
function candidateBudget(limit: number): number {
  return Math.max(limit * 5, 200);
}

/**
 * One ranked list out of two, keeping each id's better score.
 *
 * An asset can be in both — a scanned page is found by its text and by its
 * picture — and it is one result, as good as its best match.
 */
export function mergeBestScores(
  left: SimilarityRow[],
  right: SimilarityRow[],
  limit: number,
): SimilarityRow[] {
  const best = new Map<string, number>();
  for (const row of [...left, ...right]) {
    const score = Number(row.score);
    const known = best.get(row.id);
    if (known === undefined || score > known) best.set(row.id, score);
  }
  return [...best.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** How one kind of content scores a question on the whole: what a single score is read against. */
export interface ScoreBackground {
  /** The middle score of its kind for this question (the median). */
  middle: number;
  count: number;
}

/** A picture or a clip with its score, and how its kind scored the same question. */
export type MediaScoreRow = SimilarityRow & ScoreBackground;

/** Fewer items of a kind than this are no background to measure a score against. */
const MIN_BACKGROUND = 8;

/** Text passages read to learn how text scores a question. */
const BACKGROUND_SAMPLE = 512;

/**
 * One ranked list out of text and media, each read against its own kind.
 *
 * A model puts text, pictures and sound in one space, but not at one
 * distance. The picture a caption describes sits further from the caption
 * than an unrelated sentence does: measured with Gemini Embedding 2, "a dog
 * barking" scored 0.62 against the recording of the dog and 0.56 against a
 * sentence about an invoice. Ranked by raw score, every passage in the
 * workspace came before the one clip that answered, and a model that picked
 * the right clip nine times in ten found none in the product.
 *
 * So each result is placed by how far its score lies above the middle of its
 * own kind for this question: text above the median of a sample of the
 * passages, pictures above the median of all pictures, sound above the median
 * of all sound. The cosine each row carries is left as it was; only the order
 * uses the standing.
 *
 * The median and nothing more, on purpose. Dividing by each kind's spread as
 * well (a z-score) was tried on the same questions and lost: a kind in which
 * several items answer (a photograph and four copies of it) has a wide
 * spread and was marked down for it, and a kind in which nothing answers has
 * a narrow one and was marked up. Measured over 110 questions, right result
 * first, raw / z-score / above the median: Gemini Embedding 2 83 / 81 / 92,
 * SigLIP 2 43 / 44 / 51, CLIP 42 / 54 / 57.
 *
 * A kind with too few items to have a middle (a workspace with three
 * photographs) is read against the text's, which is the old behaviour.
 */
export function mergeByStanding(
  text: SimilarityRow[],
  textBackground: ScoreBackground | null,
  media: MediaScoreRow[],
  limit: number,
): SimilarityRow[] {
  const usable = (background: ScoreBackground | null) =>
    background != null &&
    background.count >= MIN_BACKGROUND &&
    Number.isFinite(background.middle);
  if (!usable(textBackground)) {
    return mergeBestScores(text, media, limit);
  }
  const base = textBackground as ScoreBackground;

  const best = new Map<string, { score: number; standing: number }>();
  const place = (id: string, score: number, stands: number) => {
    const known = best.get(id);
    if (!known || stands > known.standing) {
      best.set(id, { score, standing: stands });
    }
  };
  for (const row of text) {
    const score = Number(row.score);
    place(row.id, score, score - base.middle);
  }
  for (const row of media) {
    const score = Number(row.score);
    const own = { middle: Number(row.middle), count: Number(row.count) };
    place(row.id, score, score - (usable(own) ? own : base).middle);
  }
  return [...best.entries()]
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => b.standing - a.standing)
    .slice(0, limit)
    .map(({ id, score }) => ({ id, score }));
}

/** Content hashes per neighbourhood query (one short transaction each). */
const NEIGHBOURHOOD_SEED_SLICE = 200;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly config: EmbeddingConfigService;
  // Per-namespace-schema caches — each tenant has its own embedding space row.
  private readonly configuredSpacePromises = new Map<
    string,
    ReturnType<EmbeddingService['ensureSpace']>
  >();
  private readonly configuredSpaceIds = new Map<string, string>();
  /** Detached HNSW builds in flight, keyed schema.index, so two callers do not both start one. */
  private readonly hnswBuilds = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly capability: EmbeddingCapabilityService,
    private readonly analysis: EmbeddingAnalysisService,
    config?: EmbeddingConfigService,
    @Optional() private readonly cls?: ClsService,
    // Optional and last so the unit tests that construct this service
    // positionally keep working; without it every read falls back to the
    // deployment defaults, which is exactly what those tests assume.
    @Optional() private readonly settings?: EmbeddingSettingsService,
  ) {
    this.config = config ?? new EmbeddingConfigService();
  }

  /**
   * Effective configuration for the current workspace.
   *
   * Synchronous by design: this is read inside open transactions and inside
   * SQL string interpolation. The settings service keeps a per-schema cache
   * that is warmed before any of those paths run and dropped whenever the
   * settings change.
   */
  private get cfg(): ResolvedEmbeddingConfig {
    return this.settings?.cached() ?? resolvedFromEnv(this.config);
  }

  private schemaKey(): string {
    return this.cls?.get<string>(CLS_SCHEMA) ?? '__default__';
  }

  status() {
    return {
      enabled: this.cfg.enabled,
      pgvector: true,
      pgvectorVersion: this.capability.version(),
      searchStrategy: 'per-space-hnsw',
      provider: this.cfg.provider,
      model: this.cfg.model,
      dimensions: this.cfg.dimensions,
      spaceId: this.configuredSpaceIds.get(this.schemaKey()),
    };
  }

  configuredSpace() {
    const key = this.schemaKey();
    let promise = this.configuredSpacePromises.get(key);
    if (!promise) {
      promise = this.resolveSpaceInput()
        .then((input) => this.ensureSpace(input))
        .then((space) => {
          this.configuredSpaceIds.set(key, space.id);
          return space;
        });
      this.configuredSpacePromises.set(key, promise);
    }
    return promise;
  }

  /**
   * The coordinate system this workspace is configured for.
   *
   * Awaiting the resolver here is what warms the synchronous cache {@link cfg}
   * reads: every path that touches a space goes through configuredSpace first.
   */
  private async resolveSpaceInput() {
    const cfg = this.settings ? await this.settings.resolve() : this.cfg;
    return {
      provider: cfg.provider,
      model: cfg.model,
      revision: cfg.revision,
      dim: cfg.dimensions,
      pooling: cfg.pooling,
      normalized: cfg.normalize,
    };
  }

  clearForSchema(schema: string): void {
    this.configuredSpacePromises.delete(schema);
    this.configuredSpaceIds.delete(schema);
  }

  /**
   * Refuse semantic reads while embeddings are turned off.
   *
   * A read resolves the configured space, and resolving creates a space that
   * does not exist — so after "turn off and delete" the first similar-findings
   * lookup would quietly re-create an empty corpus and an index build for it.
   * Off means the semantic layer is unavailable, the same answer query
   * embedding already gave: 503, which search callers treat as "fall back to
   * exact text".
   */
  private async assertSemanticEnabled(): Promise<void> {
    const enabled = this.settings
      ? await this.settings.enabledNow()
      : this.cfg.enabled;
    if (!enabled) {
      throw new ServiceUnavailableException(featureOffMessage('embeddings'));
    }
  }

  async ensureSpace(
    input: Omit<ReturnType<EmbeddingConfigService['space']>, 'provider'> & {
      provider?: ReturnType<EmbeddingConfigService['space']>['provider'];
    },
  ) {
    const provider = input.provider ?? this.cfg.provider;
    const space = await this.prisma.$transaction(async (tx) => {
      // All replicas in a rollout serialize space creation/activation. Without
      // this lock, two new pods can race the unique key or leave two spaces
      // active after interleaved updateMany/create transactions.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtext('classifyre.embedding-space-activation')
        )
      `;
      const existing = await tx.embeddingSpace.findUnique({
        where: {
          provider_model_revision_dim_pooling_normalized: {
            provider,
            model: input.model,
            revision: input.revision,
            dim: input.dim,
            pooling: input.pooling,
            normalized: input.normalized,
          },
        },
      });
      if (existing) {
        if (!existing.isActive) {
          await tx.embeddingSpace.updateMany({ data: { isActive: false } });
          return tx.embeddingSpace.update({
            where: { id: existing.id },
            data: { isActive: true },
          });
        }
        return existing;
      }

      await tx.embeddingSpace.updateMany({ data: { isActive: false } });
      return tx.embeddingSpace.create({
        data: { ...input, provider, isActive: true },
      });
    });
    this.ensureHnswIndex(space.id, space.dim);
    return space;
  }

  private async activeSpace() {
    // Bind every operation in this process to the model it booted with.
    // During a rolling deployment, an older pod must never start reading or
    // writing the newer pod's globally active coordinate space.
    return this.configuredSpace();
  }

  /**
   * The per-space HNSW indexes are partial (`WHERE space_id = '<literal>'`).
   * The planner only matches a partial index when the query embeds the same
   * literal — a bound parameter can't be proven equal at plan time — so every
   * vector query must inline the (validated) space id instead of binding it.
   */
  private spaceIdLiteral(spaceId: string): Prisma.Sql {
    if (!/^[0-9a-f-]{36}$/i.test(spaceId)) {
      throw new Error(`Invalid embedding space id ${spaceId}`);
    }
    return Prisma.raw(`'${spaceId}'`);
  }

  /**
   * Bring the space's partial HNSW index into existence, without making
   * anything wait for it.
   *
   * Building this index is not a quick DDL. Measured on a 879,135-vector space
   * at 384 dimensions: roughly twenty minutes. It used to be awaited inside
   * `ensureSpace`, which is awaited by `registerForNamespace`, which the
   * namespace worker manager awaits in sequence — so one space needing its
   * index built stalled that namespace's startup for twenty minutes and every
   * namespace queued behind it with it. On a deployment whose readiness probe
   * has previously turned a slow start into an outage, that is not a cost to
   * pay on the boot path.
   *
   * So the build is detached and runs CONCURRENTLY. Until it finishes,
   * similarity queries fall back to a sequential scan: slower, never wrong.
   *
   * `CONCURRENTLY` cannot run inside a transaction and can leave an invalid
   * index behind if it fails, so a previous failure is detected and dropped
   * before retrying. The schema is captured synchronously and written into the
   * statement, because the detached build outlives the CLS context that would
   * otherwise resolve it — and resolving it late would target whichever
   * namespace happened to be current.
   */
  private ensureHnswIndex(spaceId: string, dim: number): void {
    if (!/^[0-9a-f-]{36}$/i.test(spaceId)) {
      throw new Error(`Invalid embedding space id ${spaceId}`);
    }
    const indexName = `content_embeddings_${spaceId.replaceAll('-', '')}_hnsw`;
    const cast = vectorCast(dim);
    if (!cast.indexed) {
      this.logger.warn(
        `Embedding space ${spaceId} uses ${dim} dimensions, above the ${MAX_INDEXED_DIMENSIONS} ` +
          'an HNSW index can cover. Vectors are stored and searched correctly, but by ' +
          'sequential scan — expect slow similarity queries on a large corpus.',
      );
      return;
    }

    const schema = this.cls?.get<string>(CLS_SCHEMA);
    if (!schema || !/^[A-Za-z0-9_]+$/.test(schema)) {
      this.logger.warn(
        `Cannot build ${indexName}: no usable namespace schema in context.`,
      );
      return;
    }
    const key = `${schema}.${indexName}`;
    if (this.hnswBuilds.has(key)) return;
    this.hnswBuilds.add(key);

    void this.buildHnswIndex(schema, indexName, spaceId, dim, cast)
      .catch((error) => {
        this.logger.error(
          `Background build of ${indexName} failed: ${
            error instanceof Error ? error.message : String(error)
          }. Similarity queries fall back to a sequential scan until it succeeds.`,
        );
      })
      .finally(() => this.hnswBuilds.delete(key));
  }

  private async buildHnswIndex(
    schema: string,
    indexName: string,
    spaceId: string,
    dim: number,
    cast: ReturnType<typeof vectorCast>,
  ): Promise<void> {
    // Is anyone already building it? The in-process guard is not enough: the
    // API and the worker are separate processes that both resolve the space,
    // and a restart brings up a third while the previous build is still
    // running. Postgres itself is the only place that knows.
    //
    // Getting this wrong is not benign. An in-flight CREATE INDEX
    // CONCURRENTLY leaves an *invalid* index row for its whole run, so a
    // second process that reads "invalid" and decides to clean up issues a
    // DROP INDEX CONCURRENTLY against an index that is still being built —
    // and the two wait on each other indefinitely. Observed live: eight such
    // statements stacked up across restarts, none of them progressing, and
    // they blocked the pg-boss maintenance sweep with them.
    const building = await this.prisma.$queryRaw<Array<{ pid: number }>>`
      SELECT pid FROM pg_stat_activity
      WHERE state = 'active'
        AND query ILIKE ${'%INDEX%' + indexName + '%'}
        AND pid <> pg_backend_pid()
      LIMIT 1
    `;
    if (building.length > 0) return;

    const existing = await this.prisma.$queryRaw<Array<{ valid: boolean }>>`
      SELECT i.indisvalid AS valid
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
      WHERE n.nspname = ${schema} AND c.relname = ${indexName}
    `;
    if (existing[0]?.valid) return;
    if (existing.length > 0) {
      // Left invalid by a build that died, and — per the check above — nobody
      // is building it now. A plain DROP, not CONCURRENTLY: an invalid index
      // is not used by any query, so there is no reader to be gentle with,
      // and the concurrent form is exactly what deadlocked against the build.
      this.logger.warn(
        `Dropping invalid ${indexName} left by an interrupted build.`,
      );
      await this.prisma.$executeRawUnsafe(
        `DROP INDEX IF EXISTS "${schema}"."${indexName}"`,
      );
    }

    const started = Date.now();
    this.logger.log(
      `Building ${indexName} in the background (${dim} dimensions, ${cast.type}); ` +
        'similarity queries use a sequential scan until it completes.',
    );
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${indexName}"
         ON "${schema}"."content_embeddings"
         USING hnsw (("vec"::public.${cast.type}(${dim})) ${cast.ops})
         WITH (m = ${this.cfg.hnswM}, ef_construction = ${this.cfg.hnswEfConstruction})
         WHERE "space_id" = '${spaceId}'`,
    );
    this.logger.log(
      `Embedding space ${spaceId} indexed (${this.cfg.provider}:${this.cfg.model}, ` +
        `${dim} dimensions, ${cast.type}) in ${Math.round((Date.now() - started) / 1000)}s`,
    );
  }

  async missingHashes(hashes: string[], spaceId?: string) {
    const resolvedSpaceId = spaceId ?? (await this.activeSpace()).id;
    const uniqueHashes = [...new Set(hashes)];
    const present = await this.prisma.contentEmbedding.findMany({
      where: { spaceId: resolvedSpaceId, contentHash: { in: uniqueHashes } },
      select: { contentHash: true },
    });
    const presentSet = new Set(present.map((item) => item.contentHash));
    return uniqueHashes.filter((hash) => !presentSet.has(hash));
  }

  async missing(
    spaceInput: Omit<
      ReturnType<EmbeddingConfigService['space']>,
      'provider'
    > & {
      provider?: ReturnType<EmbeddingConfigService['space']>['provider'];
    },
    hashes: string[],
  ) {
    const space = await this.ensureSpace({
      ...spaceInput,
      provider: spaceInput.provider ?? this.cfg.provider,
    });
    const present = await this.prisma.contentEmbedding.findMany({
      where: {
        spaceId: space.id,
        contentHash: { in: [...new Set(hashes)] },
      },
      select: { contentHash: true },
    });
    const presentSet = new Set(present.map((item) => item.contentHash));
    // Self-heal: a vector that is already stored but whose finding lost its
    // evidence analysis (manual deletion, partial failure) is re-analyzed as
    // part of negotiation, so scans repair ranking coverage as they run.
    if (presentSet.size) {
      const unanalyzed = await this.prisma.finding.findMany({
        where: {
          embedContentHash: { in: [...presentSet] },
          evidenceAnalysis: null,
        },
        select: { embedContentHash: true },
        distinct: ['embedContentHash'],
      });
      const healHashes = unanalyzed
        .map((row) => row.embedContentHash)
        .filter((hash): hash is string => hash !== null);
      if (healHashes.length) {
        await this.analyzeAndCalibrate(space, healHashes);
      }
    }
    return {
      spaceId: space.id,
      missing: [...new Set(hashes)].filter((hash) => !presentSet.has(hash)),
    };
  }

  async putVectors(
    input:
      | Array<{ contentHash: string; vector: number[] }>
      | {
          spaceId: string;
          items: Array<{ contentHash: string; vector: number[] }>;
        },
  ) {
    const items = Array.isArray(input) ? input : input.items;
    const space = Array.isArray(input)
      ? await this.activeSpace()
      : await this.prisma.embeddingSpace.findUnique({
          where: { id: input.spaceId },
        });
    if (!space) {
      throw new NotFoundException(`Embedding space not found`);
    }
    const invalid = items.find((item) => item.vector.length !== space.dim);
    if (invalid) {
      throw new BadRequestException(
        `Vector ${invalid.contentHash} has ${invalid.vector.length} dimensions; expected ${space.dim}`,
      );
    }
    if (space.normalized) {
      const unnormalized = items.find((item) => {
        const norm = Math.sqrt(
          item.vector.reduce((sum, value) => sum + value * value, 0),
        );
        return Math.abs(norm - 1) > 0.02;
      });
      if (unnormalized) {
        throw new BadRequestException(
          `Vector ${unnormalized.contentHash} is not normalized`,
        );
      }
    }

    let created = 0;
    if (items.length) {
      const hashes = items.map((item) => item.contentHash);
      const vectors = items.map((item) => JSON.stringify(item.vector));
      // Cast to the column's own representation rather than naming `vector`
      // outright. Postgres would coerce it either way (vector -> halfvec is an
      // implicit cast), but going through the same resolver the index and every
      // ORDER BY use keeps one definition of what a stored vector is.
      const storedType = Prisma.raw(vectorCast(space.dim).type);
      created = await this.prisma.$executeRaw`
        INSERT INTO content_embeddings (space_id, content_hash, vec)
        SELECT ${space.id}, t.content_hash, t.vec::public.${storedType}
        FROM unnest(${hashes}::text[], ${vectors}::text[])
          AS t(content_hash, vec)
        ON CONFLICT (space_id, content_hash) DO NOTHING
      `;
    }
    await this.analyzeAndCalibrate(
      space,
      items.map((item) => item.contentHash),
    );
    return { created, received: items.length };
  }

  // Evidence analysis and neighborhood calibration are ranking enhancements on
  // top of already-committed vectors. A failure here must not fail ingestion:
  // it once turned every embedding batch into a pg-boss retry storm on desktop.
  // The debounced full recalibration pass (and the self-heal in missing())
  // repairs any gap left behind.
  private async analyzeAndCalibrate(
    space: { id: string; dim: number },
    contentHashes: string[],
  ): Promise<void> {
    try {
      await this.analysis.analyzeHashes(space.id, contentHashes);
      await this.calibrateNeighborhood(space, contentHashes);
    } catch (error) {
      this.logger.error(
        `Evidence analysis failed for ${contentHashes.length} hashes in space ${space.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Re-run evidence analysis and neighbourhood calibration. Insert-time
   * calibration is order-dependent — the first vectors stored see a nearly
   * empty space — so this pass exists to make importance scores corpus-relative
   * instead of insert-order-relative.
   *
   * Two phases, and the order between them is the point.
   *
   * It used to be one walk over every embedded finding in `id asc` order. Under
   * continuous ingestion that never got far enough to reach the findings nobody
   * had scored yet: `id` is a random UUID, so each pass re-scored an arbitrary
   * prefix and the corpus tail stayed at zero. A live instance sat at 27%
   * coverage — 35,667 analyses against 131,905 open findings — while every
   * investigation agent stood down citing unscored evidence.
   *
   * So: score what has never been scored FIRST, so coverage climbs
   * monotonically and a pass cut short still leaves the system better off. Then
   * refresh existing scores, oldest first, bounded — that keeps them
   * corpus-relative without letting the refresh crowd out the new work.
   */
  async recalibrateSpace(spaceId?: string): Promise<{ analyzed: number }> {
    const space = spaceId
      ? await this.prisma.embeddingSpace.findUniqueOrThrow({
          where: { id: spaceId },
        })
      : await this.activeSpace();
    const resolvedSpaceId = space.id;
    const recurrence = await this.analysis.valueRecurrenceSnapshot();

    // Neither phase pages with a cursor, and deliberately so: processing a row
    // takes it out of the set its query selects from — phase 1 gives it an
    // analysis, phase 2 stamps a fresh `analyzedAt` — so re-running the same
    // query always returns the next tranche. A cursor would instead skip rows
    // that entered the set behind it, which is exactly the corpus tail.
    const scored = await this.analyzeBatches(
      { id: resolvedSpaceId, dim: space.dim },
      recurrence,
      {
        embedContentHash: { not: null },
        evidenceAnalysis: { is: null },
      },
      { id: 'asc' },
      // Unbounded: this is the work that makes the ranking usable at all, and
      // the set shrinks as it runs.
      Number.POSITIVE_INFINITY,
    );

    const refreshed = await this.analyzeBatches(
      { id: resolvedSpaceId, dim: space.dim },
      recurrence,
      { embedContentHash: { not: null }, evidenceAnalysis: { isNot: null } },
      // Stalest scores first, so successive passes rotate through the corpus
      // instead of re-refreshing the same prefix forever.
      { evidenceAnalysis: { analyzedAt: 'asc' } },
      RECALIBRATE_REFRESH_BATCHES,
    );

    await this.prisma.embeddingSpace.update({
      where: { id: resolvedSpaceId },
      data: { lastRecalibratedAt: new Date() },
      select: { id: true },
    });
    const analyzed = scored + refreshed;
    this.logger.log(
      `Recalibrated evidence analyses in space ${resolvedSpaceId}: ` +
        `${scored} newly scored, ${refreshed} refreshed`,
    );
    return { analyzed };
  }

  /**
   * Drive one analysis phase: pull a batch, score it, yield, repeat.
   *
   * `maxBatches` bounds the phase so a pass always terminates — an unbounded
   * refresh over a corpus that grows every two minutes never returns.
   *
   * The bound is on rows ANALYZED, not on batches of seed findings, because
   * those are not the same number and were not close. A batch is 500 findings,
   * but `analyzeHashes` expands each to every finding sharing its content hash,
   * and on the Firmenbuch corpus one `tag:Legal form` hash is 56,405 of them.
   * So `20 x 500 = 10,000` described no limit: a single refresh pass rewrote all
   * 603,633 analyses, and the lifetime counters read 7,372,783 updates against
   * 604,235 rows — twelve rewrites apiece, and about 480 MB of the table's
   * 1024 MB was the free space they left behind.
   *
   * A phase that stops short is safe by construction: the refresh orders by
   * `analyzedAt`, so whatever it did not reach is what the next pass starts on.
   */
  private async analyzeBatches(
    space: { id: string; dim: number },
    recurrence: Awaited<
      ReturnType<EmbeddingAnalysisService['valueRecurrenceSnapshot']>
    >,
    where: Prisma.FindingWhereInput,
    orderBy: Prisma.FindingOrderByWithRelationInput,
    maxBatches: number,
  ): Promise<number> {
    // Phase 1 passes Infinity and means it: scoring the never-scored is the
    // work that makes the ranking usable, and its cohort expansion is not
    // waste — adding one finding to a cohort genuinely changes `similarCount`
    // for every existing member, so they all have to be rewritten.
    const maxRows =
      maxBatches === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : maxBatches * RECALIBRATE_BATCH_SIZE;
    let analyzed = 0;
    let spent = 0;
    for (let batch = 0; batch < maxBatches; batch++) {
      const findings = await this.prisma.finding.findMany({
        where,
        orderBy,
        take: RECALIBRATE_BATCH_SIZE,
        select: { id: true, embedContentHash: true },
      });
      if (!findings.length) break;
      const hashes = [
        ...new Set(
          findings
            .map((finding) => finding.embedContentHash)
            .filter((hash): hash is string => typeof hash === 'string'),
        ),
      ];
      if (hashes.length > 0) {
        // Both walks spend the budget, and both walk the same cohorts. Counting
        // only the analysis side let a bounded pass do up to twice the rows it
        // reported — still terminating, but a looser bound than the number
        // says. `spent` is what the budget is measured against; `analyzed` is
        // what the pass reports, and stays the count of findings analysed so
        // the log line keeps meaning one thing.
        const budget = maxRows - spent;
        const visited = await this.analysis.analyzeHashes(
          space.id,
          hashes,
          recurrence,
          budget,
        );
        analyzed += visited;
        spent += visited;
        spent += await this.calibrateNeighborhood(
          space,
          hashes,
          maxRows - spent,
        );
      } else {
        analyzed += findings.length;
        spent += findings.length;
      }
      if (spent >= maxRows) break;
      if (findings.length < RECALIBRATE_BATCH_SIZE) break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    return analyzed;
  }

  /**
   * Findings sharing the given content hashes, read in bounded pages.
   *
   * The count is not bounded by the caller's batch: a hash is shared by
   * hundreds of findings, so this is the set that used to arrive as one
   * multi-million-row join. Paging keeps the peak flat regardless of how
   * popular a hash turns out to be.
   */
  private async *findingPagesForHashes(contentHashes: string[]) {
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.finding.findMany({
        where: { embedContentHash: { in: contentHashes } },
        select: { id: true, embedContentHash: true, findingType: true },
        orderBy: { id: 'asc' },
        take: NEIGHBORHOOD_PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (!page.length) return;
      yield page;
      if (page.length < NEIGHBORHOOD_PAGE_SIZE) return;
      cursor = page.at(-1)?.id;
    }
  }

  /**
   * Of the given near pairs, the ones that are two windows onto one passage
   * (see windowsOntoOnePassage), keyed `target\0neighbour`.
   *
   * One row per content hash is enough to judge: the hash IS the evidence
   * text, so every finding sharing it has the same match and surroundings.
   */
  private async pairsOntoOnePassage(
    pairs: Array<{ targetHash: string; neighborHash: string }>,
  ): Promise<Set<string>> {
    const found = new Set<string>();
    if (!pairs.length) return found;
    const hashes = [
      ...new Set(pairs.flatMap((pair) => [pair.targetHash, pair.neighborHash])),
    ];
    let rows: Array<{
      hash: string;
      matched: string;
      before: string | null;
      after: string | null;
    }>;
    try {
      rows = await this.prisma.$queryRaw(Prisma.sql`
        SELECT DISTINCT ON (embed_content_hash)
          embed_content_hash AS hash,
          matched_content AS matched,
          context_before AS before,
          context_after AS after
        FROM findings
        WHERE embed_content_hash = ANY(${hashes}::text[])
      `);
    } catch (error) {
      // Grouping too much is the old behaviour; failing the whole
      // recalibration over a refinement of it would be worse.
      this.logger.warn(
        `Could not read evidence text to tell passages from repeats: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return found;
    }
    const byHash = new Map(rows.map((row) => [row.hash, row]));
    for (const pair of pairs) {
      const left = byHash.get(pair.targetHash);
      const right = byHash.get(pair.neighborHash);
      if (left && right && windowsOntoOnePassage(left, right)) {
        found.add(`${pair.targetHash}\u0000${pair.neighborHash}`);
      }
    }
    return found;
  }

  private neighbourhoodSeeds(
    spaceId: Prisma.Sql,
    dim: Prisma.Sql,
    vecType: Prisma.Sql,
    contentHashes: string[],
  ): Promise<NeighborhoodSeedRow[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.raw(`SET LOCAL hnsw.ef_search = ${this.cfg.hnswEfSearch}`),
      );
      await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = relaxed_order`;
      return tx.$queryRaw<NeighborhoodSeedRow[]>(Prisma.sql`
        SELECT target.embed_content_hash AS "targetHash",
          target.finding_type AS "findingType",
          neighbor.content_hash AS "neighborHash",
          1 - (target_embedding.vec <=> neighbor.vec) AS score
        FROM (
          SELECT DISTINCT embed_content_hash, finding_type
          FROM findings
          WHERE embed_content_hash = ANY(${contentHashes}::text[])
        ) target
        JOIN content_embeddings target_embedding
          ON target_embedding.content_hash = target.embed_content_hash
         AND target_embedding.space_id = ${spaceId}
        CROSS JOIN LATERAL (
          SELECT candidate.content_hash, candidate.vec
          FROM content_embeddings candidate
          WHERE candidate.space_id = ${spaceId}
            AND candidate.vec IS NOT NULL
            AND candidate.content_hash != target.embed_content_hash
            AND EXISTS (
              SELECT 1 FROM findings neighbor_finding
              WHERE neighbor_finding.embed_content_hash = candidate.content_hash
                AND neighbor_finding.finding_type = target.finding_type
            )
          ORDER BY candidate.vec::public.${vecType}(${dim}) <=>
            target_embedding.vec::public.${vecType}(${dim})
          LIMIT 10
        ) neighbor
      `);
    });
  }

  private async calibrateNeighborhood(
    space: { id: string; dim: number },
    contentHashes: string[],
    // Same budget as `analyzeHashes`, for the same reason: this walks the
    // cohorts too, so a caller that bounded the analysis and not this one has
    // bounded nothing.
    maxRows = Number.POSITIVE_INFINITY,
  ): Promise<number> {
    if (!contentHashes.length || maxRows <= 0) return 0;
    const spaceId = this.spaceIdLiteral(space.id);
    const dim = Prisma.raw(String(space.dim));
    // Must match the expression ensureHnswIndex built, or the planner ignores
    // the index and silently falls back to a sequential scan.
    const vecType = Prisma.raw(vectorCast(space.dim).type);
    // One short transaction per slice of hashes: SET LOCAL needs a transaction,
    // and an interactive one expires after a few seconds. One per batch did,
    // on every batch of ~1,500 chunks with 3,072-dimension vectors ("A commit
    // cannot be executed on an expired transaction", classifyre-dev
    // 2026-10-20), and each failure cost the batch a minute and its ranking.
    const seeds: NeighborhoodSeedRow[] = [];
    for (
      let start = 0;
      start < contentHashes.length;
      start += NEIGHBOURHOOD_SEED_SLICE
    ) {
      const slice = contentHashes.slice(
        start,
        start + NEIGHBOURHOOD_SEED_SLICE,
      );
      seeds.push(
        ...(await this.neighbourhoodSeeds(spaceId, dim, vecType, slice)),
      );
    }

    // The candidate pre-filters (space, hash, finding_type) are applied after
    // the index scan; relaxed_order lets the scan keep going until LIMIT is
    // filled instead of falling back to an exact full-table sort.

    // Neighbours per (hash, finding_type), expanded to findings here.
    //
    // The query used to select `FROM findings target`, so it returned a row
    // per finding per neighbour — and a content hash is shared by many
    // findings: on a real corpus, 391 on average and 6,344 at the worst. A
    // 500-finding batch therefore dissolved into ~156,000 targets and ~1.5M
    // rows, which is how a bounded-looking batch allocated gigabytes and took
    // the API down with "Ineffective mark-compacts near heap limit".
    //
    // The neighbourhood does not vary per finding: the candidate filter is on
    // finding_type, so every finding sharing a (hash, type) has the same
    // answer. Computing it once and fanning it out here is the same result
    // from ~400 rows instead of ~1.5M — nothing is sampled or dropped.
    // Two findings a few words apart share nearly all of their evidence text.
    // Those are one passage, not a repeat, and are kept out of the grouping.
    const onePassage = await this.pairsOntoOnePassage(
      seeds.filter((row) => Number(row.score) >= NEAR_DUPLICATE_MIN),
    );
    const repeats = (row: { targetHash: string; neighborHash: string }) =>
      !onePassage.has(`${row.targetHash}\u0000${row.neighborHash}`);

    const seedsByKey = new Map<string, NeighborhoodSeedRow[]>();
    const nearDuplicateComponents = new UnionFind([]);
    for (const row of seeds) {
      const normalized = { ...row, score: Number(row.score) };
      const key = `${row.targetHash}\u0000${row.findingType}`;
      const values = seedsByKey.get(key) ?? [];
      values.push(normalized);
      seedsByKey.set(key, values);
      if (normalized.score >= NEAR_DUPLICATE_MIN && repeats(row)) {
        nearDuplicateComponents.union(row.targetHash, row.neighborHash);
      }
    }

    const componentMembers = new Map<string, string[]>();
    for (const hash of nearDuplicateComponents.ids()) {
      const root = nearDuplicateComponents.find(hash);
      const members = componentMembers.get(root) ?? [];
      members.push(hash);
      componentMembers.set(root, members);
    }
    const duplicateGroupByHash = new Map<string, string>();
    for (const members of componentMembers.values()) {
      const groupHash = [...members].sort()[0];
      for (const hash of members) duplicateGroupByHash.set(hash, groupHash);
    }
    // Analysed a page at a time, holding one page rather than every finding
    // that shares these hashes.
    //
    // Paging only the *read* was not enough: the rows were still accumulated
    // into one array before processing, and a heap snapshot taken at the
    // fatal moment showed 7.8 million UUID strings live, all of them elements
    // of driver result arrays. The bound has to cover what is retained, not
    // just what is fetched.
    let calibrated = 0;
    for await (const fullPage of this.findingPagesForHashes(contentHashes)) {
      const page = fullPage.slice(0, maxRows - calibrated);
      calibrated += page.length;
      const grouped = new Map<string, NeighborhoodRow[]>();
      for (const target of page) {
        const seedsForTarget = seedsByKey.get(
          `${target.embedContentHash}\u0000${target.findingType}`,
        );
        if (!seedsForTarget?.length) continue;
        grouped.set(
          target.id,
          seedsForTarget.map((seed) => ({
            findingId: target.id,
            targetHash: seed.targetHash,
            neighborHash: seed.neighborHash,
            score: seed.score,
          })),
        );
      }
      if (!grouped.size) continue;

      const analyses = await this.prisma.findingEvidenceAnalysis.findMany({
        where: { findingId: { in: [...grouped.keys()] } },
      });
      const analysisByFinding = new Map(
        analyses.map((analysis) => [analysis.findingId, analysis]),
      );
      await mapBounded(
        [...grouped.entries()],
        8,
        async ([findingId, neighbors]) => {
          const analysis = analysisByFinding.get(findingId);
          if (!analysis || !neighbors.length) return;
          const meanSimilarity =
            neighbors.reduce((sum, neighbor) => sum + neighbor.score, 0) /
            neighbors.length;
          const nearDuplicates = neighbors.filter(
            (neighbor) =>
              neighbor.score >= NEAR_DUPLICATE_MIN && repeats(neighbor),
          );
          // A sparse neighbourhood (fewer than MIN_NEIGHBORHOOD same-type
          // vectors in the space) says nothing about how unusual the evidence
          // is — the first vectors analyzed would otherwise all read as extreme
          // outliers and keep that bonus forever.
          const neighborhoodReliable = neighbors.length >= MIN_NEIGHBORHOOD;
          const semanticOutlier = neighborhoodReliable
            ? Math.max(0, Math.min(1, 1 - meanSimilarity))
            : 0;
          const textQuality = analysis.qualityScore;
          const qualityScore = neighborhoodReliable
            ? Math.max(0, Math.min(1, textQuality * 0.8 + meanSimilarity * 0.2))
            : textQuality;
          // A tiny matched value ("LOCH", "=") is weak evidence however unusual
          // its embedding looks; the outlier bonus needs substance to reward.
          const valueLength = Number(
            (analysis.signals as Record<string, unknown> | null)?.[
              'valueLength'
            ] ?? Number.MAX_SAFE_INTEGER,
          );
          const outlierAdjustment = !neighborhoodReliable
            ? 0
            : textQuality < 0.55
              ? -semanticOutlier * 0.2
              : semanticOutlier >= OUTLIER_BONUS_THRESHOLD && valueLength >= 5
                ? semanticOutlier * 0.12
                : 0;
          const duplicatePenalty = Math.min(
            0.15,
            nearDuplicates.length * 0.025,
          );
          const importanceScore = Math.max(
            0,
            Math.min(
              1,
              analysis.importanceScore + outlierAdjustment - duplicatePenalty,
            ),
          );
          // Appends to whatever the lexical pass stored, in the same shape:
          // codes and parameters, rendered into sentences on read.
          const reasons: StoredReason[] = Array.isArray(analysis.reasons)
            ? (analysis.reasons as unknown as StoredReason[]).slice()
            : [];
          if (nearDuplicates.length) {
            reasons.push({ c: 'near_duplicate', n: nearDuplicates.length });
          }
          reasons.push(
            !neighborhoodReliable
              ? { c: 'insufficient_neighborhood' }
              : textQuality < 0.55 && semanticOutlier > 0.45
                ? { c: 'isolated_ocr' }
                : semanticOutlier >= OUTLIER_BONUS_THRESHOLD
                  ? { c: 'semantic_outlier' }
                  : { c: 'semantic_support' },
          );
          await this.prisma.findingEvidenceAnalysis.update({
            where: { findingId },
            data: {
              importanceScore,
              qualityScore,
              semanticOutlier,
              similarCount: analysis.similarCount + nearDuplicates.length,
              duplicateGroupHash:
                duplicateGroupByHash.get(neighbors[0].targetHash) ??
                analysis.duplicateGroupHash,
              reasons: reasonsForStorage(reasons),
              signals: {
                ...(analysis.signals && typeof analysis.signals === 'object'
                  ? (analysis.signals as Record<string, unknown>)
                  : {}),
                meanNeighborSimilarity: meanSimilarity,
                ...(nearDuplicates.length
                  ? {
                      duplicateSimilarity: Math.max(
                        ...nearDuplicates.map((neighbor) => neighbor.score),
                      ),
                    }
                  : {}),
              },
              analyzedAt: new Date(),
            },
          });
        },
      );
      await mapBounded(
        [...new Set(duplicateGroupByHash.values())],
        8,
        (groupHash) => {
          const hashes = [...duplicateGroupByHash.entries()]
            .filter(([, value]) => value === groupHash)
            .map(([hash]) => hash);
          return this.prisma.findingEvidenceAnalysis.updateMany({
            where: {
              finding: { embedContentHash: { in: hashes } },
              // Already correct on most rows after the first pass; without this
              // the statement rewrites the whole component every time.
              //
              // The null arm is not redundant. Prisma compiles `not` to SQL
              // inequality, which is three-valued: a NULL group is neither
              // equal nor unequal, so a bare `{ not: groupHash }` silently
              // skips every row that has no group yet — exactly the findings
              // whose content hash is unique but which still belong to a
              // near-duplicate component. They would never be assigned one,
              // keeping `noveltyScore` pinned at 1.0 and their importance
              // inflated, permanently. Measured on one namespace: `not`
              // matched 593,085 of 605,220 rows, missing all 12,135 nulls.
              OR: [
                { duplicateGroupHash: null },
                { duplicateGroupHash: { not: groupHash } },
              ],
            },
            data: { duplicateGroupHash: groupHash },
          });
        },
      );
      if (calibrated >= maxRows) break;
    }
    return calibrated;
  }

  /**
   * Replace what is stored for an asset: its text passages and, for the
   * modalities in `accepted`, the media prepared from it.
   *
   * Both in one transaction because a scan sends both in one request and the
   * pair describes one reading of the asset — keeping last week's picture next
   * to this week's text would be a state no scan ever produced. Media of a
   * kind this workspace does not embed is dropped here rather than stored:
   * the bytes would only wait for a setting that may never change.
   */
  async putChunks(
    sourceId: string,
    dto: PutAssetChunksDto,
    accepted: readonly MediaModality[] = [],
  ) {
    const asset = await this.prisma.asset.findUnique({
      where: { sourceId_hash: { sourceId, hash: dto.assetHash } },
      select: { id: true },
    });
    if (!asset)
      throw new NotFoundException(
        `Asset ${dto.assetHash} not found in source ${sourceId}`,
      );
    const chunks = dto.chunks.map((chunk) => {
      // Postgres TEXT rejects NUL bytes; strip them rather than 500 the whole
      // batch when binary-contaminated text slips past extraction.
      const text = chunk.text.split('\u0000').join('');
      return { ...chunk, text, contentHash: embeddingContentHash(text) };
    });
    const media = (dto.media ?? []).flatMap((item) => {
      if (
        !isMediaModality(item.modality) ||
        !accepted.includes(item.modality)
      ) {
        return [];
      }
      const data = Buffer.from(String(item.data ?? ''), 'base64');
      if (!data.byteLength || data.byteLength > MAX_MEDIA_BYTES) return [];
      return [
        {
          modality: item.modality,
          mimeType: String(item.mimeType || 'application/octet-stream'),
          page: item.page ?? null,
          data,
          contentHash: mediaContentHash(data),
        },
      ];
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.assetChunk.deleteMany({ where: { assetId: asset.id } });
      if (chunks.length) {
        await tx.assetChunk.createMany({
          data: chunks.map((chunk) => ({
            id: randomUUID(),
            assetId: asset.id,
            sourceId,
            ...chunk,
          })),
        });
      }
      if (media.length) {
        // Numbered after the text so the two cannot collide on the asset's
        // (asset, ordinal) key whatever the scan numbered them.
        const first =
          chunks.reduce((max, chunk) => Math.max(max, chunk.ordinal), -1) + 1;
        await tx.assetChunk.createMany({
          data: media.map((item, index) => ({
            id: randomUUID(),
            assetId: asset.id,
            sourceId,
            ordinal: first + index,
            page: item.page,
            charOffset: 0,
            charLength: 0,
            text: '',
            modality: item.modality,
            mimeType: item.mimeType,
            data: item.data,
            contentHash: item.contentHash,
          })),
        });
      }
    });
    return {
      stored: chunks.length + media.length,
      contents: [
        ...chunks.map((chunk) => ({
          hash: chunk.contentHash,
          text: chunk.text,
        })),
        ...media.map((item) => ({
          hash: item.contentHash,
          text: '',
          media: true,
        })),
      ],
    };
  }

  /**
   * Bring what is stored in line with a change in what the workspace embeds
   * besides text: delete what is no longer embedded, and have scans go back
   * for what now is.
   *
   * Called by whatever changed the answer — the embedding settings, or the
   * provider a workspace is bound to — with the configuration before and
   * after. Best effort: the setting is already saved, and a failure here
   * leaves rows nothing reads, or pictures a full rescan would still collect.
   */
  async applyMediaChange(
    before: readonly MediaModality[],
    after: readonly MediaModality[],
  ): Promise<void> {
    const removed = before.filter((modality) => !after.includes(modality));
    const added = after.filter((modality) => !before.includes(modality));
    try {
      if (removed.length) await this.dropMedia(removed);
      if (added.length) await this.revisitScannedSources();
    } catch (error) {
      this.logger.warn(
        `Could not apply the change in embedded media (removed: ${removed.join(', ') || 'none'}; added: ${added.join(', ') || 'none'}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Make the next scans walk every source again from the start.
   *
   * A source on the AUTOMATIC sweep keeps its place between runs, and one
   * that has covered everything discovers nothing more — so pictures it
   * passed before the workspace could embed them would wait until their files
   * changed. Dropping the place is all it takes: the scan cache still skips
   * every unchanged asset without running a detector, and only reads again
   * the ones that owe media. Notebook sources keep their own state in the
   * cursor, which is not ours to drop.
   */
  private async revisitScannedSources(): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE sources
      SET sampling_cursor = NULL
      WHERE sampling_cursor IS NOT NULL
        AND type::text <> 'CUSTOM'
    `;
  }

  /**
   * Remove everything held for media the workspace no longer embeds: the
   * prepared bytes and the vectors taken over them.
   *
   * Without this a picture would stay findable after pictures were turned
   * off, and its bytes would stay on disk for a model that will not read
   * them. Text is untouched — it is the same space, and nothing about the
   * text vectors depended on the pictures beside them.
   */
  async dropMedia(
    modalities: readonly MediaModality[],
  ): Promise<{ chunks: number; vectors: number }> {
    const kinds = modalities.filter(isMediaModality);
    if (!kinds.length) return { chunks: 0, vectors: 0 };
    // Forget that these assets' media was ever sent, while the chunks still
    // say which assets those are. The scan cache skips an unchanged asset on
    // the strength of that record, so without this the media could never come
    // back: turned on again, every picture would read as already collected.
    for (const kind of kinds) {
      await this.prisma.$executeRaw`
        UPDATE assets
        SET scan_cache = scan_cache #- ARRAY['detectors', ${mediaScanCacheKey(kind)}]
        WHERE scan_cache IS NOT NULL
          AND id IN (
            SELECT asset_id FROM asset_chunks WHERE modality = ${kind}
          )
      `;
    }
    const vectors = await this.prisma.$executeRaw`
      DELETE FROM content_embeddings ce
      USING (
        SELECT DISTINCT content_hash FROM asset_chunks
        WHERE modality = ANY(${kinds}::text[])
      ) gone
      WHERE ce.content_hash = gone.content_hash
    `;
    const chunks = await this.prisma.assetChunk.deleteMany({
      where: { modality: { in: [...kinds] } },
    });
    return { chunks: chunks.count, vectors };
  }

  private async rowsForVector(
    vector: number[],
    limit: number,
    sourceIds?: string[],
    statuses?: FindingStatus[],
    includeResolved = false,
  ) {
    const space = await this.activeSpace();
    if (vector.length !== space.dim) {
      throw new BadRequestException(
        `Query vector has ${vector.length} dimensions; active space requires ${space.dim}`,
      );
    }
    const sourceFilter = sourceIds?.length ? sourceIds : null;
    const statusFilter = statuses?.length ? statuses : null;
    const dim = Prisma.raw(String(space.dim));
    // Must match the expression ensureHnswIndex built, or the planner ignores
    // the index and silently falls back to a sequential scan.
    const vecType = Prisma.raw(vectorCast(space.dim).type);
    const queryVector = JSON.stringify(vector);
    const candidateLimit = candidateBudget(limit);
    const statusScope = statusFilter
      ? Prisma.sql`AND f.status = ANY(${statusFilter}::"FindingStatus"[])`
      : includeResolved
        ? Prisma.empty
        : Prisma.sql`AND f.status <> ${FindingStatus.RESOLVED}::"FindingStatus"`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.raw(`SET LOCAL hnsw.ef_search = ${this.cfg.hnswEfSearch}`),
      );
      // Safe here only because nothing filters ABOVE the ORDER BY ... LIMIT:
      // the scan stops at exactly `candidateLimit` rows. Move a join or a
      // WHERE back into that subquery and strict_order will traverse the graph
      // until that many rows survive it instead — see candidateBudget. The
      // neighborhood query above keeps its filters above the LIMIT on purpose
      // and therefore uses relaxed_order, which is the setting that pattern
      // needs.
      await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = strict_order`;
      return tx.$queryRaw<SimilarityRow[]>(Prisma.sql`
        WITH nearest AS (
          SELECT ce.content_hash, 1 - (
            ce.vec::public.${vecType}(${dim}) <=>
            ${queryVector}::public.${vecType}(${dim})
          ) AS score
          FROM content_embeddings ce
          WHERE ce.space_id = ${this.spaceIdLiteral(space.id)}
          ORDER BY ce.vec::public.${vecType}(${dim}) <=>
            ${queryVector}::public.${vecType}(${dim})
          LIMIT ${candidateLimit}
        )
        SELECT f.id, MAX(n.score) AS score
        FROM nearest n
        JOIN findings f ON f.embed_content_hash = n.content_hash
        WHERE (${sourceFilter}::text[] IS NULL OR f.source_id = ANY(${sourceFilter}::text[]))
          ${statusScope}
        GROUP BY f.id
        ORDER BY score DESC
        LIMIT ${limit}
      `);
    });
  }

  async semanticFindingIds(
    queryVector: number[],
    limit: number,
    sourceIds?: string[],
    statuses?: FindingStatus[],
    includeResolved = false,
  ) {
    await this.assertSemanticEnabled();
    return this.rowsForVector(
      queryVector,
      limit,
      sourceIds,
      statuses,
      includeResolved,
    );
  }

  async semanticAssetIds(
    queryVector: number[],
    limit: number,
    sourceId?: string,
  ) {
    await this.assertSemanticEnabled();
    const space = await this.activeSpace();
    if (queryVector.length !== space.dim) {
      throw new BadRequestException(
        `Query vector has ${queryVector.length} dimensions; active space requires ${space.dim}`,
      );
    }
    const candidateLimit = candidateBudget(limit);
    const dim = Prisma.raw(String(space.dim));
    // Must match the expression ensureHnswIndex built, or the planner ignores
    // the index and silently falls back to a sequential scan.
    const vecType = Prisma.raw(vectorCast(space.dim).type);
    const vector = JSON.stringify(queryVector);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.raw(`SET LOCAL hnsw.ef_search = ${this.cfg.hnswEfSearch}`),
      );
      // Safe here only because nothing filters ABOVE the ORDER BY ... LIMIT:
      // the scan stops at exactly `candidateLimit` rows. Move a join or a
      // WHERE back into that subquery and strict_order will traverse the graph
      // until that many rows survive it instead — see candidateBudget. The
      // neighborhood query above keeps its filters above the LIMIT on purpose
      // and therefore uses relaxed_order, which is the setting that pattern
      // needs.
      await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = strict_order`;
      const nearest = await tx.$queryRaw<SimilarityRow[]>(Prisma.sql`
        WITH nearest AS (
          SELECT ce.content_hash,
            1 - (
              ce.vec::public.${vecType}(${dim}) <=>
              ${vector}::public.${vecType}(${dim})
            ) AS score
          FROM content_embeddings ce
          WHERE ce.space_id = ${this.spaceIdLiteral(space.id)}
          ORDER BY ce.vec::public.${vecType}(${dim}) <=>
            ${vector}::public.${vecType}(${dim})
          LIMIT ${candidateLimit}
        )
        , best AS (
          -- Per asset, the chunk that matched best: the asset scores by it,
          -- and the caller learns where in a long document the answer is.
          SELECT DISTINCT ON (ac.asset_id)
            ac.asset_id AS id, n.score, ac.page, LEFT(ac.text, 600) AS text
          FROM nearest n
          JOIN asset_chunks ac ON ac.content_hash = n.content_hash
          WHERE (${sourceId ?? null}::text IS NULL OR ac.source_id = ${sourceId ?? null})
          ORDER BY ac.asset_id, n.score DESC
        )
        SELECT id, score, page, text
        FROM best
        ORDER BY score DESC
        LIMIT ${limit}
      `);
      if (!this.cfg.mediaModalities.length) return nearest;

      // Pictures and clips are scored on their own, exactly. The pass above
      // stops at a fixed number of nearest vectors, and in a space that is
      // mostly text those are text: a matching picture a little further out
      // would never be looked at. Media is the small side of the corpus, so
      // reading every one of its vectors costs little, and it is driven from
      // the media chunks (their own partial index) rather than from the
      // vector index, which cannot filter by what a vector was taken over.
      //
      // Each row comes back with how its kind scored this question (the
      // middle score, and how many there were), because that is what its
      // score is read against: see mergeByStanding.
      const media = await tx.$queryRaw<MediaScoreRow[]>(Prisma.sql`
        WITH scored AS (
          SELECT ac.asset_id AS id, ac.modality, MAX(1 - (
            ce.vec::public.${vecType}(${dim}) <=>
            ${vector}::public.${vecType}(${dim})
          )) AS score
          FROM asset_chunks ac
          JOIN content_embeddings ce
            ON ce.content_hash = ac.content_hash
           AND ce.space_id = ${this.spaceIdLiteral(space.id)}
          WHERE ac.modality <> 'text'
            AND (${sourceId ?? null}::text IS NULL OR ac.source_id = ${sourceId ?? null})
          GROUP BY ac.asset_id, ac.modality
        ), kinds AS (
          SELECT modality,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score) AS middle,
            COUNT(*)::int AS count
          FROM scored
          GROUP BY modality
        ), placed AS (
          SELECT scored.id, scored.score, kinds.middle, kinds.count,
            ROW_NUMBER() OVER (
              PARTITION BY scored.modality ORDER BY scored.score DESC
            ) AS position
          FROM scored
          JOIN kinds ON kinds.modality = scored.modality
        )
        SELECT id, score, middle, count
        FROM placed
        WHERE position <= ${limit}
        ORDER BY score DESC
      `);
      if (!media.length) return nearest;

      // How text scores this question: a fixed sample of passages, the same
      // ones every time (content hashes are as good as random, and reading
      // them in order is one short walk along their index).
      const [textBackground] = await tx.$queryRaw<
        Array<{ middle: number | null; count: number }>
      >(Prisma.sql`
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score) AS middle,
          COUNT(*)::int AS count
        FROM (
          SELECT 1 - (
            ce.vec::public.${vecType}(${dim}) <=>
            ${vector}::public.${vecType}(${dim})
          ) AS score
          FROM (
            SELECT content_hash FROM asset_chunks
            WHERE modality = 'text'
            ORDER BY content_hash
            LIMIT ${BACKGROUND_SAMPLE}
          ) sample
          JOIN content_embeddings ce
            ON ce.content_hash = sample.content_hash
           AND ce.space_id = ${this.spaceIdLiteral(space.id)}
        ) scored
      `);
      return mergeByStanding(
        nearest,
        textBackground?.middle == null
          ? null
          : {
              middle: Number(textBackground.middle),
              count: Number(textBackground.count),
            },
        media,
        limit,
      );
    });
  }

  /**
   * Assets found by the words of their passages, best first, each with the
   * passage that matched best.
   *
   * The question is cut into words (figures squeezed to one word each: see
   * FIGURE_SEPARATORS), and a word is weighed by how rare it is among the
   * passages in scope — a document frequency read from the full-text index —
   * so a figure outweighs "which page shows". Words in more than a fifth of
   * the passages are left out. A passage scores the weights of the words it
   * holds, scaled by how close together they sit (cover density).
   *
   * Needs no embeddings: it works with the feature off or the model down,
   * and it is what hybrid search stands on then. A query that fails or runs
   * long returns nothing rather than failing the search it is half of.
   */
  async lexicalAssetIds(
    query: string,
    limit: number,
    sourceId?: string,
  ): Promise<LexicalChunkHit[]> {
    if (!query.trim()) return [];
    const scope = sourceId ?? null;
    const inScope = Prisma.sql`(${scope}::text IS NULL OR ac.source_id = ${scope})`;
    try {
      const rows = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.raw(`SET LOCAL statement_timeout = ${LEXICAL_TIMEOUT_MS}`),
        );
        return tx.$queryRaw<
          Array<{
            id: string;
            score: number;
            page: number | null;
            text: string | null;
            exact: boolean;
          }>
        >(Prisma.sql`
          WITH q AS (
            SELECT ${squeezedFigures(Prisma.sql`${query}::text`)} AS t
          ),
          terms AS (
            SELECT DISTINCT term
            FROM (
              SELECT unnest(tsvector_to_array(to_tsvector('simple', q.t))) AS term
              FROM q
            ) split
            LIMIT ${MAX_QUERY_TERMS}
          ),
          tot AS (
            SELECT COUNT(*)::float8 AS n FROM asset_chunks ac WHERE ${inScope}
          ),
          df AS (
            -- How many passages hold each word: a bitmap scan of the GIN index.
            SELECT t.term,
              (
                SELECT COUNT(*) FROM asset_chunks ac
                WHERE ac.text_tsv @@ quote_literal(t.term)::tsquery
                  AND ${inScope}
              ) AS n
            FROM terms t
          ),
          w AS (
            SELECT df.term,
              quote_literal(df.term)::tsquery AS tq,
              LN((tot.n + 1) / (df.n + 0.5)) AS idf,
              (
                df.term ~ '[0-9]'
                AND df.n <= GREATEST(${FIGURE_FLOOR}, tot.n * ${FIGURE_SHARE})
              ) AS figure
            FROM df CROSS JOIN tot
            WHERE df.n > 0 AND df.n <= tot.n * ${COMMON_TERM_SHARE}
          ),
          orq AS (
            SELECT string_agg(quote_literal(term), ' | ')::tsquery AS tq,
              COUNT(*) FILTER (WHERE figure) AS figures
            FROM w
          ),
          cand AS (
            SELECT ac.asset_id, ac.page, ac.text, ac.text_tsv AS v
            FROM asset_chunks ac CROSS JOIN orq
            WHERE orq.tq IS NOT NULL
              AND ac.text_tsv @@ orq.tq
              AND ${inScope}
          ),
          scored AS (
            SELECT cand.asset_id, cand.page, cand.text,
              m.idf_sum * (1 + ts_rank_cd(cand.v, orq.tq)) AS score,
              (orq.figures > 0 AND m.figure_hits = orq.figures) AS exact
            FROM cand CROSS JOIN orq
            CROSS JOIN LATERAL (
              SELECT COALESCE(SUM(w.idf), 0) AS idf_sum,
                COUNT(*) FILTER (WHERE w.figure) AS figure_hits
              FROM w WHERE cand.v @@ w.tq
            ) m
          ),
          best AS (
            -- Per asset, the passage that answers best: one with every figure
            -- first, then by score.
            SELECT DISTINCT ON (asset_id)
              asset_id AS id, score, page, LEFT(text, ${PASSAGE_CHARS}) AS text, exact
            FROM scored
            ORDER BY asset_id, exact DESC, score DESC
          )
          SELECT id, score, page, text, exact
          FROM best
          ORDER BY score DESC
          LIMIT ${limit}
        `);
      });
      return rows.map((row) => ({
        id: row.id,
        score: Number(row.score),
        page: row.page == null ? null : Number(row.page),
        text: row.text ?? null,
        exact: Boolean(row.exact),
      }));
    } catch (error) {
      this.logger.warn(
        `Passage word search failed; hybrid search falls back to meaning only: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  // Query params arrive as strings (no global ValidationPipe); coerce before
  // they reach arithmetic or SQL.
  private toNumber(value: unknown, fallback: number, min: number, max: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
  }

  async similarFindings(findingId: string, limitInput: number) {
    await this.assertSemanticEnabled();
    const limit = Math.trunc(this.toNumber(limitInput, 20, 1, 100));
    const finding = await this.prisma.finding.findUnique({
      where: { id: findingId },
      select: { embedContentHash: true, sourceId: true },
    });
    if (!finding?.embedContentHash) {
      throw new NotFoundException(`Finding ${findingId} has no embedding`);
    }
    const space = await this.activeSpace();
    const vectors = await this.prisma.$queryRaw<Array<{ vector: string }>>`
      SELECT vec::text AS vector
      FROM content_embeddings
      WHERE space_id = ${space.id}
        AND content_hash = ${finding.embedContentHash}
      LIMIT 1
    `;
    if (!vectors[0])
      throw new NotFoundException(`Finding ${findingId} has no stored vector`);
    const vector = JSON.parse(vectors[0].vector) as number[];
    const rows = (
      await this.rowsForVector(vector, limit + 1, undefined, undefined, true)
    )
      .filter((row) => row.id !== findingId)
      .slice(0, limit);
    const ids = rows.map((row) => row.id);
    const records = await this.prisma.finding.findMany({
      where: { id: { in: ids } },
      include: { asset: true, source: true, evidenceAnalysis: true },
    });
    const byId = new Map(records.map((record) => [record.id, record]));
    return rows.flatMap((row) => {
      const record = byId.get(row.id);
      return record
        ? [
            {
              ...record,
              confidence: Number(record.confidence),
              similarity: Number(row.score),
            },
          ]
        : [];
    });
  }

  /**
   * Near-duplicate finding clusters. Group hashes are precomputed during
   * neighbourhood calibration across the WHOLE space, so clusters naturally
   * span sources; `sourceIds` only filters which findings are counted.
   * Omit it to see duplicates across the entire corpus.
   */
  async boilerplateClusters(options: {
    sourceIds?: string[];
    threshold?: number;
    limit?: number;
  }) {
    await this.assertSemanticEnabled();
    const threshold = this.toNumber(options.threshold, 0.95, 0.8, 1);
    const limit = Math.trunc(this.toNumber(options.limit, 50, 1, 200));
    const sourceIds = (options.sourceIds ?? []).filter(
      (id) => typeof id === 'string' && id.length > 0,
    );
    const sourceFilter = sourceIds.length
      ? Prisma.sql`AND finding.source_id IN (${Prisma.join(sourceIds)})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<BoilerplateClusterRow[]>(
      Prisma.sql`
      SELECT analysis.duplicate_group_hash AS "groupHash",
        COUNT(*) AS "findingCount",
        (ARRAY_AGG(finding.id ORDER BY analysis.importance_score DESC))[1:10] AS "findingIds",
        AVG(analysis.importance_score) AS "meanImportance",
        COUNT(DISTINCT finding.source_id) AS "sourceCount",
        (ARRAY_AGG(DISTINCT finding.source_id))[1:10] AS "sourceIds",
        (ARRAY_AGG(DISTINCT finding.asset_id))[1:50] AS "assetIds"
      FROM finding_evidence_analyses analysis
      JOIN findings finding ON finding.id = analysis.finding_id
      WHERE analysis.duplicate_group_hash IS NOT NULL
        ${sourceFilter}
        AND COALESCE(
          (analysis.signals->>'duplicateSimilarity')::double precision,
          0
        ) >= ${threshold}
      GROUP BY analysis.duplicate_group_hash
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, AVG(analysis.importance_score) DESC
      LIMIT ${limit}
    `,
    );
    return rows.map((row) => ({
      ...row,
      findingCount: Number(row.findingCount),
      meanImportance: Number(row.meanImportance),
      sourceCount: Number(row.sourceCount),
      threshold,
    }));
  }
}
