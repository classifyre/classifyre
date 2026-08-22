import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import {
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from '../registry/namespace-registry.sql';

/** Same lock scope as the migration lock and the job-slot semaphore. */
const WORKER_LOCK_SCOPE = 1_127_074_643;
/** Distinct from MIGRATION_LOCK_ID (1) and the job slots (10_000+). */
const CHAT_CONNECTOR_LOCK_ID = 2;

const DEFAULT_POLL_MS = 10_000;

/**
 * Elects exactly one worker process to own the singleton background work.
 *
 * Almost everything the worker does is already safe to run on several
 * replicas: pg-boss hands each job to exactly one consumer, and the job-slot
 * semaphore is a Postgres advisory lock shared across replicas, so more
 * replicas add throughput without exceeding the configured concurrency. The
 * chat connectors are the one exception — two pollers double-poll Telegram
 * (which surfaces as a 409 on the losing one) and double-reply on Slack.
 *
 * The election is a session-scoped `pg_try_advisory_lock` held on a dedicated
 * checked-out client. Postgres drops a session lock the instant its connection
 * dies, so a killed leader fails over with no lease expiry to tune. Two things
 * this has to get right, and both have bitten people who wrote this quickly:
 *
 * 1. The locking client must stay checked out. Returning it to the pool
 *    releases the lock while this process still believes it leads.
 * 2. Losing leadership must actually stop the connectors. A demoted leader
 *    that keeps polling is precisely the double-reply this exists to prevent.
 */
@Injectable()
export class WorkerLeadershipService implements OnApplicationShutdown {
  private readonly logger = new Logger(WorkerLeadershipService.name);
  private readonly pollMs = parsePollMs(process.env.WORKER_LEADER_POLL_MS);
  private pool: Pool | null = null;
  private client: PoolClient | null = null;
  private timer?: NodeJS.Timeout;
  private leader = false;
  private stopped = false;
  private polling = false;
  private onAcquired?: () => Promise<void> | void;
  private onLost?: () => Promise<void> | void;

  /** Whether this process currently owns the singleton work. */
  isLeader(): boolean {
    return this.leader;
  }

  /**
   * Begin campaigning. `onAcquired` runs when this process becomes leader and
   * `onLost` when it stops being one; both are awaited so a handover cannot
   * interleave a start with a stop.
   */
  start(handlers: {
    onAcquired: () => Promise<void> | void;
    onLost: () => Promise<void> | void;
  }): void {
    if (this.timer || this.stopped) return;
    this.onAcquired = handlers.onAcquired;
    this.onLost = handlers.onLost;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    this.timer.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.release();
    const pool = this.pool;
    this.pool = null;
    await pool?.end().catch(() => undefined);
  }

  private async poll(): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      if (this.leader) {
        await this.verifyStillConnected();
        return;
      }
      await this.tryAcquire();
    } catch (error) {
      // A database blip must not silently leave a process believing it leads.
      this.logger.warn(`Worker leadership poll failed: ${String(error)}`);
      await this.demote();
    } finally {
      this.polling = false;
    }
  }

  private async tryAcquire(): Promise<void> {
    const client = await this.requireClient();
    const { rows } = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired',
      [WORKER_LOCK_SCOPE, CHAT_CONNECTOR_LOCK_ID],
    );
    if (!rows[0]?.acquired) return;
    this.leader = true;
    this.logger.log(
      'Acquired worker leadership; starting singleton chat connectors here',
    );
    await this.onAcquired?.();
  }

  /**
   * Confirm the session still holds the lock.
   *
   * `pg_advisory_lock` is session-scoped, so the only way to lose it while
   * this process lives is the connection dropping — which a trivial query
   * detects, and which `pg` surfaces by failing the query rather than by
   * quietly reconnecting on the same client.
   */
  private async verifyStillConnected(): Promise<void> {
    const client = this.client;
    if (!client) {
      await this.demote();
      return;
    }
    await client.query('SELECT 1');
  }

  private async demote(): Promise<void> {
    if (!this.leader) {
      this.dropClient();
      return;
    }
    this.leader = false;
    this.logger.warn(
      'Lost worker leadership; stopping chat connectors on this process',
    );
    this.dropClient();
    await Promise.resolve(this.onLost?.()).catch((error) =>
      this.logger.warn(
        `Failed to stop singleton work after losing leadership: ${String(error)}`,
      ),
    );
  }

  private async release(): Promise<void> {
    const client = this.client;
    if (client && this.leader) {
      await client
        .query('SELECT pg_advisory_unlock($1::integer, $2::integer)', [
          WORKER_LOCK_SCOPE,
          CHAT_CONNECTOR_LOCK_ID,
        ])
        .catch(() => undefined);
    }
    this.leader = false;
    this.dropClient();
  }

  private dropClient(): void {
    const client = this.client;
    this.client = null;
    // `release(true)` destroys the connection rather than returning it to the
    // pool, so a half-dead session can never be handed to the next caller.
    client?.release(true);
  }

  private async requireClient(): Promise<PoolClient> {
    if (this.client) return this.client;
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: publicConnectionString(),
        options: PUBLIC_SEARCH_PATH_OPTION,
        // One connection, held for the lifetime of the leadership.
        max: 1,
      });
    }
    this.client = await this.pool.connect();
    return this.client;
  }
}

function parsePollMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_POLL_MS;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1000) {
    throw new Error(
      `WORKER_LEADER_POLL_MS must be an integer >= 1000 (got ${JSON.stringify(raw)})`,
    );
  }
  return value;
}
