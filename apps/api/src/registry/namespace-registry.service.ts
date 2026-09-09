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
  isReservedSlug,
  pgBossSchemaForId,
  SLUG_RE,
  schemaForId,
  slugifyName,
} from '../namespace/namespace.constants';
import {
  DEFAULT_CATEGORY_ID,
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from './namespace-registry.sql';
import { withDbRetry } from '../db/db-retry';
import { isTransientDbError } from '../db/transient-db-error';
import type {
  CreateNamespaceCategoryInput,
  CreateNamespaceInput,
  Namespace,
  NamespaceCategory,
  NamespaceExternalLink,
  NamespaceExternalLinkInput,
  NamespaceLifecycleEvent,
  NamespaceStats,
  UpdateNamespaceCategoryInput,
  UpdateNamespaceInput,
} from './namespace.types';

interface NamespaceRow {
  id: string;
  name: string;
  slug: string;
  schema_name: string;
  description: string | null;
  has_thumbnail: boolean;
  settings: Record<string, unknown>;
  external_links: NamespaceExternalLink[] | null;
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
  id, name, slug, schema_name, description,
  (thumbnail_blob IS NOT NULL) AS has_thumbnail,
  settings, external_links, created_at, updated_at, last_opened_at
`;

/** Max accepted decoded thumbnail size (2 MB). */
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

/** Caps on the per-workspace link list, so a card stays a card. */
const MAX_EXTERNAL_LINKS = 20;
const MAX_LINK_TITLE_LENGTH = 80;
const MAX_LINK_URL_LENGTH = 2048;
const MAX_CATEGORY_TITLE_LENGTH = 60;

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

    const byId = UUID_RE.test(segment);
    let rows: NamespaceRow[];
    try {
      // Every request on a page passes through here, so a momentary registry
      // hiccup would otherwise fail the whole view at once.
      ({ rows } = await withDbRetry(
        () =>
          this.pool.query<NamespaceRow>(
            `SELECT id, slug, schema_name FROM namespaces
               WHERE ${byId ? 'id = $1' : 'slug = $1'}
                 AND status = 'active'`,
            [segment],
          ),
        { label: `namespace resolve '${segment}'` },
      ));
    } catch (error) {
      // A stale entry is deliberately kept until a query replaces it: the
      // slug → schema mapping barely ever changes, so serving it beats failing
      // the request while the database is briefly unreachable. Invalidation on
      // rename/delete is explicit (`resolveCache.delete`), not TTL-driven.
      if (hit && isTransientDbError(error)) {
        this.logger.warn(
          `Registry unavailable while resolving '${segment}'; serving cached namespace: ${String(error)}`,
        );
        return hit.context;
      }
      this.resolveCache.delete(segment);
      throw error;
    }

    const row = rows[0];
    if (!row) {
      // Renamed or deleted: drop the entry the stale-serving path above keeps.
      this.resolveCache.delete(segment);
      return null;
    }
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
    // One extra round trip for every workspace's categories rather than N, and
    // no join — the projection above is already wide and a join would multiply
    // the (thumbnail-free but still chunky) namespace rows per category.
    const categories = await this.categoriesByNamespace(rows.map((r) => r.id));
    return rows.map((r) => this.toNamespace(r, categories.get(r.id) ?? []));
  }

  async get(id: string): Promise<Namespace> {
    const { rows } = await this.pool.query<NamespaceRow>(
      `SELECT ${NAMESPACE_COLUMNS} FROM namespaces
         WHERE id = $1 AND status = 'active'`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException(`Unknown namespace '${id}'`);
    return this.toNamespace(rows[0], await this.categoryIdsFor(id));
  }

  /** Category ids per namespace id, in stable (title) order. */
  private async categoriesByNamespace(
    ids: string[],
  ): Promise<Map<string, string[]>> {
    const byNamespace = new Map<string, string[]>();
    if (ids.length === 0) return byNamespace;
    const { rows } = await this.pool.query<{
      namespace_id: string;
      category_id: string;
    }>(
      `SELECT m.namespace_id, m.category_id
         FROM namespace_category_members m
         JOIN namespace_categories c ON c.id = m.category_id
        WHERE m.namespace_id = ANY($1::uuid[])
        ORDER BY lower(c.title) ASC`,
      [ids],
    );
    for (const row of rows) {
      const current = byNamespace.get(row.namespace_id);
      if (current) current.push(row.category_id);
      else byNamespace.set(row.namespace_id, [row.category_id]);
    }
    return byNamespace;
  }

  private async categoryIdsFor(id: string): Promise<string[]> {
    return (await this.categoriesByNamespace([id])).get(id) ?? [];
  }

  /**
   * Replace a workspace's categories.
   *
   * An empty (or unknown-only) set is not rejected: it resolves to the default
   * category, because "a workspace is always in a category" is the invariant the
   * grouped directory relies on — a workspace with none would simply vanish
   * from the listing.
   */
  private async setCategories(
    namespaceId: string,
    requested: string[],
  ): Promise<void> {
    const unique = [
      ...new Set(requested.map((id) => id.trim()).filter(Boolean)),
    ];
    let valid: string[] = [];
    if (unique.length > 0) {
      const { rows } = await this.pool.query<{ id: string }>(
        'SELECT id FROM namespace_categories WHERE id = ANY($1::uuid[])',
        [unique],
      );
      valid = rows.map((row) => row.id);
      const unknown = unique.filter((id) => !valid.includes(id));
      if (unknown.length > 0) {
        throw new BadRequestException(
          `Unknown workspace ${unknown.length === 1 ? 'category' : 'categories'}: ${unknown.join(', ')}`,
        );
      }
    }
    if (valid.length === 0) valid = [DEFAULT_CATEGORY_ID];

    await this.pool.query(
      `DELETE FROM namespace_category_members
        WHERE namespace_id = $1 AND category_id <> ALL($2::uuid[])`,
      [namespaceId, valid],
    );
    await this.pool.query(
      `INSERT INTO namespace_category_members (namespace_id, category_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT DO NOTHING`,
      [namespaceId, valid],
    );
  }

  /**
   * Per-namespace source rollups for the workspace directory cards. One
   * schema-qualified aggregate per active local namespace (few namespaces on the
   * landing page); a provisioning/missing schema degrades to zeroes.
   */
  async stats(): Promise<NamespaceStats[]> {
    const namespaces = await this.list();
    return Promise.all(
      namespaces.map(async (ns) => {
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

  /**
   * Rows in `status` across every active local tenant, for deployment-wide caps.
   *
   * Anything counted through `PrismaService` is answered by a schema-scoped
   * client, so a "global" limit expressed that way is silently per-namespace and
   * the real ceiling is the limit times the number of workspaces. That is how
   * MAX_CONCURRENT_RUNNERS came to allow 8 concurrent scans on a box configured
   * for 2. Contention is for one machine's cores and memory, so the count has to
   * span schemas the way the contention does.
   *
   * One UNION ALL over a handful of schemas, on the shared public pool. A schema
   * that is mid-provision or mid-drop contributes nothing rather than failing the
   * query -- the caller is deciding whether to start more work, and a transient
   * registry hiccup should not read as "the deployment is idle".
   */
  async countRowsAcrossNamespaces(
    table: 'runners',
    where: string,
  ): Promise<number> {
    const namespaces = await this.list();
    if (namespaces.length === 0) return 0;
    const counts = await Promise.all(
      namespaces.map(async (ns) => {
        try {
          const { rows } = await this.pool.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM "${ns.schemaName}"."${table}" WHERE ${where}`,
          );
          return rows[0]?.count ?? 0;
        } catch (error) {
          this.logger.warn(
            `Cross-namespace count on "${ns.schemaName}"."${table}" failed, treating as 0: ${String(error)}`,
          );
          return 0;
        }
      }),
    );
    return counts.reduce((sum, n) => sum + n, 0);
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
    if (isReservedSlug(slug)) {
      throw new BadRequestException(
        `Namespace slug '${slug}' is reserved by the application`,
      );
    }

    const id = randomUUID();
    // Schema names derive from the immutable UUID, never the slug, so a slug can
    // be edited later without renaming (or breaking access to) any schema.
    const schemaName = schemaForId(id);
    const thumbnail = parseThumbnailDataUri(input.thumbnail);
    const externalLinks = normalizeExternalLinks(input.externalLinks);

    try {
      const { rows } = await this.pool.query<NamespaceRow>(
        `INSERT INTO namespaces
           (id, name, slug, schema_name, description, status, thumbnail_blob, thumbnail_mime, external_links)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${NAMESPACE_COLUMNS}`,
        [
          id,
          name,
          slug,
          schemaName,
          input.description ?? null,
          'provisioning',
          thumbnail?.blob ?? null,
          thumbnail?.mime ?? null,
          JSON.stringify(externalLinks),
        ],
      );
      // Filed before anything else can fail: a workspace row that exists but is
      // in no category would be invisible in the grouped directory.
      await this.setCategories(id, input.categoryIds ?? []);
      const categoryIds = await this.categoryIdsFor(id);
      let namespace = this.toNamespace(rows[0], categoryIds);

      try {
        await withDatabaseMigrationLock(async () => {
          await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
          await deployForSchema(schemaName);
          const activated = await this.pool.query<NamespaceRow>(
            `UPDATE namespaces SET status = 'active', updated_at = now()
               WHERE id = $1 RETURNING ${NAMESPACE_COLUMNS}`,
            [id],
          );
          namespace = this.toNamespace(activated.rows[0], categoryIds);
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

      const ctx: NamespaceLifecycleEvent = {
        namespaceId: id,
        slug,
        schemaName,
      };
      this.resolveCache.set(slug, {
        context: ctx,
        expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS,
      });
      await this.notify(this.createdListeners, ctx, 'create');
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
      if (isReservedSlug(slug)) {
        throw new BadRequestException(
          `Namespace slug '${slug}' is reserved by the application`,
        );
      }
      push('slug', slug);
    }
    if (patch.description !== undefined) push('description', patch.description);
    if (patch.thumbnail !== undefined) {
      // `null`/empty clears the image; a data URI replaces it.
      const thumbnail = parseThumbnailDataUri(patch.thumbnail);
      push('thumbnail_blob', thumbnail?.blob ?? null);
      push('thumbnail_mime', thumbnail?.mime ?? null);
    }
    if (patch.externalLinks !== undefined) {
      push(
        'external_links',
        JSON.stringify(normalizeExternalLinks(patch.externalLinks)),
      );
    }
    if (patch.settings !== undefined)
      push('settings', JSON.stringify(patch.settings));
    if (patch.lastOpenedAt !== undefined)
      push('last_opened_at', patch.lastOpenedAt);

    if (patch.categoryIds !== undefined) {
      // Validated against the registry (404s on an unknown id) before the row
      // update, so a bad category never half-applies a rename.
      await this.get(id);
      await this.setCategories(id, patch.categoryIds);
    }
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
    const namespace = this.toNamespace(rows[0], await this.categoryIdsFor(id));
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
      `UPDATE namespaces
         SET status = 'deleted', updated_at = now(), deleted_at = now()
       WHERE id = $1`,
      [id],
    );
    await this.notify(this.deletingListeners, ctx, 'delete');
    this.logger.log(
      `Soft-deleted namespace '${namespace.slug}' (data retained)`,
    );
  }

  /**
   * Workspaces soft-deleted longer ago than `retentionMs` and therefore due to
   * be dropped for good.
   *
   * Remote namespaces are included: they own no schema, but their registry row
   * should not outlive the retention window either.
   */
  async listExpiredDeleted(retentionMs: number): Promise<
    Array<{
      id: string;
      slug: string;
      schemaName: string;
      deletedAt: Date;
    }>
  > {
    const cutoff = new Date(Date.now() - retentionMs);
    const { rows } = await this.pool.query<{
      id: string;
      slug: string;
      schema_name: string;
      deleted_at: Date;
    }>(
      `SELECT id, slug, schema_name, deleted_at
         FROM namespaces
        WHERE status = 'deleted'
          AND deleted_at IS NOT NULL
          AND deleted_at < $1
        ORDER BY deleted_at ASC`,
      [cutoff],
    );
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      schemaName: row.schema_name,
      deletedAt: row.deleted_at,
    }));
  }

  /**
   * Irreversibly drop a soft-deleted workspace: its tenant schema, its pg-boss
   * job schema, and its registry row.
   *
   * Re-checks the `deleted` status inside the delete so a workspace that was
   * restored between listing and purging is never dropped — the read and the
   * write are separated by two schema drops, which is ample time for that to
   * happen.
   */
  async purgeDeleted(id: string): Promise<boolean> {
    const { rows } = await this.pool.query<{
      slug: string;
      schema_name: string;
    }>(
      `SELECT slug, schema_name FROM namespaces
        WHERE id = $1 AND status = 'deleted'`,
      [id],
    );
    const row = rows[0];
    if (!row) return false;

    // CASCADE because the schema owns its own tables and nothing outside it
    // references them; the registry row is the only external pointer and it
    // goes below.
    await this.pool.query(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`);
    await this.pool.query(
      `DROP SCHEMA IF EXISTS "${pgBossSchemaForId(id)}" CASCADE`,
    );

    const deleted = await this.pool.query(
      "DELETE FROM namespaces WHERE id = $1 AND status = 'deleted'",
      [id],
    );
    if (deleted.rowCount === 0) return false;

    this.resolveCache.delete(row.slug);
    this.resolveCache.delete(id);
    this.logger.warn(
      `Purged soft-deleted workspace '${row.slug}' — schema "${row.schema_name}" and all its data are gone.`,
    );
    return true;
  }

  // ---------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------

  /**
   * Every category, alphabetically, with the number of ACTIVE workspaces filed
   * under it (soft-deleted workspaces keep their memberships but must not be
   * counted — the directory does not show them either).
   */
  async listCategories(): Promise<NamespaceCategory[]> {
    const { rows } = await this.pool.query<{
      id: string;
      title: string;
      description: string | null;
      created_at: Date;
      updated_at: Date;
      workspace_count: number;
    }>(
      `SELECT c.id, c.title, c.description, c.created_at, c.updated_at,
              count(n.id)::int AS workspace_count
         FROM namespace_categories c
         LEFT JOIN namespace_category_members m ON m.category_id = c.id
         LEFT JOIN namespaces n
                ON n.id = m.namespace_id AND n.status = 'active'
        GROUP BY c.id
        ORDER BY lower(c.title) ASC`,
    );
    return rows.map((row) => toCategory(row));
  }

  async getCategory(id: string): Promise<NamespaceCategory> {
    const category = (await this.listCategories()).find((c) => c.id === id);
    if (!category) throw new NotFoundException(`Unknown category '${id}'`);
    return category;
  }

  async createCategory(
    input: CreateNamespaceCategoryInput,
  ): Promise<NamespaceCategory> {
    const title = normalizeCategoryTitle(input.title);
    try {
      const { rows } = await this.pool.query<{ id: string }>(
        `INSERT INTO namespace_categories (id, title, description)
         VALUES ($1, $2, $3) RETURNING id`,
        [randomUUID(), title, input.description?.trim() || null],
      );
      return this.getCategory(rows[0].id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `A category named '${title}' already exists`,
        );
      }
      throw error;
    }
  }

  async updateCategory(
    id: string,
    patch: UpdateNamespaceCategoryInput,
  ): Promise<NamespaceCategory> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (patch.title !== undefined) {
      values.push(normalizeCategoryTitle(patch.title));
      sets.push(`title = $${values.length}`);
    }
    if (patch.description !== undefined) {
      values.push(patch.description?.trim() || null);
      sets.push(`description = $${values.length}`);
    }
    if (sets.length === 0) return this.getCategory(id);
    sets.push('updated_at = now()');
    values.push(id);

    let rowCount: number | null;
    try {
      ({ rowCount } = await this.pool.query(
        `UPDATE namespace_categories SET ${sets.join(', ')}
          WHERE id = $${values.length}`,
        values,
      ));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `A category named '${patch.title}' already exists`,
        );
      }
      throw error;
    }
    if (!rowCount) throw new NotFoundException(`Unknown category '${id}'`);
    return this.getCategory(id);
  }

  /**
   * Delete a category. Workspaces are never deleted with it: any workspace left
   * with no category afterwards is re-filed under the default one, which is why
   * the default category itself cannot be deleted (it is the fallback).
   */
  async removeCategory(id: string): Promise<void> {
    if (id === DEFAULT_CATEGORY_ID) {
      throw new BadRequestException(
        'The default category cannot be deleted; workspaces without a category fall back to it.',
      );
    }
    const { rowCount } = await this.pool.query(
      'DELETE FROM namespace_categories WHERE id = $1',
      [id],
    );
    if (!rowCount) throw new NotFoundException(`Unknown category '${id}'`);
    // The membership rows went with it (ON DELETE CASCADE); re-home whatever
    // that emptied out.
    await this.pool.query(
      `INSERT INTO namespace_category_members (namespace_id, category_id)
       SELECT n.id, $1 FROM namespaces n
        WHERE NOT EXISTS (
          SELECT 1 FROM namespace_category_members m WHERE m.namespace_id = n.id
        )
       ON CONFLICT DO NOTHING`,
      [DEFAULT_CATEGORY_ID],
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

  private toNamespace(row: NamespaceRow, categoryIds: string[]): Namespace {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      schemaName: row.schema_name,
      description: row.description,
      // A relative path to the streaming endpoint (cache-busted by updated_at);
      // the web api-client resolves it to an absolute URL. Null when unset.
      thumbnail: row.has_thumbnail
        ? `/namespaces/${row.id}/thumbnail?v=${row.updated_at.getTime()}`
        : null,
      settings: row.settings ?? {},
      externalLinks: Array.isArray(row.external_links)
        ? row.external_links
        : [],
      categoryIds,
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

function toCategory(row: {
  id: string;
  title: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  workspace_count: number;
}): NamespaceCategory {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    workspaceCount: row.workspace_count ?? 0,
    isDefault: row.id === DEFAULT_CATEGORY_ID,
  };
}

function normalizeCategoryTitle(value: string): string {
  const title = (value ?? '').trim();
  if (!title) throw new BadRequestException('Category title is required');
  if (title.length > MAX_CATEGORY_TITLE_LENGTH) {
    throw new BadRequestException(
      `Category title must be ${MAX_CATEGORY_TITLE_LENGTH} characters or fewer`,
    );
  }
  return title;
}

/**
 * Validate and normalise the external-link array stored on a workspace.
 *
 * Both fields are mandatory and the URL must be absolute HTTP(S): these links
 * are rendered as `target="_blank"` anchors on the workspace card, so a
 * `javascript:` or relative value would be a hole, not a convenience.
 */
function normalizeExternalLinks(
  links: NamespaceExternalLinkInput[] | undefined,
): NamespaceExternalLink[] {
  if (!links) return [];
  if (!Array.isArray(links)) {
    throw new BadRequestException('externalLinks must be an array');
  }
  if (links.length > MAX_EXTERNAL_LINKS) {
    throw new BadRequestException(
      `A workspace can have at most ${MAX_EXTERNAL_LINKS} links`,
    );
  }
  return links.map((link, index) => {
    const title = (link?.title ?? '').trim();
    const rawUrl = (link?.url ?? '').trim();
    if (!title) {
      throw new BadRequestException(`Link ${index + 1} is missing a name`);
    }
    if (title.length > MAX_LINK_TITLE_LENGTH) {
      throw new BadRequestException(
        `Link name must be ${MAX_LINK_TITLE_LENGTH} characters or fewer`,
      );
    }
    if (!rawUrl) {
      throw new BadRequestException(`Link '${title}' is missing a URL`);
    }
    if (rawUrl.length > MAX_LINK_URL_LENGTH) {
      throw new BadRequestException(`Link '${title}' has an over-long URL`);
    }
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException(
        `Link '${title}' must be an absolute URL (https://...)`,
      );
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException(
        `Link '${title}' must use http:// or https://`,
      );
    }
    return {
      id: UUID_RE.test(link.id ?? '') ? (link.id as string) : randomUUID(),
      title,
      url: url.toString(),
    };
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}
