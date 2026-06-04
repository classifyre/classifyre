import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ExportQueryService, type PagedQuery } from './export-query.service';
import type {
  ExportAssetsQueryDto,
  ExportFindingsQueryDto,
  ExportRunnerAssetsQueryDto,
} from '../dto/export-query.dto';

export interface LiveQueryResult {
  items: Record<string, unknown>[];
  nextCursor: string | null;
}

interface PageOptions {
  limit?: unknown;
  cursor?: unknown;
}

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;

/**
 * Executes the cursor-paginated "live query" endpoints consumed by Excel Power
 * Query (and any HTTP/JSON client). Builds keyset-paginated SQL via
 * {@link ExportQueryService}, runs it through Prisma's raw query API, and returns
 * `{ items, nextCursor }` where `nextCursor` is an opaque base64url token.
 */
@Injectable()
export class LiveQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exportQuery: ExportQueryService,
  ) {}

  async queryFindings(
    filters: ExportFindingsQueryDto,
    options: PageOptions,
  ): Promise<LiveQueryResult> {
    const limit = clampLimit(options.limit);
    const pq = this.exportQuery.buildFindingsPaged(
      filters,
      limit,
      decodeCursor(options.cursor),
    );
    return this.run(pq, limit);
  }

  async queryAssets(
    filters: ExportAssetsQueryDto,
    options: PageOptions,
  ): Promise<LiveQueryResult> {
    const limit = clampLimit(options.limit);
    const pq = this.exportQuery.buildAssetsPaged(
      filters,
      limit,
      decodeCursor(options.cursor),
    );
    return this.run(pq, limit);
  }

  async queryRunnerAssets(
    filters: ExportRunnerAssetsQueryDto,
    options: PageOptions,
  ): Promise<LiveQueryResult> {
    const limit = clampLimit(options.limit);
    const pq = this.exportQuery.buildRunnerAssetsPaged(
      filters,
      limit,
      decodeCursor(options.cursor),
    );
    return this.run(pq, limit);
  }

  private async run(pq: PagedQuery, limit: number): Promise<LiveQueryResult> {
    const rows = await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      pq.sql,
      ...pq.params,
    );

    // A full page means there may be more — emit a cursor built from the last
    // row's key columns. A short page is the last page.
    let nextCursor: string | null = null;
    if (rows.length === limit && rows.length > 0) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor(pq.cursorKeys.map((k) => last[k]));
    }

    // Strip synthetic cursor columns so the returned rows match the CSV columns.
    const items = rows.map((row) => {
      const item = { ...row };
      for (const key of pq.cursorKeys) {
        if (key.startsWith('__cursor_')) {
          delete item[key];
        }
      }
      return item;
    });

    return { items, nextCursor };
  }
}

function clampLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.floor(n));
}

function decodeCursor(cursor: unknown): string[] | undefined {
  if (typeof cursor !== 'string' || cursor.length === 0) {
    return undefined;
  }
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    return Array.isArray(parsed) ? parsed.map(safeStr) : undefined;
  } catch {
    return undefined;
  }
}

function encodeCursor(values: unknown[]): string {
  return Buffer.from(JSON.stringify(values.map(safeStr)), 'utf8').toString(
    'base64url',
  );
}

function safeStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return '';
}
