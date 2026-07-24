import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  deployForSchema,
  ensureNamespaceRegistry,
  withDatabaseMigrationLock,
} from '../database-migrations';
import {
  RESERVED_PREFIXES,
  SLUG_RE,
  schemaForId,
  slugifyName,
} from '../namespace/namespace.constants';
import {
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from './namespace-registry.sql';
import type {
  CreateNamespaceInput,
  Namespace,
  NamespaceLifecycleEvent,
  NamespaceStats,
  UpdateNamespaceInput,
} from './namespace.types';

interface NamespaceRow {
  id: string;
  name: string;
  slug: string;
  schema_name: string;
  description: string | null;
  type: string;
  remote_url: string | null;
  has_thumbnail: boolean;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  last_opened_at: Date | null;
}

/**
 * Columns selected for a {@link Namespace} projection. Deliberately excludes the
 * potentially large `thumbnail_blob` (bytea) — its presence is surfaced as a
 * boolean and the bytes are streamed separately by the thumbnail endpoint.
 */
const NAMESPACE_COLUMNS = `
  id, name, slug, schema_name, description, type, remote_url,
  (thumbnail_blob IS NOT NULL) AS has_thumbnail,
  settings, created_at, updated_at, last_opened_at
`;

/** Max accepted decoded thumbnail size (2 MB). */
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

interface ResolveCacheEntry {
  context: NamespaceLifecycleEvent;
  expiresAt: number;
}

const RESOLVE_CACHE_TTL_MS = 5_000;

/** Canonical UUID (as used for the immutable, internal namespace address). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Source of truth for the list of namespaces (tenants).
 *
 * Owns a `public`-pinned pg pool, resolves slugs (cached) for the request
 * pipeline, and on create/delete provisions/tears down the tenant's Postgres
 * schema. Lifecycle events let the worker manager start/stop per-namespace
 * workers. This service never touches the CLS-scoped tenant Prisma client.
 */
@Injectable()
export class NamespaceRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NamespaceRegistryService.name);
  private readonly pool = new Pool({
    connectionString: publicConnectionString(),
    options: PUBLIC_SEARCH_PATH_OPTION,
    max: 4,
  });
  private readonly resolveCache = new Map<string, ResolveCacheEntry>();
  private readonly createdListeners = new Set<
    (e: NamespaceLifecycleEvent) => void | Promise<void>
  >();
  private readonly deletingListeners = new Set<
    (e: NamespaceLifecycleEvent) => void | Promise<void>
  >();

  async onModuleInit(): Promise<void> {
    // The pre-boot orchestrator normally created this already. The same
    // cross-process lock makes this fallback safe on fresh multi-replica boots.
    await ensureNamespaceRegistry();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  onCreated(fn: (e: NamespaceLifecycleEvent) => void | Promise<void>): void {
    this.createdListeners.add(fn);
  }

  onDeleting(fn: (e: NamespaceLifecycleEvent) => void | Promise<void>): void {
    this.deletingListeners.add(fn);
  }

  /**
   * Cached resolution used by the request pipeline. The leading path segment is
   * either the immutable namespace UUID (internal service-to-service calls) or
   * the editable slug (web app); both resolve to the same tenant.
   */
  async resolve(segment: string): Promise<NamespaceLifecycleEvent | null> {
    const hit = this.resolveCache.get(segment);
    if (hit && hit.expiresAt > Date.now()) return hit.context;
    if (hit) this.resolveCache.delete(segment);
    const byId = UUID_RE.test(segment);
    const { rows } = await this.pool.query<NamespaceRow>(
      `SELECT id, slug, schema_name FROM namespaces
         WHERE ${byId ? 'id = $1' : 'slug = $1'}
           AND type = 'local' AND status = 'active'`,
      [segment],
    );
    const row = rows[0];
    if (!row) return null;
    const ctx: NamespaceLifecycleEvent = {
      namespaceId: row.id,
      slug: row.slug,
      schemaName: row.schema_name,
    };
    this.resolveCache.set(segment, {
      context: ctx,
      expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS,
    });
    return ctx;
  }

  async list(): Promise<Namespace[]> {
    const { rows } = await this.pool.query<NamespaceRow>(
      `SELECT ${NAMESPACE_COLUMNS} FROM namespaces
         WHERE status = 'active' ORDER BY created_at ASC`,
    );
    return rows.map((r) => this.toNamespace(r));
  }

  async get(id: string): Promise<Namespace> {
    const { rows } = await this.pool.query<NamespaceRow>(
      `SELECT ${NAMESPACE_COLUMNS} FROM namespaces
         WHERE id = $1 AND status = 'active'`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException(`Unknown namespace '${id}'`);
    return this.toNamespace(rows[0]);
  }

  /**
   * Per-namespace source rollups for the workspace directory cards. One
   * schema-qualified aggregate per active local namespace (few namespaces on the
   * landing page); a provisioning/missing schema degrades to zeroes.
   */
  async stats(): Promise<NamespaceStats[]> {
    const namespaces = await this.list();
    const local = namespaces.filter((ns) => ns.type === 'local');
    return Promise.all(
      local.map(async (ns) => {
        try {
          const { rows } = await this.pool.query<{
            total: number;
            failing: number;
          }>(
            `SELECT
               count(*)::int AS total,
               count(*) FILTER (WHERE runner_status = 'ERROR')::int AS failing
             FROM "${ns.schemaName}".sources`,
          );
          return {
            id: ns.id,
            totalSources: rows[0]?.total ?? 0,
            failingSources: rows[0]?.failing ?? 0,
          };
        } catch {
          return { id: ns.id, totalSources: 0, failingSources: 0 };
        }
      }),
    );
  }

  /** Raw thumbnail bytes for the streaming endpoint, or null when unset. */
  async getThumbnail(
    id: string,
  ): Promise<{ blob: Buffer; mime: string } | null> {
    const { rows } = await this.pool.query<{
      thumbnail_blob: Buffer | null;
      thumbnail_mime: string | null;
    }>(
      "SELECT thumbnail_blob, thumbnail_mime FROM namespaces WHERE id = $1 AND status = 'active'",
      [id],
    );
    const row = rows[0];
    if (!row?.thumbnail_blob) return null;
    return {
      blob: row.thumbnail_blob,
      mime: row.thumbnail_mime || 'application/octet-stream',
    };
  }

  async create(input: CreateNamespaceInput): Promise<Namespace> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Namespace name is required');

    const slug = (input.slug ?? slugifyName(name)).toLowerCase();
    if (!SLUG_RE.test(slug)) {
      throw new BadRequestException(
        `Invalid namespace slug '${slug}' (use lowercase letters, digits and dashes)`,
      );
    }
    if (RESERVED_PREFIXES.has(slug)) {
      throw new BadRequestException(
        `Namespace slug '${slug}' is reserved by the application`,
      );
    }

    const type = input.type ?? 'local';
    if (type !== 'local' && type !== 'remote') {
      throw new BadRequestException(
        "Namespace type must be either 'local' or 'remote'",
      );
    }
    if (type === 'remote' && !input.remoteUrl) {
      throw new BadRequestException('Remote namespaces require a remoteUrl');
    }
    if (type === 'remote') validateRemoteUrl(input.remoteUrl as string);

    const id = randomUUID();
    // Schema names derive from the immutable UUID, never the slug, so a slug can
    // be edited later without renaming (or breaking access to) any schema.
    const schemaName = schemaForId(id);
    const thumbnail = parseThumbnailDataUri(input.thumbnail);

    try {
      const { rows } = await this.pool.query<NamespaceRow>(
        `INSERT INTO namespaces
           (id, name, slug, schema_name, description, type, remote_url, status, thumbnail_blob, thumbnail_mime)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${NAMESPACE_COLUMNS}`,
        [
          id,
          name,
          slug,
          schemaName,
          input.description ?? null,
          type,
          input.remoteUrl ?? null,
          type === 'local' ? 'provisioning' : 'active',
          thumbnail?.blob ?? null,
          thumbnail?.mime ?? null,
        ],
      );
      let namespace = this.toNamespace(rows[0]);

      // Remote namespaces have no local schema/data — they point at another
      // Classifyre instance — so skip provisioning entirely.
      if (type === 'local') {
        try {
          await withDatabaseMigrationLock(async () => {
            await this.pool.query(
              `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`,
            );
            await deployForSchema(schemaName);
            const activated = await this.pool.query<NamespaceRow>(
              `UPDATE namespaces SET status = 'active', updated_at = now()
                 WHERE id = $1 RETURNING ${NAMESPACE_COLUMNS}`,
              [id],
            );
            namespace = this.toNamespace(activated.rows[0]);
          });
        } catch (provisionError) {
          // Roll back a half-provisioned namespace so it never appears in the
          // list or gets workers started for an incomplete schema.
          this.logger.error(
            `Provisioning namespace '${slug}' failed; rolling back: ${String(
              provisionError,
            )}`,
          );
          await this.pool
            .query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
            .catch(() => undefined);
          await this.pool
            .query('DELETE FROM namespaces WHERE id = $1', [id])
            .catch(() => undefined);
          throw provisionError;
        }
      }

      const ctx: NamespaceLifecycleEvent = {
        namespaceId: id,
        slug,
        schemaName,
      };
      if (type === 'local') {
        this.resolveCache.set(slug, {
          context: ctx,
          expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS,
        });
        await this.notify(this.createdListeners, ctx, 'create');
      }
      this.logger.log(`Created namespace '${slug}' (schema ${schemaName})`);
      return namespace;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `A namespace with slug '${slug}' already exists`,
        );
      }
      throw error;
    }
  }

  async update(id: string, patch: UpdateNamespaceInput): Promise<Namespace> {
    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (col: string, val: unknown) => {
      values.push(val);
      sets.push(`${col} = $${values.length}`);
    };
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('Namespace name is required');
      push('name', name);
    }
    if (patch.slug !== undefined) {
      const slug = patch.slug.trim().toLowerCase();
      if (!SLUG_RE.test(slug)) {
        throw new BadRequestException(
          `Invalid namespace slug '${slug}' (use lowercase letters, digits and dashes)`,
        );
      }
      if (RESERVED_PREFIXES.has(slug)) {
        throw new BadRequestException(
          `Namespace slug '${slug}' is reserved by the application`,
        );
      }
      push('slug', slug);
    }
    if (patch.description !== undefined) push('description', patch.description);
    if (patch.remoteUrl !== undefined) {
      validateRemoteUrl(patch.remoteUrl);
      push('remote_url', patch.remoteUrl);
    }
    if (patch.thumbnail !== undefined) {
      // `null`/empty clears the image; a data URI replaces it.
      const thumbnail = parseThumbnailDataUri(patch.thumbnail);
      push('thumbnail_blob', thumbnail?.blob ?? null);
      push('thumbnail_mime', thumbnail?.mime ?? null);
    }
    if (patch.settings !== undefined)
      push('settings', JSON.stringify(patch.settings));
    if (patch.lastOpenedAt !== undefined)
      push('last_opened_at', patch.lastOpenedAt);

    if (sets.length === 0) return this.get(id);
    // Capture the current slug so its (now stale) resolve-cache entry is dropped
    // even when the slug itself is being changed.
    const previousSlug = (await this.get(id)).slug;
    sets.push('updated_at = now()');
    values.push(id);

    let rows: NamespaceRow[];
    try {
      ({ rows } = await this.pool.query<NamespaceRow>(
        `UPDATE namespaces SET ${sets.join(', ')}
           WHERE id = $${values.length} RETURNING ${NAMESPACE_COLUMNS}`,
        values,
      ));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `A namespace with slug '${patch.slug}' already exists`,
        );
      }
      throw error;
    }
    if (!rows[0]) throw new NotFoundException(`Unknown namespace '${id}'`);
    const namespace = this.toNamespace(rows[0]);
    this.resolveCache.delete(previousSlug);
    this.resolveCache.delete(namespace.slug);
    this.resolveCache.delete(namespace.id);
    return namespace;
  }

  /**
   * Soft-delete a namespace: mark it `deleted` so it disappears from listings
   * and can no longer be resolved (any request to its URL 404s), then stop its
   * workers, pg-boss instance and scheduling. The tenant's Postgres schema and
   * all its data are intentionally RETAINED — nothing is dropped — and the slug
   * stays reserved so it cannot be silently reused.
   */
  async remove(id: string): Promise<void> {
    const namespace = await this.get(id);
    const ctx: NamespaceLifecycleEvent = {
      namespaceId: namespace.id,
      slug: namespace.slug,
      schemaName: namespace.schemaName,
    };
    // Flip to `deleted` first so `resolve()`/`list()` (which filter on
    // status = 'active') immediately stop serving it, then let workers tear
    // down (stop pg-boss polling + scheduling, unpin the Prisma client).
    this.resolveCache.delete(namespace.slug);
    this.resolveCache.delete(namespace.id);
    await this.pool.query(
      "UPDATE namespaces SET status = 'deleted', updated_at = now() WHERE id = $1",
      [id],
    );
    await this.notify(this.deletingListeners, ctx, 'delete');
    this.logger.log(
      `Soft-deleted namespace '${namespace.slug}' (data retained)`,
    );
  }

  private async notify(
    listeners: Set<(e: NamespaceLifecycleEvent) => void | Promise<void>>,
    ctx: NamespaceLifecycleEvent,
    action: string,
  ): Promise<void> {
    const results = await Promise.allSettled(
      [...listeners].map((listener) =>
        Promise.resolve().then(() => listener(ctx)),
      ),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(
          `Namespace ${action} lifecycle hook failed for '${ctx.slug}': ${String(result.reason)}`,
        );
      }
    }
  }

  private toNamespace(row: NamespaceRow): Namespace {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      schemaName: row.schema_name,
      description: row.description,
      type: row.type === 'remote' ? 'remote' : 'local',
      remoteUrl: row.remote_url,
      // A relative path to the streaming endpoint (cache-busted by updated_at);
      // the web api-client resolves it to an absolute URL. Null when unset.
      thumbnail: row.has_thumbnail
        ? `/namespaces/${row.id}/thumbnail?v=${row.updated_at.getTime()}`
        : null,
      settings: row.settings ?? {},
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      lastOpenedAt: row.last_opened_at
        ? row.last_opened_at.toISOString()
        : null,
    };
  }
}

/**
 * Decode a `data:image/...;base64,...` thumbnail into its bytes + MIME type.
 * `undefined`/`null`/empty means "no image" (clear on update); anything else is
 * validated as an image data URI within {@link MAX_THUMBNAIL_BYTES}.
 */
function parseThumbnailDataUri(
  value: string | null | undefined,
): { blob: Buffer; mime: string } | null {
  if (value === undefined || value === null || value === '') return null;
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value.trim());
  if (!match) {
    throw new BadRequestException(
      'Thumbnail must be a base64 image data URI (data:image/...;base64,...)',
    );
  }
  const [, mime, base64] = match;
  const blob = Buffer.from(base64, 'base64');
  if (blob.length === 0) {
    throw new BadRequestException('Thumbnail image is empty');
  }
  if (blob.length > MAX_THUMBNAIL_BYTES) {
    throw new BadRequestException('Thumbnail image must be 2 MB or smaller');
  }
  return { blob, mime: mime.toLowerCase() };
}

function validateRemoteUrl(value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new Error();
  } catch {
    throw new BadRequestException('remoteUrl must be an absolute HTTP(S) URL');
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}
