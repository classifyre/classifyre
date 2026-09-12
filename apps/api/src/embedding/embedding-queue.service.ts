import { createHash } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { Job, JobInsert } from 'pg-boss';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { PgBossService, pgBossSchemaForId } from '../scheduler/pg-boss.service';
import { EmbeddingCapabilityService } from './embedding-capability.service';
import { embeddingContentHash, normalizeEmbeddingText } from './embedding-text';
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
import { EmbeddingProviderService } from './embedding-provider.service';
import { EmbeddingService } from './embedding.service';
import { runsBackgroundWorkers } from '../service-role';
import {
  CLS_DATABASE_LANE,
  CLS_SCHEMA,
  CLS_NAMESPACE_ID,
  CLS_SLUG,
} from '../namespace/namespace.constants';

const EMBEDDING_QUEUE_PREFIX = 'semantic-embeddings';
const RECALIBRATE_QUEUE_PREFIX = 'semantic-recalibrate';
const EMBEDDING_GROUP = 'embedding-inference';
const INSERT_BATCH_SIZE = 500;
/** How often to re-check queue depth while the backfill is paced. */
const QUEUE_CAPACITY_POLL_MS = 5000;
/** Fallback when the configured queue batch size is unusable. */
const DEFAULT_QUEUE_BATCH_SIZE = 64;
/** Rows per DELETE when clearing a pre-upgrade backlog, to bound lock time. */
const LEGACY_DELETE_PAGE = 20000;
// Insert-time analysis is order-dependent (early vectors see a sparse space),
// so a full recalibration pass runs once the inference queue drains. The delay
// batches bursts of scans into one pass; singletonKey collapses repeat requests.
const RECALIBRATE_DELAY_SECONDS = 120;

/**
 * How many times a recalibration pass may stand aside for in-flight inference
 * before it runs anyway. At the 120s delay above that is ten minutes of grace,
 * which covers any normal drain; past it, ingestion is producing embeddings
 * faster than they can be consumed and waiting longer only means never.
 */
const MAX_RECALIBRATION_DEFERRALS = 5;

type QueuedContent = { hash: string; text: string };

/**
 * A queue job carries a *group* of chunks, by hash.
 *
 * It deliberately does not carry the text. Every hash here was computed from a
 * row that is already in this database — an asset chunk, a finding's context
 * window, or a glossary term — so putting the text in the payload stored a
 * second copy of the corpus inside the job queue and then threw it away after
 * one inference call. Measured on one namespace: 31 KB per job across 124,336
 * jobs, 3.85 GB, against a corpus whose own chunk table is 1.5 GB.
 *
 * The two older shapes are still accepted. Jobs enqueued before this change are
 * sitting in the queue right now and drain through the same handler; their
 * inline text is used as-is rather than re-read.
 */
type EmbeddingJob = { spaceId: string } & (
  | { hashes: string[] }
  | QueuedContent
  | { items: QueuedContent[] }
);

/**
 * Stable identity for a group of chunks.
 *
 * Order-independent so the same chunks always produce the same key however
 * they were grouped, and hashed rather than concatenated because singleton_key
 * is a single indexed column, not a place for 64 content hashes.
 */
function batchKey(hashes: string[]): string {
  const digest = createHash('sha256');
  for (const hash of [...hashes].sort()) {
    digest.update(hash);
  }
  return digest.digest('hex');
}

/**
 * What a job asks to be embedded, whichever shape it was enqueued in.
 *
 * Legacy jobs carry their text inline; current ones carry only hashes and the
 * text is read back from the rows it was derived from. Returning both lets the
 * handler treat the two identically without re-reading what it already has.
 */
function jobWork(data: EmbeddingJob | undefined): {
  hashes: string[];
  inline: Map<string, string>;
} {
  const inline = new Map<string, string>();
  const hashes: string[] = [];
  if (!data) return { hashes, inline };

  const bare = (data as { hashes?: unknown }).hashes;
  if (Array.isArray(bare)) {
    for (const hash of bare) {
      if (typeof hash === 'string') hashes.push(hash);
    }
    return { hashes, inline };
  }

  const batch = (data as { items?: unknown }).items;
  const items: unknown[] = Array.isArray(batch) ? batch : [data];
  for (const item of items) {
    const entry = item as Partial<QueuedContent> | undefined;
    if (typeof entry?.hash !== 'string' || typeof entry.text !== 'string') {
      continue;
    }
    hashes.push(entry.hash);
    inline.set(entry.hash, entry.text);
  }
  return { hashes, inline };
}

