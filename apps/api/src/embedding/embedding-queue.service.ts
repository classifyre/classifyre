import { Injectable, Logger } from '@nestjs/common';
import type { Job, JobInsert } from 'pg-boss';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { EmbeddingCapabilityService } from './embedding-capability.service';
import { embeddingContentHash, normalizeEmbeddingText } from './embedding-text';
import { EmbeddingConfigService } from './embedding-config.service';
import { EmbeddingProviderService } from './embedding-provider.service';
import { EmbeddingService } from './embedding.service';
import { runsBackgroundWorkers } from '../service-role';
import {
  CLS_SCHEMA,
  CLS_NAMESPACE_ID,
  CLS_SLUG,
} from '../namespace/namespace.constants';

const EMBEDDING_QUEUE_PREFIX = 'semantic-embeddings';
const RECALIBRATE_QUEUE_PREFIX = 'semantic-recalibrate';
const EMBEDDING_GROUP = 'embedding-inference';
const INSERT_BATCH_SIZE = 500;
// Insert-time analysis is order-dependent (early vectors see a sparse space),
// so a full recalibration pass runs once the inference queue drains. The delay
// batches bursts of scans into one pass; singletonKey collapses repeat requests.
const RECALIBRATE_DELAY_SECONDS = 120;

type QueuedContent = { hash: string; text: string };
type EmbeddingJob = QueuedContent & { spaceId: string };

/** Captured namespace context so timers/setImmediate can re-enter CLS. */
interface NsCtx {
  schema?: string;
  namespaceId?: string;
  slug?: string;
}

/** Per-namespace embedding-queue state (was single-instance). */
interface EmbeddingRuntime {
  ctx: NsCtx;
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
  ) {}

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
        pendingWrites: 0,
        workerRegistered: false,
        recalibrationRunning: false,
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
      return fn();
    });
  }

  /**
   * Lazily initialize the queues for the current namespace (safe on the `api`
   * role — enqueue works without registering any worker).
   */
  private async ensureRuntime(): Promise<EmbeddingRuntime> {
    const rt = this.runtime();
    if (rt.queueName) return rt;
    await this.capability.ensureReady();
    const space = await this.embeddings.configuredSpace();
    rt.spaceId = space.id;
    rt.queueName = `${EMBEDDING_QUEUE_PREFIX}-${space.id}`;
    rt.recalibrateQueueName = `${RECALIBRATE_QUEUE_PREFIX}-${space.id}`;
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(rt.queueName, { policy: 'exclusive' });
    await boss.createQueue(rt.recalibrateQueueName, { policy: 'exclusive' });
    return rt;
  }

  /**
   * Register the embedding worker for the CURRENT namespace (invoked by the
   * NamespaceWorkerManager inside the namespace's CLS context). No-op when
   * embeddings are disabled.
   */
  async registerForNamespace(): Promise<void> {
    if (!this.config.enabled) return;
    const rt = await this.ensureRuntime();
    if (!runsBackgroundWorkers()) return;

    await this.pgBoss.work(
      rt.queueName as string,
      {
        batchSize: this.config.batchSize,
        localConcurrency: 1,
        groupConcurrency: this.config.workerConcurrency,
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
      `Registered persistent embedding worker for space ${rt.spaceId} (batch=${this.config.batchSize}, global concurrency=${this.config.workerConcurrency})`,
    );
    if (this.config.autoBackfill) {
      const ctx = rt.ctx;
      setImmediate(() => this.runCtx(ctx, () => this.requestBackfill()));
    }
  }

  enqueue(contents: QueuedContent[]): void {
    if (!this.config.enabled || !contents.length) return;
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
      provider: this.config.provider,
      model: this.config.model,
      spaceId: rt.spaceId,
      autoBackfill: this.config.autoBackfill,
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
    if (!this.config.enabled) return false;
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
        retryDelay: this.config.retrySeconds,
        expireInSeconds: 3600,
        retentionSeconds: 86400,
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
    if (pending > 0) {
      // Inference is still draining; push the pass back until the space is
      // stable so scores are computed against the full neighbourhood.
      await this.persistRecalibration(false);
      return;
    }
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

  private async persist(contents: QueuedContent[]): Promise<void> {
    const rt = await this.ensureRuntime();
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
      const jobs: JobInsert<EmbeddingJob>[] = [...unique].map(
        ([hash, text]) => ({
          data: { spaceId: rt.spaceId as string, hash, text },
          singletonKey: hash,
          group: { id: EMBEDDING_GROUP },
          retryLimit: 5,
          retryDelay: this.config.retrySeconds,
          retryBackoff: true,
          retryDelayMax: 3600,
          expireInSeconds: 3600,
          retentionSeconds: 86400,
        }),
      );
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

  private async handle(jobs: Job<EmbeddingJob>[]): Promise<void> {
    const rt = this.runtime();
    const contents = jobs
      .map((job) => job.data)
      .filter(
        (data): data is EmbeddingJob =>
          data?.spaceId === rt.spaceId &&
          typeof data.hash === 'string' &&
          typeof data.text === 'string',
      );
    if (!contents.length) return;

    const missing = new Set(
      await this.embeddings.missingHashes(
        contents.map((content) => content.hash),
        rt.spaceId,
      ),
    );
    const work = contents.filter((content) => missing.has(content.hash));
    if (!work.length) return;

    try {
      const vectors = await this.provider.embedMany(
        work.map((content) => content.text),
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
    }, this.config.retrySeconds * 1000);
  }

  private async backfillStoredContent(rt: EmbeddingRuntime): Promise<void> {
    try {
      await this.backfillFindings(rt);
      await this.backfillAssetChunks(rt);
      await this.backfillGlossaryTerms(rt);
      rt.backfillCompletedAt = new Date().toISOString();
      void this.scheduleRecalibration();
      this.logger.log(
        `Embedding reconciliation queued for space ${rt.spaceId}`,
      );
    } catch (error) {
      rt.backfillError =
        error instanceof Error ? error.message : String(error);
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
    await this.persist(contents.filter((content) => missing.has(content.hash)));
  }

  private async backfillFindings(rt: EmbeddingRuntime): Promise<void> {
    let cursor: string | undefined;
    do {
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
