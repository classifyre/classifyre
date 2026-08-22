import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import os from 'node:os';
import { Pool } from 'pg';
import {
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from '../registry/namespace-registry.sql';
import {
  WORKER_HEARTBEAT_STALE_MS,
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
  private readonly pausedQueues = new Set<string>();
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
   * Whether this queue is paused, from the cache refreshed on each flush tick.
   *
   * Deliberately synchronous and slightly stale: it is consulted on the hot
   * path of every job batch, and a pause taking up to one flush interval to
   * take effect is not worth a database round-trip per job.
   */
  isPaused(key: WorkerQueueKey): boolean {
    return this.pausedQueues.has(cacheKey(key.namespaceId, key.queue));
  }

  /** Pause or resume a queue across every worker replica. */
  async setPaused(key: WorkerQueueKey, paused: boolean): Promise<void> {
    const pool = this.requirePool();
    if (paused) {
      await pool.query(
        `INSERT INTO public.worker_queue_pauses (namespace_id, queue)
         VALUES ($1::uuid, $2)
         ON CONFLICT (namespace_id, queue) DO NOTHING`,
        [key.namespaceId, key.queue],
      );
      this.pausedQueues.add(cacheKey(key.namespaceId, key.queue));
      return;
    }
    await pool.query(
      'DELETE FROM public.worker_queue_pauses WHERE namespace_id = $1::uuid AND queue = $2',
      [key.namespaceId, key.queue],
    );
    this.pausedQueues.delete(cacheKey(key.namespaceId, key.queue));
  }

  /** Queues paused for a namespace, read straight from the database. */
  async listPaused(namespaceId: string): Promise<Set<string>> {
    const { rows } = await this.requirePool().query<{ queue: string }>(
      'SELECT queue FROM public.worker_queue_pauses WHERE namespace_id = $1::uuid',
      [namespaceId],
    );
    return new Set(rows.map((row) => row.queue));
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
      this.pausedQueues.add(cacheKey(row.namespace_id, row.queue));
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
