import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import os from 'node:os';
import { Pool } from 'pg';
import {
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from '../registry/namespace-registry.sql';
import {
  WORKER_HEARTBEAT_STALE_MS,
  WORKER_HEARTBEAT_TTL_MS,
  WORKER_STATE_FLUSH_MS,
} from './worker-queue-state.sql';

export type WorkerQueueStatus =
  | 'idle'
  | 'waiting_slot'
  | 'running'
  | 'failed'
  | 'stale';

export interface WorkerQueueKey {
  namespaceId: string;
  queue: string;
}

/** Pause state as delivered to {@link WorkerQueueRegistryService.onPausesRefreshed} observers. */
export type PausedQueuesSnapshot = WorkerQueueKey[];

/** One worker process's view of one queue, as stored in `public`. */
export interface WorkerQueueRow {
  instanceId: string;
  namespaceId: string;
  queue: string;
  status: WorkerQueueStatus;
  activeJobs: number;
  jobIds: string[];
  startedAt: Date | null;
  lastFinishedAt: Date | null;
  lastDurationMs: number | null;
  runCount: number;
  failureCount: number;
  lastError: string | null;
  lastErrorAt: Date | null;
  heartbeatAt: Date;
  paused: boolean;
}

interface QueueCounters {
  namespaceId: string;
  queue: string;
  status: Exclude<WorkerQueueStatus, 'stale'>;
  activeJobs: number;
  jobIds: string[];
  startedAt: Date | null;
  lastFinishedAt: Date | null;
  lastDurationMs: number | null;
  runCount: number;
  failureCount: number;
  lastError: string | null;
  lastErrorAt: Date | null;
}

const MAX_ERROR_LENGTH = 2000;
const MAX_TRACKED_JOB_IDS = 20;

function cacheKey(namespaceId: string, queue: string): string {
  return `${namespaceId}::${queue}`;
}

/**
 * Cross-process record of what every background queue is doing.
 *
 * Counters are kept in memory and flushed on a timer rather than written per
 * job: the queues this measures (embedding batches above all) complete faster
 * than a database round-trip, so a write per transition would slow down the
 * very thing being observed.
 *
 * Writers are worker processes; the reader is usually a `SERVICE_ROLE=api`
 * pod, which is why the state lands in a shared `public` table instead of
 * process memory.
 */
@Injectable()
export class WorkerQueueRegistryService implements OnApplicationShutdown {
  private readonly logger = new Logger(WorkerQueueRegistryService.name);
  private readonly instanceId = `${os.hostname()}:${process.pid}`;
  private readonly counters = new Map<string, QueueCounters>();
  private readonly pausedQueues = new Map<string, WorkerQueueKey>();
  private readonly pauseObservers = new Set<
    (paused: PausedQueuesSnapshot) => unknown
  >();
  private pool: Pool | null = null;
  private flushTimer?: NodeJS.Timeout;
  private flushing = false;
  private stopped = false;

  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Announce a queue this process serves, so it appears as `idle` rather than
   * missing before its first job ever fires.
   */
  register(key: WorkerQueueKey): void {
    if (!key.namespaceId) return;
    const id = cacheKey(key.namespaceId, key.queue);
    if (!this.counters.has(id)) {
      this.counters.set(id, {
        namespaceId: key.namespaceId,
        queue: key.queue,
        status: 'idle',
        activeJobs: 0,
        jobIds: [],
        startedAt: null,
        lastFinishedAt: null,
        lastDurationMs: null,
        runCount: 0,
        failureCount: 0,
        lastError: null,
        lastErrorAt: null,
      });
    }
    this.ensureFlushLoop();
  }

  /** A batch is queueing for a concurrency slot rather than executing. */
  markWaiting(key: WorkerQueueKey): void {
    const entry = this.entry(key);
    if (entry) entry.status = 'waiting_slot';
  }

  /** A batch entered its handler. */
  markRunning(key: WorkerQueueKey, jobIds: string[]): void {
    const entry = this.entry(key);
    if (!entry) return;
    entry.status = 'running';
    entry.activeJobs = jobIds.length;
    entry.jobIds = jobIds.slice(0, MAX_TRACKED_JOB_IDS);
    entry.startedAt = new Date();
  }

  /** A batch left its handler, successfully or not. */
  markFinished(key: WorkerQueueKey, error?: unknown): void {
    const entry = this.entry(key);
    if (!entry) return;
    const finishedAt = new Date();
    entry.lastDurationMs = entry.startedAt
      ? finishedAt.getTime() - entry.startedAt.getTime()
      : null;
    entry.activeJobs = 0;
    entry.jobIds = [];
    entry.startedAt = null;
    entry.lastFinishedAt = finishedAt;
    entry.runCount += 1;
    if (error === undefined) {
      entry.status = 'idle';
      return;
    }
    entry.status = 'failed';
    entry.failureCount += 1;
    entry.lastError = describeError(error);
    entry.lastErrorAt = finishedAt;
  }

  /**
   * Stop reporting a queue this process no longer serves (its worker re-bound
   * to another queue). The row is deleted rather than left to age into
   * `stale`: nothing crashed, the queue simply is not served here any more.
   */
  unregister(key: WorkerQueueKey): void {
    if (!key.namespaceId) return;
    this.counters.delete(cacheKey(key.namespaceId, key.queue));
    const pool = this.pool;
    if (!pool) return;
    void pool
      .query(
        `DELETE FROM public.worker_queue_state
          WHERE instance_id = $1 AND namespace_id = $2::uuid AND queue = $3`,
        [this.instanceId, key.namespaceId, key.queue],
      )
      .catch(() => undefined);
  }

  /**
   * Whether this queue is paused, from the cache refreshed on each flush tick.
   *
   * Deliberately synchronous and slightly stale: it is consulted on the hot
   * path of every job batch, and a pause taking up to one flush interval to
   * take effect is not worth a database round-trip per job.
   */
  isPaused(key: WorkerQueueKey): boolean {
    return this.pausedQueues.has(cacheKey(key.namespaceId, key.queue));
  }

  /**
   * Observe the pause cache after every flush refresh.
   *
   * Workers use this to stop fetching paused queues (and resume them) without
   * polling the pauses table themselves: the flush tick is the one cadence
   * every worker already runs on, so a pause takes effect within one interval.
   */
  onPausesRefreshed(observer: (paused: PausedQueuesSnapshot) => unknown): void {
    this.pauseObservers.add(observer);
  }

  /**
   * Pause or resume a queue by hand (the Workers tab), across every worker
   * replica.
   *
   * A queue held paused by a workspace feature switch cannot be resumed here:
   * the operator's pause is cleared, the hold is not, and the result names the
   * feature so the caller can say where the switch is. Resuming it anyway would
   * run work the workspace has turned off — a duplicate check nobody wants,
   * inference into a corpus that was just deleted.
   */
  async setPaused(
    key: WorkerQueueKey,
    paused: boolean,
  ): Promise<{ heldBy: string | null }> {
    const pool = this.requirePool();
    if (paused) {
      await pool.query(
        `INSERT INTO public.worker_queue_pauses (namespace_id, queue, manual)
         VALUES ($1::uuid, $2, true)
         ON CONFLICT (namespace_id, queue) DO UPDATE SET manual = true`,
        [key.namespaceId, key.queue],
      );
      this.pausedQueues.set(cacheKey(key.namespaceId, key.queue), {
        namespaceId: key.namespaceId,
        queue: key.queue,
      });
      return { heldBy: null };
    }
    const { rows } = await pool.query<{ feature: string | null }>(
      `SELECT feature FROM public.worker_queue_pauses
        WHERE namespace_id = $1::uuid AND queue = $2`,
      [key.namespaceId, key.queue],
    );
    const heldBy = rows[0]?.feature ?? null;
    if (heldBy) {
      await pool.query(
        `UPDATE public.worker_queue_pauses SET manual = false
          WHERE namespace_id = $1::uuid AND queue = $2`,
        [key.namespaceId, key.queue],
      );
      return { heldBy };
    }
    await pool.query(
      'DELETE FROM public.worker_queue_pauses WHERE namespace_id = $1::uuid AND queue = $2',
      [key.namespaceId, key.queue],
    );
    this.pausedQueues.delete(cacheKey(key.namespaceId, key.queue));
    return { heldBy: null };
  }

  /**
   * Hold queues paused on behalf of a workspace feature that was turned off.
   *
   * Goes through the same table as a manual pause, so every replica stops
   * fetching within one flush interval with no extra machinery — the feature
   * switch is just a second reason for the pause that already exists. An
   * existing manual pause is preserved underneath the hold.
   */
  async holdForFeature(
    namespaceId: string,
    feature: string,
    queues: string[],
  ): Promise<void> {
    const names = [...new Set(queues.filter(Boolean))];
    if (names.length === 0) return;
    await this.requirePool().query(
      `INSERT INTO public.worker_queue_pauses (namespace_id, queue, manual, feature)
       SELECT $1::uuid, q, false, $2 FROM unnest($3::text[]) AS q
       ON CONFLICT (namespace_id, queue) DO UPDATE SET feature = EXCLUDED.feature`,
      [namespaceId, feature, names],
    );
    for (const queue of names) {
      this.pausedQueues.set(cacheKey(namespaceId, queue), {
        namespaceId,
        queue,
      });
    }
  }

  /**
   * Lift a feature's hold. Queues the operator had also paused by hand stay
   * paused; everything else resumes on the next flush. Returns the queues that
   * are running again.
   */
  async releaseFeature(
    namespaceId: string,
    feature: string,
  ): Promise<string[]> {
    const pool = this.requirePool();
    const { rows } = await pool.query<{ queue: string }>(
      `DELETE FROM public.worker_queue_pauses
        WHERE namespace_id = $1::uuid AND feature = $2 AND manual = false
        RETURNING queue`,
      [namespaceId, feature],
    );
    await pool.query(
      `UPDATE public.worker_queue_pauses SET feature = NULL
        WHERE namespace_id = $1::uuid AND feature = $2`,
      [namespaceId, feature],
    );
    const released = rows.map((row) => row.queue);
    for (const queue of released) {
      this.pausedQueues.delete(cacheKey(namespaceId, queue));
    }
    return released;
  }

  /** Queues paused for a namespace, read straight from the database. */
  async listPaused(namespaceId: string): Promise<Set<string>> {
    return new Set((await this.listPauseHolds(namespaceId)).keys());
  }

  /**
   * Every paused queue of a namespace, mapped to the feature holding it (null
   * for a plain manual pause).
   */
  async listPauseHolds(
    namespaceId: string,
  ): Promise<Map<string, string | null>> {
    const { rows } = await this.requirePool().query<{
      queue: string;
      feature: string | null;
    }>(
      'SELECT queue, feature FROM public.worker_queue_pauses WHERE namespace_id = $1::uuid',
      [namespaceId],
    );
    return new Map(rows.map((row) => [row.queue, row.feature ?? null]));
  }

  /**
   * Every reported queue row for a namespace, with rows whose heartbeat has
   * gone quiet downgraded to `stale`.
   */
  async listRows(namespaceId: string): Promise<WorkerQueueRow[]> {
    const pool = this.requirePool();
    const [states, paused] = await Promise.all([
      pool.query<StateRow>(
        `SELECT instance_id, namespace_id, queue, status, active_jobs, job_ids,
                started_at, last_finished_at, last_duration_ms, run_count,
                failure_count, last_error, last_error_at, heartbeat_at
           FROM public.worker_queue_state
          WHERE namespace_id = $1::uuid
          ORDER BY queue ASC, instance_id ASC`,
        [namespaceId],
      ),
      this.listPaused(namespaceId),
    ]);
    const now = Date.now();
    return states.rows.map((row) => {
      const heartbeatAt = new Date(row.heartbeat_at);
      const stale = now - heartbeatAt.getTime() > WORKER_HEARTBEAT_STALE_MS;
      return {
        instanceId: row.instance_id,
        namespaceId: row.namespace_id,
        queue: row.queue,
        status: stale ? 'stale' : toStatus(row.status),
        activeJobs: stale ? 0 : Number(row.active_jobs ?? 0),
        jobIds: stale ? [] : (row.job_ids ?? []),
        startedAt: row.started_at ? new Date(row.started_at) : null,
        lastFinishedAt: row.last_finished_at
          ? new Date(row.last_finished_at)
          : null,
        lastDurationMs:
          row.last_duration_ms === null ? null : Number(row.last_duration_ms),
        runCount: Number(row.run_count ?? 0),
        failureCount: Number(row.failure_count ?? 0),
        lastError: row.last_error,
        lastErrorAt: row.last_error_at ? new Date(row.last_error_at) : null,
        heartbeatAt,
        paused: paused.has(row.queue),
      };
    });
  }

  /** Flush counters and refresh the pause cache. Exposed for tests. */
  async flush(): Promise<void> {
    if (this.flushing || this.counters.size === 0) return;
    this.flushing = true;
    try {
      const pool = this.requirePool();
      const snapshot = [...this.counters.values()].map((entry) => ({
        ...entry,
      }));
      for (const entry of snapshot) {
        await pool.query(UPSERT_STATE_SQL, [
          this.instanceId,
          entry.namespaceId,
          entry.queue,
          entry.status,
          entry.activeJobs,
          entry.jobIds,
          entry.startedAt,
          entry.lastFinishedAt,
          entry.lastDurationMs,
          entry.runCount,
          entry.failureCount,
          entry.lastError,
          entry.lastErrorAt,
        ]);
      }
      await this.refreshPauses(pool);
      await this.reapOrphanedRows(pool);
      await this.notifyPauseObservers();
    } catch (error) {
      // Observability must never take the worker down with it.
      this.logger.warn(`Worker queue state flush failed: ${String(error)}`);
    } finally {
      this.flushing = false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    const pool = this.pool;
    if (!pool) return;
    this.pool = null;
    // Drop this process's rows rather than leaving them to age into `stale`:
    // a clean shutdown is not a crash and should not be reported as one.
    await pool
      .query('DELETE FROM public.worker_queue_state WHERE instance_id = $1', [
        this.instanceId,
      ])
      .catch(() => undefined);
    await pool.end().catch(() => undefined);
  }

  private async refreshPauses(pool: Pool): Promise<void> {
    const namespaceIds = [
      ...new Set([...this.counters.values()].map((e) => e.namespaceId)),
    ];
    if (namespaceIds.length === 0) return;
    const { rows } = await pool.query<{ namespace_id: string; queue: string }>(
      `SELECT namespace_id, queue FROM public.worker_queue_pauses
        WHERE namespace_id = ANY($1::uuid[])`,
      [namespaceIds],
    );
    this.pausedQueues.clear();
    for (const row of rows) {
      this.pausedQueues.set(cacheKey(row.namespace_id, row.queue), {
        namespaceId: row.namespace_id,
        queue: row.queue,
      });
    }
  }

  /**
   * Delete heartbeat rows silent past the TTL: crashed or killed workers
   * never run their shutdown cleanup, and their corpse rows would otherwise
   * pin queues at `stale` and pile dead instance ids into the UI forever.
   * Runs inside flush(), so every live worker reaps for the whole table on
   * its normal cadence — no extra timer, one cheap statement on a tiny
   * table. Covered by the same try/catch as the flush itself.
   */
  private async reapOrphanedRows(pool: Pool): Promise<void> {
    const cutoff = new Date(Date.now() - WORKER_HEARTBEAT_TTL_MS);
    await pool.query(
      `DELETE FROM public.worker_queue_state WHERE heartbeat_at < $1::timestamptz`,
      [cutoff.toISOString()],
    );
  }

  private async notifyPauseObservers(): Promise<void> {
    if (this.pauseObservers.size === 0) return;
    const snapshot: PausedQueuesSnapshot = [...this.pausedQueues.values()];
    for (const observer of this.pauseObservers) {
      try {
        await observer(snapshot);
      } catch (error) {
        // Subscription bookkeeping must never break the state flush.
        this.logger.warn(`Pause observer failed: ${String(error)}`);
      }
    }
  }

  private entry(key: WorkerQueueKey): QueueCounters | undefined {
    if (!key.namespaceId) return undefined;
    const id = cacheKey(key.namespaceId, key.queue);
    if (!this.counters.has(id)) this.register(key);
    return this.counters.get(id);
  }

  private ensureFlushLoop(): void {
    if (this.flushTimer || this.stopped) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, WORKER_STATE_FLUSH_MS);
    this.flushTimer.unref?.();
  }

  private requirePool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: publicConnectionString(),
        options: PUBLIC_SEARCH_PATH_OPTION,
        max: 2,
      });
    }
    return this.pool;
  }
}

