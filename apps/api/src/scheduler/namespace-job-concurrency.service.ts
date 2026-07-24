import { Injectable, Logger } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import {
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from '../registry/namespace-registry.sql';

const WORKER_LOCK_SCOPE = 1_127_074_643;
const FIRST_WORKER_SLOT = 10_000;

export interface NamespaceJobIdentity {
  namespaceId?: string;
  namespaceSlug?: string;
  queue: string;
}

/**
 * Database-backed semaphore shared by every worker replica and namespace.
 *
 * Worker registrations remain active for every tenant so no tenant starves.
 * Actual pg-boss handler batches wait here before executing. Session-scoped
 * advisory locks release automatically when a worker pod or DB connection
 * dies, providing cross-replica failover without a separate coordinator.
 */
@Injectable()
export class NamespaceJobConcurrencyService {
  private readonly logger = new Logger(NamespaceJobConcurrencyService.name);
  private readonly limit = parseLimit(
    process.env.MAX_CONCURRENT_NAMESPACE_JOBS,
  );
  private readonly retryDelayMs = parseRetryDelay(
    process.env.NAMESPACE_JOB_SLOT_RETRY_MS,
  );
  private readonly pool =
    this.limit === 0
      ? null
      : new Pool({
          connectionString: publicConnectionString(),
          options: PUBLIC_SEARCH_PATH_OPTION,
          // One holder plus one waiter per configured slot is enough locally;
          // additional handlers wait in pg.Pool without consuming DB sessions.
          max: Math.max(2, this.limit * 2),
        });
  private closing = false;

  getLimit(): number {
    return this.limit;
  }

  async withSlot<T>(
    identity: NamespaceJobIdentity,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!this.pool) return operation();
    if (this.closing) {
      throw new Error('Namespace job concurrency service is shutting down');
    }

    const client = await this.pool.connect();
    let acquiredSlot: number | undefined;
    try {
      acquiredSlot = await this.acquire(client, identity);
      return await operation();
    } finally {
      if (acquiredSlot !== undefined) {
        await client
          .query(
            'SELECT pg_advisory_unlock($1::integer, $2::integer + $3::integer)',
            [WORKER_LOCK_SCOPE, FIRST_WORKER_SLOT, acquiredSlot],
          )
          .catch((error) =>
            this.logger.warn(
              `Failed to release namespace job slot ${acquiredSlot}: ${String(error)}`,
            ),
          );
      }
      client.release();
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.pool?.end();
  }

  private async acquire(
    client: PoolClient,
    identity: NamespaceJobIdentity,
  ): Promise<number> {
    let loggedWaiting = false;
    while (!this.closing) {
      // Start at a stable tenant-specific offset to avoid every replica always
      // contending for slot zero when the configured limit is greater than one.
      const offset = stableOffset(identity.namespaceId, this.limit);
      for (let attempt = 0; attempt < this.limit; attempt += 1) {
        const slot = (offset + attempt) % this.limit;
        const { rows } = await client.query<{ acquired: boolean }>(
          `SELECT pg_try_advisory_lock(
             $1::integer,
             $2::integer + $3::integer
           ) AS acquired`,
          [WORKER_LOCK_SCOPE, FIRST_WORKER_SLOT, slot],
        );
        if (rows[0]?.acquired) {
          if (loggedWaiting) {
            this.logger.log(
              `Namespace '${identity.namespaceSlug ?? identity.namespaceId ?? 'unknown'}' acquired worker slot ${slot + 1}/${this.limit} for ${identity.queue}`,
            );
          }
          return slot;
        }
      }

      if (!loggedWaiting) {
        loggedWaiting = true;
        this.logger.log(
          `Namespace '${identity.namespaceSlug ?? identity.namespaceId ?? 'unknown'}' waiting for one of ${this.limit} global worker slot(s) for ${identity.queue}`,
        );
      }
      await delay(this.retryDelayMs);
    }
    throw new Error(
      'Namespace job concurrency service shut down while waiting',
    );
  }
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 1;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `MAX_CONCURRENT_NAMESPACE_JOBS must be an integer >= 0 (got ${JSON.stringify(raw)})`,
    );
  }
  return value;
}

function parseRetryDelay(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 250;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 10) {
    throw new Error(
      `NAMESPACE_JOB_SLOT_RETRY_MS must be an integer >= 10 (got ${JSON.stringify(raw)})`,
    );
  }
  return value;
}

function stableOffset(namespaceId: string | undefined, limit: number): number {
  if (!namespaceId || limit <= 1) return 0;
  let hash = 0;
  for (const char of namespaceId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % limit;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
