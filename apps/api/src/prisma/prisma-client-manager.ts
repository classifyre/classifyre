import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { DatabaseLane } from '../namespace/namespace.constants';
import { serviceRole } from '../service-role';

interface NamespaceClients {
  interactive?: PrismaClient;
  background?: PrismaClient;
}

/**
 * Owns bounded interactive/background {@link PrismaClient} pools per Postgres
 * schema (tenant).
 *
 * With Prisma 7 driver adapters the connection `search_path` is fixed at pool
 * construction, so there is no per-query schema switch — each namespace needs
 * its own client/pool. API-capable processes split each namespace's configured
 * connection ceiling into an interactive lane and a background lane. This
 * manager caches them, bounds resident namespaces with LRU eviction
 * (insertion-ordered Map), and lets requests/workers `pin()` a namespace so its
 * clients are never torn down underneath a running query.
 *
 * `PrismaService` (a CLS-resolving Proxy) is the only expected caller of
 * {@link get}; nothing else should hold a long-lived reference to a client.
 */
@Injectable()
export class PrismaClientManager implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaClientManager.name);
  /** Insertion-ordered → iteration yields least-recently-used first. */
  private readonly clients = new Map<string, NamespaceClients>();
  /** Active worker/request references per schema; referenced clients cannot LRU-evict. */
  private readonly pins = new Map<string, number>();
  private readonly idleWaiters = new Map<string, Set<() => void>>();
  /**
   * Connections per schema. This is a ceiling, not a reservation: `pg` opens
   * connections lazily and reaps them after `idleTimeoutMillis`, so an idle
   * namespace costs nothing.
   *
   * It used to be 3, which a single overview page could exhaust on its own —
   * the scans/findings/assets views fan out a list, a count and a chart query
   * at the same time, and every one of those needed a connection while
   * background pollers held theirs. The result was `P2028 Unable to start a
   * transaction in the given time` and an empty table.
   */
  private readonly poolMax = parsePositiveInteger(
    'PRISMA_POOL_MAX',
    process.env.PRISMA_POOL_MAX,
    16,
  );
  /**
   * In API-capable processes, reserve part of each namespace's connection
   * budget for browser/API traffic. Authenticated CLI callbacks and in-process
   * workers use the remainder, so an ingest burst cannot occupy every
   * connection needed to render the UI.
   *
   * On the outage that motivated this split, background scans were not the
   * main consumer they were first taken to be: the discovery overview held a
   * connection for ~43 s per request because its aggregates scanned the whole
   * findings table, so a handful of dashboard loads could exhaust the pool on
   * their own. That query is now served from a rollup in single-digit
   * milliseconds. The split is kept because a scan does still compete for
   * connections and an unused ceiling costs nothing — but it bounds
   * contention, it does not remove work, and it is not a substitute for
   * finding the query that holds a connection too long.
   *
   * The interactive default is the whole of the old single-pool budget (10),
   * and `poolMax` was raised to fund the background lane on top of it, rather
   * than carving it out. Splitting the old 10 into 4 + 6 would have handed the
   * UI a budget barely above the 3 documented above as too small for one
   * overview page — trading a starvation stall for a P2028 stall. Pools are
   * lazy and reaped after `idleTimeoutMs`, so a ceiling nobody reaches costs
   * nothing; a ceiling set too low blocks every time.
   */
  private readonly interactivePoolMax = this.resolveInteractivePoolMax();
  private readonly backgroundPoolMax = this.resolveBackgroundPoolMax();
  private readonly maxResident = Number(process.env.PRISMA_MAX_RESIDENT ?? 20);
  /** Fail an acquire that hangs rather than blocking a request forever. */
  private readonly connectionTimeoutMs = Number(
    process.env.PRISMA_CONNECTION_TIMEOUT_MS ?? 10_000,
  );
  /** Return connections to Postgres when a namespace goes quiet. */
  private readonly idleTimeoutMs = Number(
    process.env.PRISMA_IDLE_TIMEOUT_MS ?? 10_000,
  );
  /**
   * How long a transaction may wait for a free connection before Prisma gives
   * up with P2028. Prisma's default is 2 s — too tight for a page that opens
   * several queries at once against a warm-but-busy pool.
   */
  private readonly txMaxWaitMs = Number(
    process.env.PRISMA_TX_MAX_WAIT_MS ?? 10_000,
  );
  /** Ceiling on a single interactive transaction (Prisma default: 5 s). */
  private readonly txTimeoutMs = Number(
    process.env.PRISMA_TX_TIMEOUT_MS ?? 30_000,
  );

  /** Get (or lazily create) the client for a schema, marking it most-recent. */
  get(schema: string, lane: DatabaseLane = 'interactive'): PrismaClient {
    const namespaceClients = this.clients.get(schema);
    const existing = namespaceClients?.[lane];
    if (existing) {
      this.touch(schema);
      return existing;
    }

    const rawUrl = new URL(process.env.DATABASE_URL ?? '');
    rawUrl.searchParams.delete('schema');
    // Pass config (not a Pool instance) so PrismaPg builds its own pool with its
    // bundled pg version — a foreign Pool fails PrismaPg's silent instanceof
    // checks. Keep `public` on the path for pgvector/pgcrypto operators.
    const adapter = new PrismaPg(
      {
        connectionString: rawUrl.toString(),
        max: this.poolMaxFor(lane),
        connectionTimeoutMillis: this.connectionTimeoutMs,
        idleTimeoutMillis: this.idleTimeoutMs,
        // Detect half-open sockets (k8s node reboot, laptop sleep) instead of
        // handing a dead connection to the next query.
        keepAlive: true,
        options: `-c search_path=${schema},public`,
      },
      { schema },
    );
    const client = new PrismaClient({
      adapter,
      transactionOptions: {
        maxWait: this.txMaxWaitMs,
        timeout: this.txTimeoutMs,
      },
    });
    this.clients.set(schema, {
      ...namespaceClients,
      [lane]: client,
    });
    this.touch(schema);
    this.evictIfNeeded();
    return client;
  }

  /** Prevent LRU eviction of a schema (e.g. it has active workers). */
  pin(schema: string, lane: DatabaseLane = 'interactive'): void {
    this.pins.set(schema, (this.pins.get(schema) ?? 0) + 1);
    try {
      this.get(schema, lane); // ensure the selected lane exists and is warm
    } catch (error) {
      this.unpin(schema);
      throw error;
    }
  }

  unpin(schema: string): void {
    const count = this.pins.get(schema) ?? 0;
    if (count <= 1) {
      this.pins.delete(schema);
      for (const resolve of this.idleWaiters.get(schema) ?? []) resolve();
      this.idleWaiters.delete(schema);
    } else this.pins.set(schema, count - 1);
  }

  residentSchemas(): string[] {
    return [...this.clients.keys()];
  }

  /** Wait for active requests/workers to release the client, then disconnect. */
  async dropWhenIdle(schema: string, timeoutMs = 15_000): Promise<void> {
    if (this.pins.has(schema)) {
      await new Promise<void>((resolve) => {
        const waiters = this.idleWaiters.get(schema) ?? new Set<() => void>();
        waiters.add(resolve);
        this.idleWaiters.set(schema, waiters);
        const timer = setTimeout(() => {
          waiters.delete(resolve);
          if (waiters.size === 0) this.idleWaiters.delete(schema);
          resolve();
        }, timeoutMs);
        timer.unref?.();
      });
    }
    await this.drop(schema);
  }

  /** Disconnect and forget a schema's client (called on namespace delete). */
  async drop(schema: string): Promise<void> {
    const clients = this.clients.get(schema);
    if (!clients) return;
    this.clients.delete(schema);
    this.pins.delete(schema);
    const results = await Promise.allSettled(
      Object.values(clients).map((client) => client.$disconnect()),
    );
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failed) {
      this.logger.warn(
        `Failed to disconnect Prisma client for schema '${schema}': ${String(failed.reason)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.clients.values()].flatMap((clients) =>
        Object.values(clients).map((client) =>
          client.$disconnect().catch(() => {}),
        ),
      ),
    );
    this.clients.clear();
    this.pins.clear();
    for (const waiters of this.idleWaiters.values()) {
      for (const resolve of waiters) resolve();
    }
    this.idleWaiters.clear();
  }

  private touch(schema: string): void {
    const clients = this.clients.get(schema);
    if (!clients) return;
    this.clients.delete(schema);
    this.clients.set(schema, clients);
  }

  private evictIfNeeded(): void {
    if (this.clients.size <= this.maxResident) return;
    for (const schema of [...this.clients.keys()]) {
      if (this.clients.size <= this.maxResident) break;
      if (this.pins.has(schema)) continue;
      void this.drop(schema);
    }
  }

  private poolMaxFor(lane: DatabaseLane): number {
    return lane === 'interactive'
      ? this.interactivePoolMax
      : this.backgroundPoolMax;
  }

  private resolveInteractivePoolMax(): number {
    if (serviceRole() === 'worker') return this.poolMax;
    const configured = parsePositiveInteger(
      'PRISMA_INTERACTIVE_POOL_MAX',
      process.env.PRISMA_INTERACTIVE_POOL_MAX,
      Math.min(10, Math.max(1, this.poolMax - 1)),
    );
    return Math.min(configured, Math.max(1, this.poolMax - 1));
  }

  private resolveBackgroundPoolMax(): number {
    if (serviceRole() === 'worker') return this.poolMax;
    return Math.max(1, this.poolMax - this.interactivePoolMax);
  }
}

function parsePositiveInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(
      `${name} must be an integer >= 1 (got ${JSON.stringify(raw)})`,
    );
  }
  return value;
}
