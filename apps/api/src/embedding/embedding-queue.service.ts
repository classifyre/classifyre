import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job, JobInsert } from 'pg-boss';
import { PrismaService } from '../prisma.service';
import { PgBossService } from '../scheduler/pg-boss.service';
import { EmbeddingCapabilityService } from './embedding-capability.service';
import { embeddingContentHash, normalizeEmbeddingText } from './embedding-text';
import { EmbeddingConfigService } from './embedding-config.service';
import { EmbeddingProviderService } from './embedding-provider.service';
import { EmbeddingService } from './embedding.service';

const EMBEDDING_QUEUE_PREFIX = 'semantic-embeddings';
const EMBEDDING_GROUP = 'embedding-inference';
const INSERT_BATCH_SIZE = 500;

type QueuedContent = { hash: string; text: string };
type EmbeddingJob = QueuedContent & { spaceId: string };

@Injectable()
export class EmbeddingQueueService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmbeddingQueueService.name);
  private pendingWrites = 0;
  private workerRegistered = false;
  private recoveryTimer?: NodeJS.Timeout;
  private queueName?: string;
  private spaceId?: string;
  private backfillPromise?: Promise<void>;
  private backfillStartedAt?: string;
  private backfillCompletedAt?: string;
  private backfillError?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EmbeddingConfigService,
    private readonly provider: EmbeddingProviderService,
    private readonly embeddings: EmbeddingService,
    private readonly pgBoss: PgBossService,
    private readonly capability: EmbeddingCapabilityService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.enabled) return;
    await this.capability.ensureReady();
    const space = await this.embeddings.configuredSpace();
    this.spaceId = space.id;
    this.queueName = `${EMBEDDING_QUEUE_PREFIX}-${space.id}`;
    const boss = await this.pgBoss.getBossAsync();
    await boss.createQueue(this.queueName, { policy: 'exclusive' });
    await boss.work<EmbeddingJob>(
      this.queueName,
      {
        batchSize: this.config.batchSize,
        localConcurrency: 1,
        groupConcurrency: this.config.workerConcurrency,
      },
      (jobs) => this.handle(jobs),
    );
    this.workerRegistered = true;
    this.logger.log(
      `Registered persistent embedding worker for space ${space.id} (batch=${this.config.batchSize}, global concurrency=${this.config.workerConcurrency})`,
    );
    if (this.config.autoBackfill) {
      setImmediate(() => this.requestBackfill());
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

  status() {
    return {
      persistentQueue: true,
      pendingQueueWrites: this.pendingWrites,
      workerRegistered: this.workerRegistered,
      provider: this.config.provider,
      model: this.config.model,
      spaceId: this.spaceId,
      autoBackfill: this.config.autoBackfill,
      backfillRunning: Boolean(this.backfillPromise),
      backfillStartedAt: this.backfillStartedAt,
      backfillCompletedAt: this.backfillCompletedAt,
      backfillError: this.backfillError,
    };
  }

  requestBackfill() {
    if (!this.spaceId) {
      throw new Error('Embedding queue is not initialized');
    }
    if (this.backfillPromise) return { started: false, spaceId: this.spaceId };

    this.backfillStartedAt = new Date().toISOString();
    this.backfillCompletedAt = undefined;
    this.backfillError = undefined;
    this.backfillPromise = this.backfillStoredContent().finally(() => {
      this.backfillPromise = undefined;
    });
    return { started: true, spaceId: this.spaceId };
  }

  private async persist(contents: QueuedContent[]): Promise<void> {
    if (!this.queueName || !this.spaceId) {
      throw new Error('Embedding queue is not initialized');
    }
    const unique = new Map<string, string>();
    for (const content of contents) {
      const text = normalizeEmbeddingText(content.text);
      if (text) unique.set(content.hash, text);
    }
    if (!unique.size) return;

    this.pendingWrites += unique.size;
    try {
      const boss = await this.pgBoss.getBossAsync();
      const jobs: JobInsert<EmbeddingJob>[] = [...unique].map(
        ([hash, text]) => ({
          data: { spaceId: this.spaceId as string, hash, text },
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
          this.queueName,
          jobs.slice(offset, offset + INSERT_BATCH_SIZE),
        );
      }
    } finally {
      this.pendingWrites -= unique.size;
    }
  }

  private async handle(jobs: Job<EmbeddingJob>[]): Promise<void> {
    const contents = jobs
      .map((job) => job.data)
      .filter(
        (data): data is EmbeddingJob =>
          data?.spaceId === this.spaceId &&
          typeof data.hash === 'string' &&
          typeof data.text === 'string',
      );
    if (!contents.length) return;

    const missing = new Set(
      await this.embeddings.missingHashes(
        contents.map((content) => content.hash),
        this.spaceId,
      ),
    );
    const work = contents.filter((content) => missing.has(content.hash));
    if (!work.length) return;

    const vectors = await this.provider.embedMany(
      work.map((content) => content.text),
    );
    await this.embeddings.putVectors({
      spaceId: this.spaceId as string,
      items: work.map((content, index) => ({
        contentHash: content.hash,
        vector: vectors[index],
      })),
    });
  }

  private scheduleRecovery(): void {
    if (this.recoveryTimer) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      this.requestBackfill();
    }, this.config.retrySeconds * 1000);
  }

  private async backfillStoredContent(): Promise<void> {
    try {
      await this.backfillFindings();
      await this.backfillAssetChunks();
      this.backfillCompletedAt = new Date().toISOString();
      this.logger.log(
        `Embedding reconciliation queued for space ${this.spaceId}`,
      );
    } catch (error) {
      this.backfillError =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Embedding backfill failed: ${this.backfillError}`);
      this.scheduleRecovery();
    }
  }

  private async persistMissing(contents: QueuedContent[]): Promise<void> {
    const missing = new Set(
      await this.embeddings.missingHashes(
        contents.map((content) => content.hash),
        this.spaceId,
      ),
    );
    await this.persist(contents.filter((content) => missing.has(content.hash)));
  }

  private async backfillFindings(): Promise<void> {
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
      await this.persistMissing(contents);
      cursor = findings.at(-1)?.id;
      await new Promise((resolve) => setImmediate(resolve));
    } while (cursor);
  }

  private async backfillAssetChunks(): Promise<void> {
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
        chunks.map((chunk) => ({
          hash: chunk.contentHash,
          text: chunk.text,
        })),
      );
      cursor = chunks.at(-1)?.id;
      await new Promise((resolve) => setImmediate(resolve));
    } while (cursor);
  }
}
