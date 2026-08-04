import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import {
  SITEMAP_ENTITIES,
  SITEMAP_ENTITY_TYPES,
  type SitemapEntityType,
} from './sitemap.entities';
import type {
  SitemapChunkDto,
  SitemapEntriesDto,
  SitemapEntryDto,
  SitemapIndexDto,
  SitemapSectionDto,
} from './sitemap.dto';

/** Default URLs per child sitemap. Well under the 50 000-URL protocol limit. */
export const DEFAULT_SITEMAP_CHUNK_SIZE = 10_000;
export const MAX_SITEMAP_CHUNK_SIZE = 50_000;
export const MIN_SITEMAP_CHUNK_SIZE = 100;

/**
 * How long a computed index is reused. The index aggregates every row of every
 * entity table, so an uncached crawl of a large tenant would be a handful of
 * full scans per hit; crawlers re-fetch the index often and are happy with
 * minutes-old data.
 */
const INDEX_CACHE_TTL_MS = Number(
  process.env.SITEMAP_INDEX_CACHE_TTL_MS ?? 5 * 60 * 1000,
);

/** Bound on cached indexes (one per namespace × chunk size). */
const INDEX_CACHE_MAX_ENTRIES = 64;

interface ChunkRow {
  chunk: number;
  count: number;
  last_modified: Date | null;
}

interface EntryRow {
  id: string;
  last_modified: Date | null;
}

interface CacheEntry {
  value: SitemapIndexDto;
  expiresAt: number;
}

/**
 * Sitemap coordinates for the current namespace's detail pages.
 *
 * Deliberately minimal: ids and timestamps only. The web app owns the URL
 * shapes (`apps/web/lib/sitemap-config.ts`) and renders the XML, so this API
 * stays a cheap, paginated projection that can enumerate millions of rows
 * without materialising a single domain object.
 */
@Injectable()
export class SitemapService {
  private readonly logger = new Logger(SitemapService.name);
  private readonly indexCache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  /** Clamp a caller-supplied chunk size into the protocol-safe range. */
  static normalizeChunkSize(value: number | undefined): number {
    if (!value || !Number.isFinite(value)) return DEFAULT_SITEMAP_CHUNK_SIZE;
    return Math.min(
      MAX_SITEMAP_CHUNK_SIZE,
      Math.max(MIN_SITEMAP_CHUNK_SIZE, Math.trunc(value)),
    );
  }

  async getIndex(rawChunkSize?: number): Promise<SitemapIndexDto> {
    const chunkSize = SitemapService.normalizeChunkSize(rawChunkSize);
    const cacheKey = `${this.cls.get<string>(CLS_SCHEMA) ?? ''}|${chunkSize}`;

    const cached = this.indexCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const sections = await Promise.all(
      SITEMAP_ENTITY_TYPES.map((type) => this.section(type, chunkSize)),
    );

    const value: SitemapIndexDto = {
      generatedAt: new Date().toISOString(),
      chunkSize,
      sections,
    };

    this.cacheIndex(cacheKey, value);
    return value;
  }

  async getEntries(
    type: SitemapEntityType,
    chunk: number,
    rawChunkSize?: number,
  ): Promise<SitemapEntriesDto> {
    const chunkSize = SitemapService.normalizeChunkSize(rawChunkSize);
    const safeChunk = Math.max(0, Math.trunc(chunk) || 0);
    const config = SITEMAP_ENTITIES[type];

    let rows: EntryRow[] = [];
    try {
      rows = await this.prisma.$queryRaw<EntryRow[]>`
        SELECT id, ${Prisma.raw(config.lastModified)} AS last_modified
        FROM ${Prisma.raw(config.table)}
        ORDER BY ${Prisma.raw(config.orderBy)}
        OFFSET ${safeChunk * chunkSize}::bigint
        LIMIT ${chunkSize}::bigint
      `;
    } catch (error) {
      this.logUnavailable(type, error);
    }

    return {
      type,
      chunk: safeChunk,
      chunkSize,
      entries: rows.map(
        (row): SitemapEntryDto => ({
          id: row.id,
          lastModified: toIso(row.last_modified),
        }),
      ),
    };
  }

  private async section(
    type: SitemapEntityType,
    chunkSize: number,
  ): Promise<SitemapSectionDto> {
    const config = SITEMAP_ENTITIES[type];

    let rows: ChunkRow[] = [];
    try {
      // One pass per table: number the rows in the same total order the entries
      // endpoint pages through, bucket them by chunk, and roll up the newest
      // timestamp per bucket. That makes the index's <lastmod> per child
      // sitemap exact rather than a whole-table approximation.
      rows = await this.prisma.$queryRaw<ChunkRow[]>`
        SELECT chunk::int AS chunk,
               COUNT(*)::int AS count,
               MAX(last_modified) AS last_modified
        FROM (
          SELECT ${Prisma.raw(config.lastModified)} AS last_modified,
                 (ROW_NUMBER() OVER (ORDER BY ${Prisma.raw(config.orderBy)}) - 1)
                   / ${chunkSize}::bigint AS chunk
          FROM ${Prisma.raw(config.table)}
        ) numbered
        GROUP BY chunk
        ORDER BY chunk
      `;
    } catch (error) {
      this.logUnavailable(type, error);
    }

    const chunks: SitemapChunkDto[] = rows.map((row) => ({
      index: row.chunk,
      count: row.count,
      lastModified: toIso(row.last_modified),
    }));

    const total = chunks.reduce((sum, chunk) => sum + chunk.count, 0);
    const lastModified = chunks.reduce<string | null>(
      (newest, chunk) =>
        chunk.lastModified !== null &&
        (newest === null || chunk.lastModified > newest)
          ? chunk.lastModified
          : newest,
      null,
    );

    return { type, total, lastModified, chunks };
  }

  /**
   * A tenant schema can legitimately lack a table (mid-provisioning, or an
   * older namespace awaiting `migrate deploy`). An empty section is the right
   * answer there — a sitemap that 500s takes the whole index down with it.
   */
  private logUnavailable(type: SitemapEntityType, error: unknown): void {
    this.logger.warn(
      `Sitemap section '${type}' unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  private cacheIndex(key: string, value: SitemapIndexDto): void {
    if (INDEX_CACHE_TTL_MS <= 0) return;
    // Insertion-ordered Map: the first key is the least recently written.
    if (this.indexCache.size >= INDEX_CACHE_MAX_ENTRIES) {
      const oldest = this.indexCache.keys().next();
      if (!oldest.done) this.indexCache.delete(oldest.value);
    }
    this.indexCache.set(key, {
      value,
      expiresAt: Date.now() + INDEX_CACHE_TTL_MS,
    });
  }
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
