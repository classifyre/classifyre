import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  CLS_DATABASE_LANE,
  CLS_SCHEMA,
  CLS_NAMESPACE_ID,
  CLS_SLUG,
  pgBossSchemaForId,
} from '../namespace/namespace.constants';

import type { Job } from 'pg-boss';
import { NamespaceJobConcurrencyService } from './namespace-job-concurrency.service';
import { WorkerQueueRegistryService } from './worker-queue-registry.service';

/** Depth of one queue as reported by pg-boss itself. */
export interface QueueDepth {
  queue: string;
  queuedCount: number;
  activeCount: number;
  deferredCount: number;
  totalCount: number;
}

/**
 * Thrown when a paused queue receives a batch.
 *
 * Pausing must not lose work, so the batch is refused rather than dropped;
 * pg-boss marks the job failed and retries it, and it runs for real once the
 * queue is resumed.
 */
export class QueuePausedError extends Error {
  constructor(queue: string) {
    super(`Queue '${queue}' is paused; pg-boss will retry this job`);
    this.name = 'QueuePausedError';
  }
}

type PgBossModule = typeof import('pg-boss');
type PgBossInstance = InstanceType<PgBossModule['PgBoss']>;

export { pgBossSchemaForId };

/**
 * Multi-tenant pg-boss: one {@link PgBossInstance} per namespace, each in its
 * own `pgboss_<uuid>` Postgres schema (derived from the immutable namespace
 * UUID, so a slug edit never orphans a job schema) so a namespace's worker can
 * only ever dequeue its own jobs (no cross-namespace leakage — the historical
 * "BUG D").
 *
 * The correct instance is resolved from the CLS namespace context, so existing
 * request-time enqueue sites (`getBossAsync().send(...)`) keep working — they
 * already run inside a resolved namespace. Worker registration goes through
 * {@link work}, which captures the current namespace and re-establishes it
 * around every job handler (jobs fire long after registration).
 */
@Injectable()
export class PgBossService implements OnApplicationShutdown {
  private readonly logger = new Logger(PgBossService.name);
  private readonly bosses = new Map<string, PgBossInstance>();

  constructor(
    private readonly cls: ClsService,
    private readonly namespaceConcurrency: NamespaceJobConcurrencyService,
    private readonly queueRegistry: WorkerQueueRegistryService,
  ) {
    // Waiting for a slot happens inside the semaphore, before the handler is
    // ever called - from pg-boss's side it is indistinguishable from a job
    // that is simply taking a long time, so the semaphore has to say so.
    this.namespaceConcurrency.setWaitObserver((identity) => {
      if (identity.namespaceId) {
        this.queueRegistry.markWaiting({
          namespaceId: identity.namespaceId,
          queue: identity.queue,
        });
      }
    });
  }