/** Captured namespace context so timers/setImmediate can re-enter CLS. */
interface NsCtx {
  schema?: string;
  namespaceId?: string;
  slug?: string;
}

/** Per-namespace embedding-queue state (was single-instance). */
interface EmbeddingRuntime {
  ctx: NsCtx;
  disposed: boolean;
  pendingWrites: number;
  workerRegistered: boolean;
  recoveryTimer?: NodeJS.Timeout;
  queueName?: string;
  recalibrateQueueName?: string;
  spaceId?: string;
  backfillPromise?: Promise<void>;
  backfillStartedAt?: string;
  backfillCompletedAt?: string;
  backfillError?: string;
  recalibrationRunning: boolean;
  /** Consecutive passes deferred because inference was still draining. */
  recalibrationDeferrals: number;
  lastRecalibratedAt?: string;
  lastRecalibrationError?: string;
  embedJobFailureCount: number;
  lastEmbedJobError?: string;
  lastEmbedJobErrorAt?: string;
  lastEmbedSuccessAt?: string;
}

@Injectable()
export class EmbeddingQueueService {
  private readonly logger = new Logger(EmbeddingQueueService.name);
  private readonly runtimes = new Map<string, EmbeddingRuntime>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EmbeddingConfigService,
    private readonly provider: EmbeddingProviderService,
    private readonly embeddings: EmbeddingService,
    private readonly pgBoss: PgBossService,
    private readonly capability: EmbeddingCapabilityService,
    private readonly cls: ClsService,
    // Optional and last: the unit tests construct this service positionally.
    @Optional() private readonly settings?: EmbeddingSettingsService,
  ) {}

  /** Effective configuration for the current namespace. */
  private get cfg(): ResolvedEmbeddingConfig {
    return this.settings?.cached() ?? resolvedFromEnv(this.config);
  }

  /** Resolve (or create) the runtime object for the current namespace schema. */
  private runtime(): EmbeddingRuntime {
    const schema = this.cls.get<string>(CLS_SCHEMA);
    if (!schema) {
      throw new Error(
        'EmbeddingQueueService used outside a namespace context (no schema).',
      );
    }
    let rt = this.runtimes.get(schema);
    if (!rt) {
      rt = {
        ctx: this.captureCtx(),
        disposed: false,
        pendingWrites: 0,
        workerRegistered: false,
        recalibrationRunning: false,
        recalibrationDeferrals: 0,
        embedJobFailureCount: 0,
      };
      this.runtimes.set(schema, rt);
    }
    return rt;
  }

  private captureCtx(): NsCtx {
    return {
      schema: this.cls.get<string>(CLS_SCHEMA),
      namespaceId: this.cls.get<string>(CLS_NAMESPACE_ID),
      slug: this.cls.get<string>(CLS_SLUG),
    };
  }

  /** Re-enter a captured namespace context (for detached timers/callbacks). */
  private runCtx<T>(ctx: NsCtx, fn: () => T): T {
    return this.cls.run(() => {
      if (ctx.schema) this.cls.set(CLS_SCHEMA, ctx.schema);
      if (ctx.namespaceId) this.cls.set(CLS_NAMESPACE_ID, ctx.namespaceId);
      if (ctx.slug) this.cls.set(CLS_SLUG, ctx.slug);
      this.cls.set(CLS_DATABASE_LANE, 'background');
      return fn();
    });
  }

  /**
   * Lazily initialize the queues for the current namespace (safe on the `api`
   * role — enqueue works without registering any worker).
   */
  private async ensureRuntime(): Promise<EmbeddingRuntime> {
    const rt = this.runtime();
    // Warms the per-schema configuration cache that every synchronous `cfg`
    // read below depends on, before the space is bound to it.
    await this.settings?.resolve();
    await this.capability.ensureReady();
    const space = await this.embeddings.configuredSpace();
    if (rt.queueName && rt.spaceId === space.id) return rt;

    // The queue name is derived from the space id, and the space is REPLACED
    // whenever the embedding settings change (the rebuild purges every space
    // and binds a new one). This used to bind once per process and never look
    // again, so a rebuild left the enqueuing side writing to the retired
    // space's queue while the worker listened on the new one: jobs piled up
    // under a name nothing worked, the corpus stayed at zero vectors, and the
    // only symptom was a "queued batches" number that grew forever.
    //
    // Two processes make this unavoidable rather than merely possible — the
    // rebuild clears the cache in the pod that served the request, and the
    // other pod never hears about it. So the binding is re-checked instead of
    // invalidated: `configuredSpace()` is memoised per schema, so this costs
    // nothing after the first call.
    const previousQueue = rt.queueName;
    if (previousQueue && rt.spaceId !== space.id) {
      this.logger.warn(
        `Embedding space changed (${rt.spaceId} -> ${space.id}); rebinding the ` +
          `queue. Anything still queued on ${previousQueue} was written for a ` +
          'space that no longer exists and is dropped.',
      );
    }
    rt.spaceId = space.id;
    rt.queueName = `${EMBEDDING_QUEUE_PREFIX}-${space.id}`;
    rt.recalibrateQueueName = `${RECALIBRATE_QUEUE_PREFIX}-${space.id}`;
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(rt.queueName, { policy: 'exclusive' });
    await boss.createQueue(rt.recalibrateQueueName, { policy: 'exclusive' });
    if (previousQueue && previousQueue !== rt.queueName) {
      // Best-effort: the backlog names content that has to be re-embedded into
      // the new space anyway, and leaving it makes the queue depth a lie.
      await boss.deleteQueue(previousQueue).catch(() => undefined);
    }
    return rt;
  }

  /**
   * Register the embedding worker for the CURRENT namespace (invoked by the
   * NamespaceWorkerManager inside the namespace's CLS context). No-op when
   * embeddings are disabled.
   */
  async registerForNamespace(): Promise<void> {
    // Resolve before the check: a workspace that turned embeddings off in its
    // settings must not have a worker registered just because the deployment
    // default says they are on.
    await this.settings?.resolve();
    if (!this.cfg.enabled) return;
    const rt = await this.ensureRuntime();
    rt.disposed = false;
    if (!runsBackgroundWorkers()) return;

    await this.dropUngroupedBacklog(rt);

    await this.pgBoss.work(
      rt.queueName as string,
      {
        batchSize: this.cfg.batchSize,
        localConcurrency: 1,
        groupConcurrency: this.cfg.workerConcurrency,
      },
      (jobs) => this.handle(jobs as Job<EmbeddingJob>[]),
    );
    await this.pgBoss.work(
      rt.recalibrateQueueName as string,
      { batchSize: 1, localConcurrency: 1 },
      () => this.handleRecalibration(),
    );
    rt.workerRegistered = true;
    this.logger.log(
      `Registered persistent embedding worker for space ${rt.spaceId} ` +
        // Named separately because reading `batch=32` as the inference batch
        // is what sent an OOM investigation after thread pools and memory
        // limits for a week. The fetch is jobs; inference is rows, bounded
        // again by EMBEDDING_MAX_BATCH_CHARS once chunks are long.
        `(fetch=${this.cfg.batchSize} jobs x ${this.cfg.queueBatchSize} chunks, ` +
        `inference<=${this.cfg.batchSize} rows, group concurrency=${this.cfg.workerConcurrency})`,
    );
    if (this.cfg.autoBackfill) {
      const ctx = rt.ctx;
      setImmediate(() => this.runCtx(ctx, () => this.requestBackfill()));
    }
  }

  /** Cancel detached recovery work and wait for an active backfill on delete. */
  async stopForSchema(schema: string): Promise<void> {
    const rt = this.runtimes.get(schema);
    if (!rt) return;
    rt.disposed = true;
    if (rt.recoveryTimer) clearTimeout(rt.recoveryTimer);
    await rt.backfillPromise?.catch(() => undefined);
    this.runtimes.delete(schema);
  }

  enqueue(contents: QueuedContent[]): void {
    if (!this.cfg.enabled || !contents.length) return;
    void this.persist(contents).catch((error) => {
      this.logger.error(
        `Failed to persist embedding jobs: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.scheduleRecovery();
    });
  }

  async status() {
    const rt = this.runtime();
    // A recalibration pass is deliberately debounced (RECALIBRATE_DELAY_SECONDS),
    // so "scheduled but not yet running" is the state operators actually see
    // right after reindexing — surface it instead of looking idle.
    let recalibrationScheduled = false;
    if (rt.recalibrateQueueName) {
      try {
        const boss = await this.pgBoss.getBossAsync();
        const stats = await boss.getQueueStats(rt.recalibrateQueueName);
        recalibrationScheduled =
          stats.queuedCount + stats.activeCount + stats.deferredCount > 0;
      } catch {
        // pg-boss not ready; report unscheduled rather than failing status.
      }
    }
    let lastRecalibratedAt = rt.lastRecalibratedAt;
    if (rt.spaceId) {
      const space = await this.prisma.embeddingSpace.findUnique({
        where: { id: rt.spaceId },
        select: { lastRecalibratedAt: true },
      });
      lastRecalibratedAt =
        space?.lastRecalibratedAt?.toISOString() ?? lastRecalibratedAt;
    }
    // Ground truth: rows actually embedded vs rows awaiting embedding.
    let embeddedRows: number | null = null;
    let pendingEmbedJobs: number | null = null;
    if (rt.spaceId) {
      try {
        const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*)::bigint AS count
          FROM content_embeddings
          WHERE space_id = ${rt.spaceId}
        `;
        embeddedRows = Number(rows[0]?.count ?? 0);
      } catch {
        // capability not ready; leave null rather than failing status.
      }
    }
    if (rt.queueName) {
      try {
        const boss = await this.pgBoss.getBossAsync();
        const stats = await boss.getQueueStats(rt.queueName);
        pendingEmbedJobs =
          stats.queuedCount + stats.activeCount + stats.deferredCount;
      } catch {
        // pg-boss not ready.
      }
    }
    return {
      persistentQueue: true,
      pendingQueueWrites: rt.pendingWrites,
      workerRegistered: rt.workerRegistered,
      embeddedRows,
      pendingEmbedJobs,
      embedJobFailureCount: rt.embedJobFailureCount,
      lastEmbedJobError: rt.lastEmbedJobError ?? null,
      lastEmbedJobErrorAt: rt.lastEmbedJobErrorAt ?? null,
      lastEmbedSuccessAt: rt.lastEmbedSuccessAt ?? null,
      providerHealth: this.provider.status(),
      provider: this.cfg.provider,
      model: this.cfg.model,
      spaceId: rt.spaceId,
      autoBackfill: this.cfg.autoBackfill,
      backfillRunning: Boolean(rt.backfillPromise),
      backfillStartedAt: rt.backfillStartedAt,
      backfillCompletedAt: rt.backfillCompletedAt,
      backfillError: rt.backfillError,
      recalibrationScheduled,
      recalibrationRunning: rt.recalibrationRunning,
      lastRecalibratedAt,
      lastRecalibrationError: rt.lastRecalibrationError,
    };
  }

  async scheduleRecalibration(): Promise<boolean> {
    if (!this.cfg.enabled) return false;
    try {
      return await this.persistRecalibration();
    } catch (error) {
      this.logger.error(
        `Failed to schedule embedding recalibration: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private async persistRecalibration(singleton = true): Promise<boolean> {
    const rt = this.runtime();
    if (!rt.recalibrateQueueName || !rt.spaceId) return false;
    const boss = await this.pgBoss.getBossAsync();
    const jobId = await boss.send(
      rt.recalibrateQueueName,
      { spaceId: rt.spaceId },
      {
        ...(singleton ? { singletonKey: rt.spaceId } : {}),
        startAfter: RECALIBRATE_DELAY_SECONDS,
        retryLimit: 3,
        retryDelay: this.cfg.retrySeconds,
        expireInSeconds: 3600,
        retentionSeconds: 86400,
        deleteAfterSeconds: 600,
      },
    );
    return jobId !== null;
  }

  private async handleRecalibration(): Promise<void> {
    const rt = this.runtime();
    if (!rt.queueName || !rt.spaceId) return;
    const boss = await this.pgBoss.getBossAsync();
    const stats = await boss.getQueueStats(rt.queueName);
    const pending = stats.queuedCount + stats.activeCount + stats.deferredCount;

    // Waiting for a stable space is right in principle and starves in practice.
    // A source in CATCH_UP completes a scan every couple of minutes and each one
    // enqueues thousands of embedding jobs, so `pending > 0` is permanently true
    // and the pass deferred itself forever: on a live instance mid-ingestion,
    // 131,905 open findings had 35,667 analyses between them — 27% coverage,
    // falling — and every investigation agent stood down citing unscored
    // evidence. Partial-neighbourhood scores that exist beat perfect scores that
    // never arrive, so the deferral is now bounded.
    if (
      pending > 0 &&
      rt.recalibrationDeferrals < MAX_RECALIBRATION_DEFERRALS
    ) {
      rt.recalibrationDeferrals += 1;
      await this.persistRecalibration(false);
      return;
    }
    if (pending > 0) {
      this.logger.warn(
        `Recalibrating space ${rt.spaceId} with ${pending} embedding job(s) still ` +
          `queued after ${rt.recalibrationDeferrals} deferral(s): ingestion is ` +
          'outpacing inference, so scores would otherwise never be written.',
      );
    }

    rt.recalibrationDeferrals = 0;
    rt.recalibrationRunning = true;
    rt.lastRecalibrationError = undefined;
    try {
      await this.embeddings.recalibrateSpace(rt.spaceId);
      rt.lastRecalibratedAt = new Date().toISOString();
    } catch (error) {
      rt.lastRecalibrationError =
        error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      rt.recalibrationRunning = false;
    }
  }

  requestBackfill() {
    const rt = this.runtime();
    if (!rt.spaceId) {
      throw new Error('Embedding queue is not initialized');
    }
    if (rt.backfillPromise) return { started: false, spaceId: rt.spaceId };

    rt.backfillStartedAt = new Date().toISOString();
    rt.backfillCompletedAt = undefined;
    rt.backfillError = undefined;
    rt.backfillPromise = this.backfillStoredContent(rt).finally(() => {
      rt.backfillPromise = undefined;
    });
    return { started: true, spaceId: rt.spaceId };
  }

  /**
   * Clears any single-chunk jobs left queued by an earlier version.
   *
   * Upgrading does not help an install that is already buried: the millions of
   * one-chunk rows are precisely what makes pg-boss's fetch sort expensive, so
   * without this the new grouped jobs queue up *behind* a backlog that keeps
   * the queue slow. One install had 3.3M and 1.1M of them in two namespaces.
   *
   * Deleting them loses no work. The queue is a work list, not a record:
   * backfillStoredContent walks findings, asset chunks and glossary terms and
   * enqueues whatever `missingHashes` says has no vector, so everything
   * removed here is re-queued — in grouped form — by the reconciliation that
   * already runs at startup. Only `created` jobs are touched, so nothing
   * in-flight is disturbed, and the delete is paged so a large backlog does
   * not hold a lock.
   *
   * Self-limiting: once an install is migrated there is nothing left to match.
   */
  private async dropUngroupedBacklog(rt: EmbeddingRuntime): Promise<void> {
    if (!rt.queueName) return;
    const schema = pgBossSchemaForId(
      this.cls.get<string>(CLS_NAMESPACE_ID) ?? '',
    );
    if (!schema) return;

    let removed = 0;
    try {
      for (;;) {
        const deleted = await this.prisma.$executeRawUnsafe(
          `DELETE FROM "${schema}".job
             WHERE ctid IN (
               SELECT ctid FROM "${schema}".job
                WHERE name = $1 AND state = 'created' AND data ? 'hash'
                LIMIT ${LEGACY_DELETE_PAGE}
             )`,
          rt.queueName,
        );
        removed += deleted;
        if (deleted < LEGACY_DELETE_PAGE) break;
      }
    } catch (error) {
      // Never block worker startup on a cleanup: the queue still functions,
      // it is just slower until this succeeds on a later boot.
      this.logger.warn(
        `Could not clear ungrouped embedding backlog: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    if (removed > 0) {
      this.logger.log(
        `Cleared ${removed} ungrouped embedding job(s) for space ${rt.spaceId}; ` +
          `reconciliation will re-queue the missing chunks in groups`,
      );
    }
  }

  private async persist(contents: QueuedContent[]): Promise<void> {
    const rt = await this.ensureRuntime();
    if (rt.disposed) return;
    if (!rt.queueName || !rt.spaceId) {
      throw new Error('Embedding queue is not initialized');
    }
    const unique = new Map<string, string>();
    for (const content of contents) {
      const text = normalizeEmbeddingText(content.text);
      if (text) unique.set(content.hash, text);
    }
    if (!unique.size) return;

    rt.pendingWrites += unique.size;
    try {
      const boss = await this.pgBoss.getBossAsync();
      const entries = [...unique];
      // Never trust this to be a usable number: a non-positive or NaN size
      // would slice nothing, and the loop would emit jobs carrying no chunks —
      // work silently dropped rather than queued.
      const size =
        Math.max(1, Math.floor(this.cfg.queueBatchSize) || 0) ||
        DEFAULT_QUEUE_BATCH_SIZE;
      const jobs: JobInsert<EmbeddingJob>[] = [];
      for (let offset = 0; offset < entries.length; offset += size) {
        const hashes = entries
          .slice(offset, offset + size)
          .map(([hash]) => hash);
        jobs.push({
          data: { spaceId: rt.spaceId, hashes },
          // The queue policy is `exclusive`, so singleton_key is what keeps a
          // job unique; a null key would let only one job exist at a time.
          // Deriving it from the group's contents keeps the old idempotency:
          // re-enqueueing the same chunks collapses instead of duplicating.
          singletonKey: batchKey(hashes),
          group: { id: EMBEDDING_GROUP },
          retryLimit: 5,
          retryDelay: this.cfg.retrySeconds,
          retryBackoff: true,
          retryDelayMax: 3600,
          expireInSeconds: 3600,
          // Two different knobs: `retentionSeconds` expires work that was never
          // picked up, `deleteAfterSeconds` removes it once it has finished.
          // Only the first was set here, so completed jobs sat for pg-boss's
          // seven-day default. See COMPLETED_JOB_RETENTION_SECONDS.
          retentionSeconds: 86400,
          deleteAfterSeconds: 600,
        });
      }
      for (let offset = 0; offset < jobs.length; offset += INSERT_BATCH_SIZE) {
        await boss.insert(
          rt.queueName,
          jobs.slice(offset, offset + INSERT_BATCH_SIZE),
        );
      }
    } finally {
      rt.pendingWrites -= unique.size;
    }
  }

  /**
   * Read back the text each hash was derived from.
   *
   * Mirrors the three producers in `backfillStoredContent` exactly, including
   * their use of `normalizeEmbeddingText` — the hash is of the normalized
   * string, so rebuilding it any other way would produce text that no longer
   * matches its own hash. Sources are tried in descending order of volume and
   * each one only looks up what the previous ones did not resolve.
   *
   * A hash with no surviving row simply does not come back. That is a chunk or
   * finding deleted between enqueue and dequeue, which is normal during a
   * rescan, and skipping it is correct: there is nothing left to embed.
   */
  private async resolveTexts(hashes: string[]): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    if (!hashes.length) return resolved;

    const outstanding = () => hashes.filter((hash) => !resolved.has(hash));

    const chunks = await this.prisma.assetChunk.findMany({
      where: { contentHash: { in: outstanding() } },
      select: { contentHash: true, text: true },
      distinct: ['contentHash'],
    });
    for (const chunk of chunks) {
      // Normalized, because `asset_chunks.text` is stored raw while its
      // `content_hash` is `embeddingContentHash(text)` — which hashes the
      // NORMALIZED form. Embedding the raw text would put a vector under a
      // hash that does not describe it, and would drift from every chunk
      // embedded before this queue stopped carrying text (the old `persist`
      // squeezed whitespace on everything it enqueued).
      //
      // It also restores the old skip: a whitespace-only chunk normalizes to
      // '' and is dropped by the caller instead of burning an inference slot.
      // The other two producers already hash and resolve through the same
      // function, so this is the only asymmetric path.
      resolved.set(chunk.contentHash, normalizeEmbeddingText(chunk.text));
    }

    const pendingFindings = outstanding();
    if (pendingFindings.length) {
      const findings = await this.prisma.finding.findMany({
        where: { embedContentHash: { in: pendingFindings } },
        select: {
          embedContentHash: true,
          contextBefore: true,
          matchedContent: true,
          contextAfter: true,
        },
        distinct: ['embedContentHash'],
      });
      for (const finding of findings) {
        if (!finding.embedContentHash) continue;
        resolved.set(
          finding.embedContentHash,
          normalizeEmbeddingText(
            finding.contextBefore,
            finding.matchedContent,
            finding.contextAfter,
          ),
        );
      }
    }

    const pendingTerms = outstanding();
    if (pendingTerms.length) {
      const terms = await this.prisma.glossaryTerm.findMany({
        where: { embedContentHash: { in: pendingTerms } },
        select: {
          embedContentHash: true,
          term: true,
          aliases: true,
          notes: true,
        },
      });
      for (const term of terms) {
        if (!term.embedContentHash) continue;
        resolved.set(
          term.embedContentHash,
          normalizeEmbeddingText(term.term, ...term.aliases, term.notes),
        );
      }
    }

    return resolved;
  }

  private async handle(jobs: Job<EmbeddingJob>[]): Promise<void> {
    const rt = this.runtime();
    const seen = new Set<string>();
    const requested: string[] = [];
    const inline = new Map<string, string>();
    for (const job of jobs) {
      if (job.data?.spaceId !== rt.spaceId) continue;
      const work = jobWork(job.data);
      for (const [hash, text] of work.inline) inline.set(hash, text);
      for (const hash of work.hashes) {
        // A chunk can appear in more than one group when reconciliation
        // regroups it; embedding it twice in one pass would be waste.
        if (seen.has(hash)) continue;
        seen.add(hash);
        requested.push(hash);
      }
    }
    if (!requested.length) return;

    // Filter before reading text, not after: on a re-queued batch most hashes
    // already have a vector, and reading their text back would be the whole
    // point of this change wasted on rows nothing is going to embed.
    const missing = new Set(
      await this.embeddings.missingHashes(requested, rt.spaceId),
    );
    const outstanding = requested.filter((hash) => missing.has(hash));
    if (!outstanding.length) return;

    const lookups = outstanding.filter((hash) => !inline.has(hash));
    const fetched = await this.resolveTexts(lookups);
    const work: QueuedContent[] = [];
    for (const hash of outstanding) {
      const text = inline.get(hash) ?? fetched.get(hash);
      if (text) work.push({ hash, text });
    }
    if (!work.length) return;

    try {
      const vectors = await this.provider.embedMany(
        work.map((content) => content.text),
        this.cfg,
      );
      await this.embeddings.putVectors({
        spaceId: rt.spaceId as string,
        items: work.map((content, index) => ({
          contentHash: content.hash,
          vector: vectors[index],
        })),
      });
      rt.lastEmbedSuccessAt = new Date().toISOString();
    } catch (error) {
      rt.embedJobFailureCount += 1;
      rt.lastEmbedJobError =
        error instanceof Error ? error.message : String(error);
      rt.lastEmbedJobErrorAt = new Date().toISOString();
      if (
        rt.embedJobFailureCount === 1 ||
        rt.embedJobFailureCount % 100 === 0
      ) {
        this.logger.error(
          `Embedding job batch failed (${rt.embedJobFailureCount} total): ${rt.lastEmbedJobError}`,
        );
      }
      throw error;
    }
    void this.scheduleRecalibration();
  }

  private scheduleRecovery(): void {
    const rt = this.runtime();
    if (rt.recoveryTimer) return;
    rt.recoveryTimer = setTimeout(() => {
      rt.recoveryTimer = undefined;
      this.runCtx(rt.ctx, () => this.requestBackfill());
    }, this.cfg.retrySeconds * 1000);
  }

  private async backfillStoredContent(rt: EmbeddingRuntime): Promise<void> {
    try {
      if (rt.disposed) return;
      await this.backfillFindings(rt);
      if (rt.disposed) return;
      await this.backfillAssetChunks(rt);
      if (rt.disposed) return;
      await this.backfillGlossaryTerms(rt);
      if (rt.disposed) return;
      rt.backfillCompletedAt = new Date().toISOString();
      void this.scheduleRecalibration();
      this.logger.log(
        `Embedding reconciliation queued for space ${rt.spaceId}`,
      );
    } catch (error) {
      rt.backfillError = error instanceof Error ? error.message : String(error);
      this.logger.error(`Embedding backfill failed: ${rt.backfillError}`);
      this.scheduleRecovery();
    }
  }

  private async persistMissing(
    rt: EmbeddingRuntime,
    contents: QueuedContent[],
  ): Promise<void> {
    const missing = new Set(
      await this.embeddings.missingHashes(
        contents.map((content) => content.hash),
        rt.spaceId,
      ),
    );
    const work = contents.filter((content) => missing.has(content.hash));
    if (!work.length) return;
    await this.awaitQueueCapacity(rt);
    await this.persist(work);
  }

  /**
   * Holds the backfill while the queue is already full enough.
   *
   * Without this the producer runs at memory-and-disk speed and the consumer at
   * inference speed — measured at ~70,000 enqueued per minute against ~3
   * completed. The queue then grows without bound, and because pg-boss sorts
   * the due backlog on every fetch, growing it is what makes the consumer
   * slower still.
   *
   * This paces rather than discards. The walk resumes the moment there is room,
   * covering exactly the same chunks; only the rate changes.
   */
  private async awaitQueueCapacity(rt: EmbeddingRuntime): Promise<void> {
    if (!rt.queueName) return;
    // A missing or nonsensical limit must not pause the backfill forever:
    // pacing is an optimisation, and work never waits on a bad setting.
    const limit = Number(this.cfg.queueHighWaterMark);
    if (!Number.isFinite(limit) || limit <= 0) return;

    for (let attempt = 0; !rt.disposed; attempt++) {
      let queued: number;
      try {
        const boss = await this.pgBoss.getBossAsync();
        const stats = await boss.getQueueStats(rt.queueName);
        queued = stats?.queuedCount ?? 0;
      } catch {
        // Depth unknown: proceed rather than stall the backfill forever.
        return;
      }
      if (queued < limit) return;

      // Logged once per wait, not per poll: a long hold is normal on a large
      // corpus and should read as pacing rather than as a fault.
      if (attempt === 0) {
        this.logger.log(
          `Embedding backfill paused for space ${rt.spaceId}: ${queued} job(s) queued ` +
            `(limit ${limit}); resuming as the queue drains`,
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, QUEUE_CAPACITY_POLL_MS),
      );
    }
  }

  private async backfillFindings(rt: EmbeddingRuntime): Promise<void> {
    let cursor: string | undefined;
    do {
      if (rt.disposed) return;
      const findings = await this.prisma.finding.findMany({
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        take: INSERT_BATCH_SIZE,
        select: {
          id: true,
          embedContentHash: true,
          contextBefore: true,
          matchedContent: true,
          contextAfter: true,
        },
      });
      if (!findings.length) break;
      const contents = findings.map((finding) => {
        const text = normalizeEmbeddingText(
          finding.contextBefore,
          finding.matchedContent,
          finding.contextAfter,
        );
        return {
          findingId: finding.id,
          hash: finding.embedContentHash ?? embeddingContentHash(text),
          text,
          needsHash: !finding.embedContentHash,
        };
      });
      await Promise.all(
        contents
          .filter((content) => content.needsHash)
          .map((content) =>
            this.prisma.finding.update({
              where: { id: content.findingId },
              data: { embedContentHash: content.hash },
              select: { id: true },
            }),
          ),
      );
      await this.persistMissing(rt, contents);
      cursor = findings.at(-1)?.id;
      await new Promise((resolve) => setImmediate(resolve));
    } while (cursor);
  }

  private async backfillAssetChunks(rt: EmbeddingRuntime): Promise<void> {
    let cursor: string | undefined;
    do {
      if (rt.disposed) return;
      const chunks = await this.prisma.assetChunk.findMany({
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        take: INSERT_BATCH_SIZE,
        select: { id: true, contentHash: true, text: true },
      });
      if (!chunks.length) break;
      await this.persistMissing(
        rt,
        chunks.map((chunk) => ({
          hash: chunk.contentHash,
          text: chunk.text,
        })),
      );
      cursor = chunks.at(-1)?.id;
      await new Promise((resolve) => setImmediate(resolve));
    } while (cursor);
  }

  private async backfillGlossaryTerms(rt: EmbeddingRuntime): Promise<void> {
    let cursor: string | undefined;
    do {
      if (rt.disposed) return;
      const terms = await this.prisma.glossaryTerm.findMany({
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        take: INSERT_BATCH_SIZE,
        select: {
          id: true,
          term: true,
          aliases: true,
          notes: true,
          embedContentHash: true,
        },
      });
      if (!terms.length) break;
      const contents = terms.map((term) => {
        const text = normalizeEmbeddingText(
          term.term,
          ...term.aliases,
          term.notes,
        );
        const hash = embeddingContentHash(text);
        return {
          id: term.id,
          hash,
          text,
          needsHash: term.embedContentHash !== hash,
        };
      });
      await Promise.all(
        contents
          .filter((content) => content.needsHash)
          .map((content) =>
            this.prisma.glossaryTerm.update({
              where: { id: content.id },
              data: { embedContentHash: content.hash },
              select: { id: true },
            }),
          ),
      );
      await this.persistMissing(rt, contents);
      cursor = terms.at(-1)?.id;
      await new Promise((resolve) => setImmediate(resolve));
    } while (cursor);
  }
}
