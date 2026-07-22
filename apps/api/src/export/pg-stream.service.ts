import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import QueryStream from 'pg-query-stream';
import { stringify } from 'csv-stringify';
import { pipeline } from 'node:stream/promises';
import type { FastifyReply } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { CLS_SCHEMA } from '../namespace/namespace.constants';

export interface CsvStreamColumn {
  /** Row key produced by the SQL query. */
  key: string;
  /** Column header written to the CSV. */
  header: string;
}

export interface CsvStreamRequest {
  sql: string;
  params: unknown[];
  columns: CsvStreamColumn[];
  filename: string;
}

/**
 * Streams query results to an HTTP response as CSV without buffering the whole
 * result set in memory.
 *
 * PrismaPg owns its own internal pg pool (see prisma.service.ts) and the codebase
 * deliberately avoids handing it an external pool, so this service constructs and
 * owns dedicated pg.Pools — one per namespace schema, resolved from the CLS
 * context of the current request (each with `search_path=<schema>,public`).
 * A small LRU bounds the number of resident pools.
 */
@Injectable()
export class PgStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(PgStreamService.name);
  /** Insertion-ordered → iteration yields least-recently-used first. */
  private readonly pools = new Map<string, Pool>();
  private readonly maxResident = Number(
    process.env.PG_STREAM_MAX_RESIDENT ?? 8,
  );

  constructor(private readonly cls: ClsService) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.pools.values()].map((p) => p.end().catch(() => {})),
    );
    this.pools.clear();
  }

  async dropForSchema(schema: string): Promise<void> {
    const pool = this.pools.get(schema);
    if (!pool) return;
    this.pools.delete(schema);
    await pool.end().catch(() => undefined);
  }

  /** Resolve (or lazily create) the pool for the current namespace schema. */
  private getPool(): Pool {
    const schema = this.cls.get<string>(CLS_SCHEMA);
    if (!schema) {
      throw new Error(
        'PgStreamService used outside a namespace context (no schema in CLS).',
      );
    }
    const existing = this.pools.get(schema);
    if (existing) {
      // Mark most-recently-used.
      this.pools.delete(schema);
      this.pools.set(schema, existing);
      return existing;
    }
    const rawUrl = new URL(process.env.DATABASE_URL ?? '');
    rawUrl.searchParams.delete('schema');
    const pool = new Pool({
      connectionString: rawUrl.toString(),
      max: 2,
      options: `-c search_path=${schema},public`,
    });
    this.pools.set(schema, pool);
    this.evictIfNeeded();
    return pool;
  }

  private evictIfNeeded(): void {
    while (this.pools.size > this.maxResident) {
      const oldest = this.pools.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const pool = this.pools.get(oldest);
      this.pools.delete(oldest);
      void pool?.end().catch(() => {});
    }
  }

  /**
   * Acquires a dedicated client, streams the query through csv-stringify into the
   * Fastify raw response, and releases the client exactly once on finish, error,
   * or client abort.
   */
  async streamCsv(
    reply: FastifyReply,
    request: CsvStreamRequest,
  ): Promise<void> {
    const { sql, params, columns, filename } = request;

    const client = await this.getPool().connect();
    let released = false;
    const release = (err?: unknown) => {
      if (released) return;
      released = true;
      // Pass the error to release() so a broken connection is discarded, not reused.
      client.release(err instanceof Error ? err : undefined);
    };

    reply.raw.setHeader('Content-Type', 'text/csv; charset=utf-8');
    reply.raw.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    // Take over the response so Fastify does not also try to send it.
    reply.hijack();

    // If the client disconnects mid-stream, abort the query and release.
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) {
        release(new Error('client aborted'));
      }
    });

    const queryStream = client.query(
      new QueryStream(sql, params, { highWaterMark: 1024 }),
    );
    const csvStream = stringify({
      header: true,
      columns: columns.map((c) => ({ key: c.key, header: c.header })),
    });

    try {
      await pipeline(queryStream, csvStream, reply.raw);
      release();
    } catch (error) {
      release(error);
      this.logger.error(`CSV export stream failed: ${String(error)}`);
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader('Content-Type', 'application/json');
        reply.raw.end(
          JSON.stringify({
            error: 'Internal Server Error',
            message: 'Failed to stream CSV export.',
          }),
        );
      } else if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  }
}
