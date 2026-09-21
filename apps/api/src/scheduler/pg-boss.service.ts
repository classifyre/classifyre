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
import {
  WorkerQueueRegistryService,
  type PausedQueuesSnapshot,
} from './worker-queue-registry.service';

/**
 * One live pg-boss subscription, re-established on resume without
 * re-registering the worker. `subscribe` closes over the boss, queue,
 * options and wrapped handler captured at registration.
 */
interface QueueSubscription {
  namespaceId: string;
  queue: string;
  subscribed: boolean;
  subscribe: () => Promise<void>;
}

/** Depth of one queue as reported by pg-boss itself. */
export interface QueueDepth {
  queue: string;
  queuedCount: number;
  activeCount: number;
  deferredCount: number;
  totalCount: number;
}

/**
 * Thrown when a batch parked for a paused queue outwaits the hold cap.
 *
 * Pause holds work rather than failing it (see {@link PgBossService.work}),
 * so reaching this means the queue stayed paused past the cap: pg-boss marks
 * the job failed and retries it, and the retried job then waits safely,
 * because nothing is fetching while the queue is paused.
 */
export class QueuePausedError extends Error {
  constructor(queue: string) {
    super(
      `Queue '${queue}' stayed paused past the hold window; pg-boss will retry this job`,
    );
    this.name = 'QueuePausedError';
  }
}

/**
 * How long a batch fetched just as its queue paused parks before giving up.
 *
 * Far below the shortest job expiry the codebase assumes (900s, see
 * `releaseAbandonedJobs`), so a parked batch is never reaped mid-wait. No
 * concurrency slot is held while parked — the park sits before the slot
 * wait — so a paused queue occupies nothing but its claimed rows.
 */
const PAUSED_BATCH_HOLD_MS = 60_000;

