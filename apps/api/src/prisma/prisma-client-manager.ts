import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Owns one {@link PrismaClient} per Postgres schema (tenant).
 *
 * With Prisma 7 driver adapters the connection `search_path` is fixed at pool
 * construction, so there is no per-query schema switch — each namespace needs
 * its own client/pool. This manager caches them, bounds the total with an LRU
 * eviction (insertion-ordered Map), and lets the worker manager `pin()` the
 * namespaces whose background jobs are mid-flight so their client is never torn
 * down underneath a running query.
 *
 * `PrismaService` (a CLS-resolving Proxy) is the only expected caller of
 * {@link get}; nothing else should hold a long-lived reference to a client.
 */
@Injectable()
export class PrismaClientManager implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaClientManager.name);
  /** Insertion-ordered → iteration yields least-recently-used first. */
  private readonly clients = new Map<string, PrismaClient>();
  private readonly pinned = new Set<string>();
  private readonly poolMax = Number(process.env.PRISMA_POOL_MAX ?? 3);
  private readonly maxResident = Number(process.env.PRISMA_MAX_RESIDENT ?? 20);

  /** Get (or lazily create) the client for a schema, marking it most-recent. */
  get(schema: string): PrismaClient {
    const existing = this.clients.get(schema);
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
        max: this.poolMax,
        options: `-c search_path=${schema},public`,
      },
      { schema },
    );
    const client = new PrismaClient({ adapter });
    this.clients.set(schema, client);
    this.evictIfNeeded();
    return client;
  }

  /** Prevent LRU eviction of a schema (e.g. it has active workers). */
  pin(schema: string): void {
    this.pinned.add(schema);
    this.get(schema); // ensure it exists and is warm
  }

  unpin(schema: string): void {
    this.pinned.delete(schema);
  }

  /** Disconnect and forget a schema's client (called on namespace delete). */
  async drop(schema: string): Promise<void> {
    const client = this.clients.get(schema);
    if (!client) return;
    this.clients.delete(schema);
    this.pinned.delete(schema);
    try {
      await client.$disconnect();
    } catch (error) {
      this.logger.warn(
        `Failed to disconnect Prisma client for schema '${schema}': ${String(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.clients.values()].map((c) => c.$disconnect().catch(() => {})),
    );
    this.clients.clear();
  }

  private touch(schema: string): void {
    const client = this.clients.get(schema);
    if (!client) return;
    this.clients.delete(schema);
    this.clients.set(schema, client);
  }

  private evictIfNeeded(): void {
    if (this.clients.size <= this.maxResident) return;
    for (const schema of [...this.clients.keys()]) {
      if (this.clients.size <= this.maxResident) break;
      if (this.pinned.has(schema)) continue;
      void this.drop(schema);
    }
  }
}