const UPSERT_STATE_SQL = `
INSERT INTO public.worker_queue_state (
  instance_id, namespace_id, queue, status, active_jobs, job_ids,
  started_at, last_finished_at, last_duration_ms, run_count,
  failure_count, last_error, last_error_at, heartbeat_at
) VALUES (
  $1, $2::uuid, $3, $4, $5, $6::text[], $7, $8, $9, $10, $11, $12, $13, now()
)
ON CONFLICT (instance_id, namespace_id, queue) DO UPDATE SET
  status = EXCLUDED.status,
  active_jobs = EXCLUDED.active_jobs,
  job_ids = EXCLUDED.job_ids,
  started_at = EXCLUDED.started_at,
  last_finished_at = EXCLUDED.last_finished_at,
  last_duration_ms = EXCLUDED.last_duration_ms,
  run_count = EXCLUDED.run_count,
  failure_count = EXCLUDED.failure_count,
  last_error = EXCLUDED.last_error,
  last_error_at = EXCLUDED.last_error_at,
  heartbeat_at = now()
`;

interface StateRow {
  instance_id: string;
  namespace_id: string;
  queue: string;
  status: string;
  active_jobs: number | string;
  job_ids: string[] | null;
  started_at: string | null;
  last_finished_at: string | null;
  last_duration_ms: number | string | null;
  run_count: number | string;
  failure_count: number | string;
  last_error: string | null;
  last_error_at: string | null;
  heartbeat_at: string;
}

function toStatus(raw: string): WorkerQueueStatus {
  return raw === 'waiting_slot' ||
    raw === 'running' ||
    raw === 'failed' ||
    raw === 'stale'
    ? raw
    : 'idle';
}

/**
 * A short, human-readable label for whatever a handler threw.
 *
 * Non-Error throws are narrowed to primitives before stringifying rather than
 * passed to `String()` wholesale: a thrown plain object would otherwise be
 * recorded as `[object Object]`, which tells an operator nothing. Objects fall
 * back to JSON, which at least carries the fields.
 */
function describeError(error: unknown): string {
  return truncate(errorMessage(error));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error === null || error === undefined) return 'unknown error';
  if (
    typeof error === 'string' ||
    typeof error === 'number' ||
    typeof error === 'boolean' ||
    typeof error === 'bigint' ||
    typeof error === 'symbol'
  ) {
    return String(error);
  }
  try {
    return JSON.stringify(error) ?? 'unknown error';
  } catch {
    return 'unserializable error';
  }
}

function truncate(message: string): string {
  return message.slice(0, MAX_ERROR_LENGTH);
}