/** Pause-cache poll while a batch is parked. */
const PAUSED_BATCH_POLL_MS = 250;

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
  /** In-flight starts, so concurrent callers share one boss per schema. */
  private readonly starting = new Map<string, Promise<PgBossInstance>>();
  /**
   * Live pg-boss subscriptions per namespace schema, so a paused queue can be
   * unsubscribed and a resumed one re-subscribed without re-registering the
   * worker. Entries are pruned when their namespace stops.
   */
  private readonly subscriptions = new Map<
    string,
    Map<string, QueueSubscription>
  >();

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
    // Pause holds work instead of failing it: every pause-cache refresh stops
    // fetching paused queues and re-subscribes resumed ones. Batches caught
    // mid-fetch park in the work wrapper (see work).
    this.queueRegistry.onPausesRefreshed((paused) => {
      void this.syncPauseSubscriptions(paused).catch((error: unknown) =>
        this.logger.warn(`Pause subscription sync failed: ${String(error)}`),
      );
    });
  }

  /**
   * Start (idempotently) the pg-boss instance for a namespace schema.
   *
   * Concurrent callers share one in-flight start: without this two racing
   * callers each built a boss, one orphaned instance kept its timers against
   * a schema it no longer owned, and its errors looked like a sick namespace.
   */
  async startForNamespace(
    schema: string,
    namespaceId: string,
  ): Promise<PgBossInstance> {
    const existing = this.bosses.get(schema);
    if (existing) return existing;
    const inflight = this.starting.get(schema);
    if (inflight) return inflight;
    const task = this.doStart(schema, namespaceId).finally(() => {
      if (this.starting.get(schema) === task) this.starting.delete(schema);
    });
    this.starting.set(schema, task);
    return task;
  }

  private async doStart(
    schema: string,
    namespaceId: string,
  ): Promise<PgBossInstance> {
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
      // A boss whose connection is gone must not stay cached: every later
      // send/work through it fails the same way (the continuous `assertDb:
      // Database connection is not opened` noise from idle namespaces), while
      // nothing ever restarts it. Drop it so the next use starts a fresh one.
      if (isConnectionGone(error)) {
        this.logger.warn(
          `pg-boss connection for '${schema}' is gone; dropping the cached ` +
            `instance so the next use restarts it: ${String(error)}`,
        );
        if (this.bosses.get(schema) === boss) {
          this.bosses.delete(schema);
        }
        this.subscriptions.delete(schema);
        void boss.stop().catch(() => undefined);
        return;
      }
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
      // Every state, not only the finished ones. `deletion_seconds` is read
      // once a job completes, so restricting this to `state >= 'completed'`
      // bought nothing and left every job that was queued or in flight at
      // upgrade time carrying the old seven-day value — which it would then
      // honour *after* completing, up to a week later.
      const rows = await boss.getDb().executeSql(
        `UPDATE ${bossSchema}.job
              SET deletion_seconds = $1
            WHERE deletion_seconds > $1
          RETURNING id`,
        [COMPLETED_JOB_RETENTION_SECONDS],
      );
      const retired = rows?.rows?.length ?? 0;
      if (retired > 0) {
        this.logger.log(
          `Capped retention on ${retired} pg-boss job(s) in '${schema}' ` +
            `to ${COMPLETED_JOB_RETENTION_SECONDS}s; maintenance will collect ` +
            'them once they finish.',
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
    boss: PgBossInstance,
    queue: string,
    schema: string,
    namespaceId: string,
  ): Promise<void> {
    const bossSchema = pgBossSchemaForId(namespaceId);
    try {
      await boss.getDb().executeSql(
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

  /**
   * Whether this process serves `queue` in the current namespace.
   *
   * Workers bound to a queue whose name can change (the embedding queues are
   * named after their space) use it to tell "already serving this queue — a
   * released pause resumes it" from "must register": registering twice would
   * subscribe two handlers to one queue and process every batch twice.
   */
  hasSubscription(queue: string): boolean {
    const schema = this.requireSchema();
    return this.subscriptions.get(schema)?.has(queue) ?? false;
  }

  /**
   * Stop serving `queue` in the current namespace and forget it, so neither a
   * pause refresh nor the worker view brings it back. The counterpart of
   * {@link work} for a worker that re-binds to a different queue; a batch
   * already running finishes normally.
   */
  async unsubscribe(queue: string): Promise<void> {
    const schema = this.requireSchema();
    const subscription = this.subscriptions.get(schema)?.get(queue);
    this.subscriptions.get(schema)?.delete(queue);
    if (subscription) {
      this.queueRegistry.unregister({
        namespaceId: subscription.namespaceId,
        queue,
      });
    }
    const boss = this.bosses.get(schema);
    if (!boss) return;
    try {
      await boss.offWork(queue);
    } catch (error) {
      // Nothing to stop (never subscribed here, or the queue is gone).
      this.logger.debug(
        `offWork('${queue}') in '${schema}' failed: ${String(error)}`,
      );
    }
  }

  /** Stop and forget the pg-boss instance for a namespace schema. */
  async stopForNamespace(schema: string): Promise<void> {
    const boss = this.bosses.get(schema);
    if (!boss) return;
    this.bosses.delete(schema);
    this.subscriptions.delete(schema);
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
    if (namespaceId) {
      await this.capQueueRetention(boss, queue, schema, namespaceId);
    }

    const wrapped = async (jobs: Job<T>[]): Promise<unknown> => {
      // Hold before taking a slot: a batch fetched in the race between the
      // pause landing and the unsubscribe parks here without occupying one of
      // the few global slots, burns no retry, and runs once resumed. Past the
      // hold cap the normal retry path applies — and the retried job then
      // waits safely, because nothing is fetching while paused.
      if (observed && this.queueRegistry.isPaused(observed)) {
        await this.waitForResume(queue, observed);
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
    const subscribe = () =>
      (
        boss.work as unknown as (
          q: string,
          o: Record<string, unknown>,
          h: (jobs: Job<T>[]) => Promise<unknown>,
        ) => Promise<string>
      )(queue, options, wrapped);
    const workerId = await subscribe();
    if (observed && namespaceId) {
      let queues = this.subscriptions.get(schema);
      if (!queues) {
        queues = new Map();
        this.subscriptions.set(schema, queues);
      }
      const subscription: QueueSubscription = {
        namespaceId,
        queue,
        subscribed: true,
        subscribe: () => subscribe().then(() => undefined),
      };
      queues.set(queue, subscription);
      // A queue paused before this worker (re)started must not fetch its
      // first batch: read the pauses table directly rather than waiting for
      // the next flush to unsubscribe us.
      try {
        if ((await this.queueRegistry.listPaused(namespaceId)).has(queue)) {
          await boss.offWork(queue);
          subscription.subscribed = false;
          this.logger.log(
            `Queue '${queue}' in '${schema}' is paused: not fetching until resume`,
          );
        }
      } catch (error) {
        // Assume running; the flush reconcile corrects us within one interval.
        this.logger.warn(
          `Could not read pause state for queue '${queue}' in '${schema}': ` +
            `${String(error)}`,
        );
      }
    }
    return workerId;
  }

  /**
   * Stop fetching paused queues and re-subscribe resumed ones, driven by the
   * pause-cache refresh. Jobs pg-boss already handed out stay `active` but
   * park in the work wrapper without holding a concurrency slot; everything
   * still queued stays `created` and is fetched on resume. A failed
   * unsubscribe keeps its subscription so the next refresh retries it.
   */
  async syncPauseSubscriptions(paused: PausedQueuesSnapshot): Promise<void> {
    for (const [schema, queues] of this.subscriptions) {
      const boss = this.bosses.get(schema);
      if (!boss) {
        this.subscriptions.delete(schema);
        continue;
      }
      for (const subscription of queues.values()) {
        const isPaused = paused.some(
          (key) =>
            key.namespaceId === subscription.namespaceId &&
            key.queue === subscription.queue,
        );
        if (isPaused && subscription.subscribed) {
          try {
            await boss.offWork(subscription.queue);
          } catch (error) {
            this.logger.warn(
              `Could not stop fetching paused queue '${subscription.queue}' ` +
                `in '${schema}': ${String(error)} — retrying on the next refresh`,
            );
            continue;
          }
          subscription.subscribed = false;
          this.logger.log(
            `Queue '${subscription.queue}' in '${schema}' paused: workers ` +
              `stopped fetching; queued jobs wait for resume`,
          );
        } else if (!isPaused && !subscription.subscribed) {
          try {
            await subscription.subscribe();
          } catch (error) {
            this.logger.warn(
              `Could not resume fetching queue '${subscription.queue}' ` +
                `in '${schema}': ${String(error)} — retrying on the next refresh`,
            );
            continue;
          }
          subscription.subscribed = true;
          this.logger.log(
            `Queue '${subscription.queue}' in '${schema}' resumed: workers fetching again`,
          );
        }
      }
    }
  }

  /**
   * Park a fetched batch while its queue is paused, without taking a slot.
   * Throws {@link QueuePausedError} (normal pg-boss retry) only when the
   * queue stays paused past the hold cap.
   */
  private async waitForResume(
    queue: string,
    key: { namespaceId: string; queue: string },
  ): Promise<void> {
    const startedAt = Date.now();
    while (this.queueRegistry.isPaused(key)) {
      if (Date.now() - startedAt >= PAUSED_BATCH_HOLD_MS) {
        throw new QueuePausedError(queue);
      }
      await delay(PAUSED_BATCH_POLL_MS);
    }
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Whether a pg-boss error means its connection is gone rather than one query
 * failing. Only these evict the cached instance: evicting on any error would
 * restart a healthy boss under every transient query failure.
 */
export function isConnectionGone(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return (
    /database connection is not opened/i.test(message) ||
    /client has encountered a connection error and is not queryable/i.test(
      message,
    ) ||
    /connection terminated/i.test(message) ||
    /server closed the connection/i.test(message) ||
    /ECONNRESET|ECONNREFUSED/i.test(message)
  );
}
