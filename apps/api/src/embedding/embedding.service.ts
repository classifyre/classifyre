import {
  BadRequestException,
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
import { embeddingContentHash } from './embedding-text';
import { reasonsForStorage, type StoredReason } from './reason-labels';
import { MAX_INDEXED_DIMENSIONS, vectorCast } from './embedding-vector';

type SimilarityRow = { id: string; score: number };
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
    const seeds = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.raw(`SET LOCAL hnsw.ef_search = ${this.cfg.hnswEfSearch}`),
      );
      // The candidate pre-filters (space, hash, finding_type) are applied after
      // the index scan; relaxed_order lets the scan keep going until LIMIT is
      // filled instead of falling back to an exact full-table sort.
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
    const seedsByKey = new Map<string, NeighborhoodSeedRow[]>();
    const nearDuplicateComponents = new UnionFind([]);
    for (const row of seeds) {
      const normalized = { ...row, score: Number(row.score) };
      const key = `${row.targetHash}\u0000${row.findingType}`;
      const values = seedsByKey.get(key) ?? [];
      values.push(normalized);
      seedsByKey.set(key, values);
      if (normalized.score >= 0.95) {
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
            (neighbor) => neighbor.score >= 0.95,
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

  async putChunks(sourceId: string, dto: PutAssetChunksDto) {
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
    });
    return {
      stored: chunks.length,
      contents: chunks.map((chunk) => ({
        hash: chunk.contentHash,
        text: chunk.text,
      })),
    };
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
      return tx.$queryRaw<SimilarityRow[]>(Prisma.sql`
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
        SELECT ac.asset_id AS id, MAX(n.score) AS score
        FROM nearest n
        JOIN asset_chunks ac ON ac.content_hash = n.content_hash
        WHERE (${sourceId ?? null}::text IS NULL OR ac.source_id = ${sourceId ?? null})
        GROUP BY ac.asset_id
        ORDER BY score DESC
        LIMIT ${limit}
      `);
    });
  }

  // Query params arrive as strings (no global ValidationPipe); coerce before
  // they reach arithmetic or SQL.
  private toNumber(value: unknown, fallback: number, min: number, max: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
  }

  async similarFindings(findingId: string, limitInput: number) {
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