  /** Start (idempotently) the pg-boss instance for a namespace schema. */
  async startForNamespace(
    schema: string,
    namespaceId: string,
  ): Promise<PgBossInstance> {
    const existing = this.bosses.get(schema);
    if (existing) return existing;

    const { PgBoss } = await import('pg-boss');
    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      schema: pgBossSchemaForId(namespaceId),
    });
    boss.on('error', (error) => {
      this.logger.error(`pg-boss error [${schema}]:`, error);
    });
    await boss.start();
    this.bosses.set(schema, boss);
    this.logger.log(`pg-boss started for namespace schema '${schema}'`);
    return boss;
  }

  /** Stop and forget the pg-boss instance for a namespace schema. */
  async stopForNamespace(schema: string): Promise<void> {
    const boss = this.bosses.get(schema);
    if (!boss) return;
    this.bosses.delete(schema);
    await boss.stop({ graceful: true, timeout: 10_000 });
    this.logger.log(`pg-boss stopped for namespace schema '${schema}'`);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      [...this.bosses.keys()].map((schema) =>
        this.stopForNamespace(schema).catch(() => {}),
      ),
    );
    await this.namespaceConcurrency.close();
  }

  /**
   * Resolve the boss for the current CLS namespace, lazily starting it if
   * needed. Enqueue sites run on the `api` role too (where the worker manager
   * never started a boss), so start-on-demand keeps `send`/`insert` working
   * without registering any workers.
   */
  async getBossAsync(): Promise<PgBossInstance> {
    const schema = this.requireSchema();
    const existing = this.bosses.get(schema);
    if (existing) return existing;
    const namespaceId = this.cls.get<string>(CLS_NAMESPACE_ID);
    if (!namespaceId) {
      throw new Error(
        `Cannot start pg-boss for schema '${schema}': no namespaceId in CLS context.`,
      );
    }
    return this.startForNamespace(schema, namespaceId);
  }

  getBoss(): PgBossInstance {
    return this.currentBoss();
  }

  /**
   * Register a work handler on the current namespace's boss, re-establishing
   * that namespace's CLS context around every job (so injected services and
   * PrismaService resolve the right schema when the job later fires).
   */
  async work<T = unknown>(
    queue: string,
    options: Record<string, unknown>,
    handler: (jobs: Job<T>[]) => Promise<unknown>,
  ): Promise<string> {
    const schema = this.requireSchema();
    const namespaceId = this.cls.get<string>(CLS_NAMESPACE_ID);
    const slug = this.cls.get<string>(CLS_SLUG);
    const boss = this.currentBoss();
    // Every background queue in the product registers through this one method,
    // so instrumenting here covers all of them - and every queue added later.
    const observed = namespaceId ? { namespaceId, queue } : undefined;
    if (observed) this.queueRegistry.register(observed);

    const wrapped = async (jobs: Job<T>[]): Promise<unknown> => {
      // Refuse before taking a slot: a paused queue must not occupy one of the
      // few global slots just to fail.
      if (observed && this.queueRegistry.isPaused(observed)) {
        throw new QueuePausedError(queue);
      }
      try {
        const result = await this.namespaceConcurrency.withSlot(
          { namespaceId, namespaceSlug: slug, queue },
          () => {
            if (observed) {
              this.queueRegistry.markRunning(
                observed,
                jobs.map((job) => String(job.id)),
              );
            }
            return this.cls.run(() => {
              this.cls.set(CLS_SCHEMA, schema);
              this.cls.set(CLS_NAMESPACE_ID, namespaceId);
              this.cls.set(CLS_SLUG, slug);
              this.cls.set(CLS_DATABASE_LANE, 'background');
              return handler(jobs);
            });
          },
        );
        if (observed) this.queueRegistry.markFinished(observed);
        return result;
      } catch (error) {
        if (observed) this.queueRegistry.markFinished(observed, error);
        throw error;
      }
    };
    // pg-boss's overloaded work() signatures don't unify with a generic
    // wrapper; the runtime contract (queue, options, batch handler) is correct.
    return (
      boss.work as unknown as (
        q: string,
        o: Record<string, unknown>,
        h: (jobs: Job<T>[]) => Promise<unknown>,
      ) => Promise<string>
    )(queue, options, wrapped);
  }

  /**
   * Backlog per queue for the current namespace.
   *
   * Read from pg-boss rather than inferred from worker heartbeats: an idle
   * queue with thirty thousand jobs waiting looks identical to a genuinely
   * idle one otherwise.
   */
  async queueDepths(): Promise<QueueDepth[]> {
    const boss = await this.getBossAsync();
    const queues = await boss.getQueues();
    return queues.map((queue) => ({
      queue: queue.name,
      queuedCount: Number(queue.queuedCount ?? 0),
      activeCount: Number(queue.activeCount ?? 0),
      deferredCount: Number(queue.deferredCount ?? 0),
      totalCount: Number(queue.totalCount ?? 0),
    }));
  }

  private requireSchema(): string {
    const schema = this.cls.get<string>(CLS_SCHEMA);
    if (!schema) {
      throw new Error(
        'pg-boss accessed outside a namespace context (no schema in CLS).',
      );
    }
    return schema;
  }

  private currentBoss(): PgBossInstance {
    const schema = this.requireSchema();
    const boss = this.bosses.get(schema);
    if (!boss) {
      throw new Error(
        `pg-boss is not initialized for namespace schema '${schema}'.`,
      );
    }
    return boss;
  }
}
