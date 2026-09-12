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
 * How long a finished job's row (and its payload) is kept.
 *
 * pg-boss has two independent retention knobs and they are easy to confuse:
 * `retentionSeconds` writes `keep_until`, which is only consulted for jobs in a
 * state *below* active — it expires work that was never picked up. Finished
 * jobs are deleted on `deletion_seconds`, which defaults to seven days and
 * which nothing here was setting.
 *
 * The gap is not academic. On one namespace 103,904 completed
 * `semantic-embeddings` jobs were holding 4,040 MB of TOASTed payload — a fifth
 * of the entire database — while the code that enqueued them believed it had
 * asked for a one-day retention. The same table had to be pruned by hand on the
 * VPS once already.
 *
 * An hour is long enough to inspect a failure that just happened and short
 * enough that the queue never becomes storage. Nothing reads completed jobs:
 * run history lives in `runners`, and the only pg-boss reads here are
 * `getQueueStats`/`getQueues`, which count queued, active and deferred.
 */
const COMPLETED_JOB_RETENTION_SECONDS = 3600;

/** How often pg-boss sweeps jobs whose retention has expired. */
const MAINTENANCE_INTERVAL_SECONDS = 600;

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
      // How often finished jobs are actually collected.
      //
      // pg-boss defaults this to MAX_EXPIRATION_HOURS — 24 hours — so a queue
      // sweeps its expired rows once a day. Capping retention is only half the
      // fix without this: with the default, a namespace that had just had its
      // retention lowered from seven days to one hour still sat on 121,710
      // completed jobs and 4.5 GB, because the next sweep was a day away.
      //
      // Ten minutes keeps the table small, and the sweep is cheap precisely
      // because it is frequent — there is never much to delete.
      maintenanceIntervalSeconds: MAINTENANCE_INTERVAL_SECONDS,
    });
    boss.on('error', (error) => {
      this.logger.error(`pg-boss error [${schema}]:`, error);
    });
    await boss.start();
    this.bosses.set(schema, boss);
    await this.releaseAbandonedJobs(boss, schema, namespaceId);
    await this.normalizeJobRetention(boss, schema, namespaceId);
    this.logger.log(`pg-boss started for namespace schema '${schema}'`);
    return boss;
  }

  /**
   * Cap how long finished jobs are kept, for every queue in this namespace.
   *
   * Done here rather than at each `createQueue` call site for two reasons.
   * `createQueue` is `ON CONFLICT DO NOTHING`, so options passed to it are
   * ignored for every queue that already exists — which is all of them on an
   * upgrade. And `deletion_seconds` is copied onto each job row at insert time,
   * so fixing the queue default alone would leave the existing backlog to sit
   * out its original seven days.
   *
   * Both are therefore updated: the queue, so new jobs inherit the cap, and the
   * rows already written, so pg-boss's own maintenance pass collects the
   * backlog on its next run instead of needing a manual DELETE.
   *
   * Only ever lowers a value. A queue that deliberately asks to keep its jobs
   * for less than this keeps its own setting.
   */
  private async normalizeJobRetention(
    boss: PgBossInstance,
    schema: string,
    namespaceId: string,
  ): Promise<void> {
    const bossSchema = pgBossSchemaForId(namespaceId);
    try {
      await boss.getDb().executeSql(
        `UPDATE ${bossSchema}.queue
              SET deletion_seconds = $1
            WHERE deletion_seconds > $1`,
        [COMPLETED_JOB_RETENTION_SECONDS],
      );
      const rows = await boss.getDb().executeSql(
        `UPDATE ${bossSchema}.job
              SET deletion_seconds = $1
            WHERE deletion_seconds > $1
              AND state >= 'completed'
          RETURNING id`,
        [COMPLETED_JOB_RETENTION_SECONDS],
      );
      const retired = rows?.rows?.length ?? 0;
      if (retired > 0) {
        this.logger.log(
          `Capped retention on ${retired} finished pg-boss job(s) in '${schema}' ` +
            `to ${COMPLETED_JOB_RETENTION_SECONDS}s; maintenance will collect them.`,
        );
      }
    } catch (error) {
      // Retention is housekeeping. A namespace must still start without it.
      this.logger.error(
        `Could not normalize job retention for '${schema}': ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Fail jobs left `active` by a process that died holding them.
   *
   * A job is claimed by marking it active; releasing it is the worker's
   * responsibility, so a worker that is OOMKilled mid-job leaves the row
   * claimed by a process that no longer exists. Each job carries its own
   * `expire_seconds` and pg-boss is supposed to reap them, but that reaping
   * runs *inside* the same process — so the failure that creates the mess is
   * the failure that stops it being cleaned up.
   *
   * Observed: one worker OOM left 44 jobs stuck across four namespaces,
   * including the `auto-schedule.tick` singleton. Nothing ran for seven hours
   * while every pod reported healthy, because the queue that starts scans was
   * permanently occupied by a job belonging to a dead process. It needed a
   * manual UPDATE to recover.
   *
   * Startup is the right moment: a process starting up is, by definition, one
   * that is not holding any of these. Each job's own `expire_seconds` is
   * honoured rather than a blanket timeout, so a legitimately long job running
   * in another live replica is not touched.
   */
  private async releaseAbandonedJobs(
    boss: PgBossInstance,
    schema: string,
    namespaceId: string,
  ): Promise<void> {
    const bossSchema = pgBossSchemaForId(namespaceId);
    try {
      const rows = await boss.getDb().executeSql(
        `UPDATE ${bossSchema}.job
            SET state = 'failed',
                completed_on = now(),
                output = jsonb_build_object(
                  'message',
                  'expired: worker terminated while the job was active'
                )
          WHERE state = 'active'
            AND started_on < now() - (coalesce(expire_seconds, 900) * interval '1 second')
          RETURNING name`,
        [],
      );
      const released = rows?.rows?.length ?? 0;
      if (released > 0) {
        const names = [
          ...new Set(rows.rows.map((r: { name: string }) => r.name)),
        ];
        this.logger.warn(
          `Released ${released} abandoned pg-boss job(s) in '${schema}' left ` +
            `active by a terminated worker (${names.join(', ')}). Those queues ` +
            'were blocked until now.',
        );
      }
    } catch (error) {
      // Never stop a namespace from starting because the cleanup failed.
      this.logger.error(
        `Could not release abandoned jobs for '${schema}': ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Cap one queue's retention, lowering it only.
   *
   * A queue that deliberately asks to keep its finished jobs for less than this
   * keeps its own setting.
   */
  private async capQueueRetention(
    queue: string,
    schema: string,
    namespaceId: string,
  ): Promise<void> {
    const bossSchema = pgBossSchemaForId(namespaceId);
    try {
      await this.currentBoss()
        .getDb()
        .executeSql(
          `UPDATE ${bossSchema}.queue
              SET deletion_seconds = $1
            WHERE name = $2 AND deletion_seconds > $1`,
          [COMPLETED_JOB_RETENTION_SECONDS, queue],
        );
    } catch (error) {
      // Housekeeping: a queue must still register without it.
      this.logger.warn(
        `Could not cap retention for queue '${queue}' in '${schema}': ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
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

    // Cap this queue's retention here as well as at startup, because most
    // queues do not exist yet at startup: `startForNamespace` runs before the
    // workers register, and `createQueue` is ON CONFLICT DO NOTHING, so options
    // passed to it are ignored for a queue that already exists. On a freshly
    // created namespace that left ten of eleven queues on pg-boss's seven-day
    // default until the next process restart.
    if (namespaceId) await this.capQueueRetention(queue, schema, namespaceId);

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
