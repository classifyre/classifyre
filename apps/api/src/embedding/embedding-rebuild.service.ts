import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import {
  CLS_NAMESPACE_ID,
  CLS_SCHEMA,
  CLS_SLUG,
} from '../namespace/namespace.constants';
import { PgBossService } from '../scheduler/pg-boss.service';
import { EmbeddingService } from './embedding.service';
import { EmbeddingQueueService } from './embedding-queue.service';
import { EmbeddingSettingsService } from './embedding-settings.service';

/**
 * Purges a workspace's vectors and re-embeds the corpus from scratch.
 *
 * This exists because the alternative is worse. Vectors are only comparable
 * within one coordinate system, so after a model change the stored corpus is
 * not stale data — it is meaningless data that still answers queries. Keeping
 * both generations side by side was the original design (spaces are additive,
 * and `EmbeddingSpace` still supports that for validation work), but on a real
 * install it means the disk holds two full copies of a corpus while search
 * silently reads whichever space happens to be active.
 *
 * So a configuration change that redefines the space is treated as what it is:
 * a rebuild. Everything derived from the old vectors goes with them —
 * `content_embeddings` and, by foreign key, `finding_evidence_analyses`, which
 * is where evidence ranking lives. **Findings themselves are never touched.**
 * Until the rebuild and the recalibration pass behind it finish, ranked scores
 * read as zero, which is why the settings page says so before it starts.
 */
@Injectable()
export class EmbeddingRebuildService {
  private readonly logger = new Logger(EmbeddingRebuildService.name);
  /** Schemas with a rebuild in flight, so two clicks cannot start two. */
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: EmbeddingSettingsService,
    private readonly embeddings: EmbeddingService,
    private readonly queue: EmbeddingQueueService,
    private readonly pgBoss: PgBossService,
    private readonly cls: ClsService,
  ) {}

  private schema(): string {
    const schema = this.cls.get<string>(CLS_SCHEMA);
    if (!schema) {
      throw new Error('Embedding rebuild used outside a namespace context');
    }
    return schema;
  }

  isRunning(): boolean {
    return this.running.has(this.cls.get<string>(CLS_SCHEMA) ?? '');
  }

  /**
   * Starts a rebuild and returns immediately.
   *
   * A rebuild walks the whole corpus, so it is measured in minutes to hours on
   * anything real — it cannot be an HTTP request's lifetime. Progress is read
   * back from `GET /embeddings/status`, and the start/finish/error timestamps
   * are persisted so the page can still describe an interrupted one after an
   * API restart.
   */
  start(reason: string): { started: boolean } {
    const schema = this.schema();
    if (this.running.has(schema)) return { started: false };
    this.running.add(schema);

    const ctx = {
      schema,
      namespaceId: this.cls.get<string>(CLS_NAMESPACE_ID),
      slug: this.cls.get<string>(CLS_SLUG),
    };
    // Detached deliberately: see the doc comment above. Failures are recorded
    // on the settings row rather than thrown into a response nobody is waiting
    // on any more.
    setImmediate(() => {
      void this.cls.run(async () => {
        this.cls.set(CLS_SCHEMA, ctx.schema);
        if (ctx.namespaceId) this.cls.set(CLS_NAMESPACE_ID, ctx.namespaceId);
        if (ctx.slug) this.cls.set(CLS_SLUG, ctx.slug);
        try {
          await this.run(reason);
        } finally {
          this.running.delete(schema);
        }
      });
    });
    return { started: true };
  }

  private async run(reason: string): Promise<void> {
    const schema = this.schema();
    await this.mark({
      rebuildStartedAt: new Date(),
      rebuildCompletedAt: null,
      rebuildError: null,
      rebuildReason: reason,
    });

    try {
      this.logger.log(`Embedding rebuild started for ${schema}: ${reason}`);
      await this.queue.stopForSchema(schema);
      const purged = await this.purge();
      this.embeddings.clearForSchema(schema);
      this.settings.clearForSchema(schema);
      this.logger.log(
        `Purged ${purged.spaces} embedding space(s) and ${purged.vectors} vector(s) for ${schema}`,
      );

      const cfg = await this.settings.resolve();
      if (!cfg.enabled) {
        // Turned off: the corpus is gone and nothing re-creates a space. This
        // is a completed rebuild, not a failed one — turning embeddings back
        // on starts a fresh one.
        await this.mark({
          rebuildCompletedAt: new Date(),
          rebuildError: null,
        });
        this.logger.log(
          `Embeddings are disabled for ${schema}; corpus purged and left empty`,
        );
        return;
      }

      // Re-registering binds a space built from the new configuration and,
      // when autoBackfill is on, starts walking the corpus into it.
      await this.queue.registerForNamespace();
      if (!cfg.autoBackfill) this.queue.requestBackfill();

      await this.mark({ rebuildCompletedAt: new Date(), rebuildError: null });
      this.logger.log(
        `Embedding rebuild for ${schema} is re-embedding into ${cfg.provider}:${cfg.model}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Embedding rebuild failed for ${schema}: ${message}`);
      await this.mark({
        rebuildCompletedAt: new Date(),
        rebuildError: message,
      }).catch(() => undefined);
    }
  }

  /**
   * Drops every embedding space in this workspace, and the partial HNSW index
   * each one owns.
   *
   * The indexes need explicit drops: they are created outside Prisma's
   * migration history (one per space, named after the space id) so nothing
   * else knows they exist. Deleting only the rows would leave an index on a
   * `space_id` that can never appear again — dead weight in every future
   * `content_embeddings` write.
   */
  private async purge(): Promise<{ spaces: number; vectors: number }> {
    const spaces = await this.prisma.embeddingSpace.findMany({
      select: { id: true },
    });
    let vectors = 0;
    try {
      const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM content_embeddings
      `;
      vectors = Number(rows[0]?.count ?? 0);
    } catch {
      // Counting is for the log line only; never fail a purge over it.
    }

    for (const space of spaces) {
      if (!/^[0-9a-f-]{36}$/i.test(space.id)) continue;
      const indexName = `content_embeddings_${space.id.replaceAll('-', '')}_hnsw`;
      try {
        await this.prisma.$executeRawUnsafe(
          `DROP INDEX IF EXISTS "${indexName}"`,
        );
      } catch (error) {
        this.logger.warn(
          `Could not drop ${indexName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      await this.dropQueues(space.id);
    }

    // Cascades to content_embeddings and finding_evidence_analyses.
    await this.prisma.embeddingSpace.deleteMany({});
    return { spaces: spaces.length, vectors };
  }

  /** Removes the per-space pg-boss queues so their backlog dies with the space. */
  private async dropQueues(spaceId: string): Promise<void> {
    try {
      const boss = await this.pgBoss.getBossAsync();
      for (const name of [
        `embedding-${spaceId}`,
        `embedding-recalibrate-${spaceId}`,
      ]) {
        await (
          boss as unknown as { deleteQueue?: (n: string) => Promise<void> }
        ).deleteQueue?.(name);
      }
    } catch (error) {
      // A leftover queue is inert once its space is gone: nothing enqueues to
      // it and no worker is registered for it. Worth a line, not a failure.
      this.logger.warn(
        `Could not delete embedding queues for space ${spaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async mark(data: {
    rebuildStartedAt?: Date;
    rebuildCompletedAt?: Date | null;
    rebuildError?: string | null;
    rebuildReason?: string;
  }): Promise<void> {
    await this.prisma.embeddingSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
  }
}
