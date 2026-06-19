import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import QueryStream from 'pg-query-stream';
import { stringify } from 'csv-stringify';
import { pipeline } from 'node:stream/promises';
import type { FastifyReply } from 'fastify';

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
 * owns a dedicated pg.Pool — parsing DATABASE_URL the same way PrismaService does
 * (strip the `schema` query param and apply it via the connection `options`).
 */
@Injectable()
export class PgStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(PgStreamService.name);
  private readonly pool: Pool;

  constructor() {
    const rawUrl = new URL(process.env.DATABASE_URL ?? '');
    const schema = rawUrl.searchParams.get('schema');
    rawUrl.searchParams.delete('schema');

    this.pool = new Pool({
      connectionString: rawUrl.toString(),
      max: 4,
      ...(schema ? { options: `-c search_path=${schema}` } : {}),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
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

    const client = await this.pool.connect();
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

    // Single query per client — must not add concurrent client.query() calls
    // here or the pg@9 deprecation warning (CLASSIFYRE-9) will fire.
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
