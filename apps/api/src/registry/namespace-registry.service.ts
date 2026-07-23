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
import { deployForSchema } from '../database-migrations';
import {
  RESERVED_PREFIXES,
  SLUG_RE,
  schemaForSlug,
  pgBossSchemaForSlug,
  slugifyName,
} from '../namespace/namespace.constants';
import {
  REGISTRY_TABLE_DDL,
  publicConnectionString,
  PUBLIC_SEARCH_PATH_OPTION,
} from './namespace-registry.sql';
import type {
  CreateNamespaceInput,
  Namespace,
  NamespaceLifecycleEvent,
  UpdateNamespaceInput,
} from './namespace.types';
import { serviceRole } from '../service-role';

interface NamespaceRow {
  id: string;
  name: string;
  slug: string;
  schema_name: string;
  description: string | null;
  type: string;
  remote_url: string | null;
  thumbnail: string | null;
  settings: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  last_opened_at: Date | null;
}

interface ResolveCacheEntry {
  context: NamespaceLifecycleEvent;
  expiresAt: number;
}

const RESOLVE_CACHE_TTL_MS = 5_000;

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
    // Idempotent; the pre-boot orchestrator normally created this already.
    await this.pool.query(REGISTRY_TABLE_DDL);
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

  /** Cached slug → context resolution used by the request pipeline. */
  async resolve(slug: string): Promise<NamespaceLifecycleEvent | null> {
    const hit = this.resolveCache.get(slug);
    if (hit && hit.expiresAt > Date.now()) return hit.context;
    if (hit) this.resolveCache.delete(slug);
    const { rows } = await this.pool.query<NamespaceRow>(
      "SELECT id, slug, schema_name FROM namespaces WHERE slug = $1 AND type = 'local' AND status = 'active'",
      [slug],
    );
    const row = rows[0];
    if (!row) return null;
    const ctx: NamespaceLifecycleEvent = {
      namespaceId: row.id,
      slug: row.slug,
      schemaName: row.schema_name,
    };
    this.resolveCache.set(slug, {
      context: ctx,
      expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS,
    });
    return ctx;
  }

  async list(): Promise<Namespace[]> {
    const { rows } = await this.pool.query<NamespaceRow>(
      "SELECT * FROM namespaces WHERE status = 'active' ORDER BY created_at ASC",
    );
    return rows.map((r) => this.toNamespace(r));
  }

  async get(id: string): Promise<Namespace> {
    const { rows } = await this.pool.query<NamespaceRow>(
      "SELECT * FROM namespaces WHERE id = $1 AND status = 'active'",
      [id],
    );
    if (!rows[0]) throw new NotFoundException(`Unknown namespace '${id}'`);
    return this.toNamespace(rows[0]);
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

    const schemaName = schemaForSlug(slug);
    const id = randomUUID();

    try {
      const { rows } = await this.pool.query<NamespaceRow>(
        `INSERT INTO namespaces (id, name, slug, schema_name, description, type, remote_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          id,
          name,
          slug,
          schemaName,
          input.description ?? null,
          type,
          input.remoteUrl ?? null,
          type === 'local' ? 'provisioning' : 'active',
        ],
      );
      let namespace = this.toNamespace(rows[0]);

      // Remote namespaces have no local schema/data — they point at another
      // Classifyre instance — so skip provisioning entirely.
      if (type === 'local') {
        try {
          await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
          await deployForSchema(schemaName);
          const activated = await this.pool.query<NamespaceRow>(
            "UPDATE namespaces SET status = 'active', updated_at = now() WHERE id = $1 RETURNING *",
            [id],
          );
          namespace = this.toNamespace(activated.rows[0]);
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
    if (patch.description !== undefined) push('description', patch.description);
    if (patch.remoteUrl !== undefined) {
      validateRemoteUrl(patch.remoteUrl);
      push('remote_url', patch.remoteUrl);
    }
    if (patch.thumbnail !== undefined) push('thumbnail', patch.thumbnail);
    if (patch.settings !== undefined)
      push('settings', JSON.stringify(patch.settings));
    if (patch.lastOpenedAt !== undefined)
      push('last_opened_at', patch.lastOpenedAt);

    if (sets.length === 0) return this.get(id);
    sets.push('updated_at = now()');
    values.push(id);

    const { rows } = await this.pool.query<NamespaceRow>(
      `UPDATE namespaces SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    if (!rows[0]) throw new NotFoundException(`Unknown namespace '${id}'`);
    const namespace = this.toNamespace(rows[0]);
    this.resolveCache.delete(namespace.slug);
    return namespace;
  }

  async remove(id: string): Promise<void> {
    const namespace = await this.get(id);
    const ctx: NamespaceLifecycleEvent = {
      namespaceId: namespace.id,
      slug: namespace.slug,
      schemaName: namespace.schemaName,
    };
    // Let workers tear down (stop pg-boss, unpin Prisma client) before the
    // schemas disappear underneath them.
    // Await teardown: EventEmitter-style fire-and-forget races worker queries
    // against DROP SCHEMA and can leave pg-boss/Prisma pools alive afterward.
    this.resolveCache.delete(namespace.slug);
    await this.pool.query(
      "UPDATE namespaces SET status = 'deleting', updated_at = now() WHERE id = $1",
      [id],
    );
    await this.notify(this.deletingListeners, ctx, 'delete');

    // In production, HTTP and background workers run in separate pods, so the
    // in-process lifecycle hook above cannot reach the worker. Its 2s registry
    // reconciler sees the `deleting` state and tears down pg-boss/Prisma first.
    if (namespace.type === 'local' && serviceRole() === 'api') {
      const graceMs = Number(process.env.NAMESPACE_DELETE_GRACE_MS ?? 20_000);
      if (Number.isFinite(graceMs) && graceMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, graceMs));
      }
    }

    if (namespace.type === 'local') {
      await this.pool.query(
        `DROP SCHEMA IF EXISTS "${namespace.schemaName}" CASCADE`,
      );
      await this.pool.query(
        `DROP SCHEMA IF EXISTS "${pgBossSchemaForSlug(namespace.slug)}" CASCADE`,
      );
    }
    await this.pool.query('DELETE FROM namespaces WHERE id = $1', [id]);
    this.logger.log(`Removed namespace '${namespace.slug}'`);
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
      thumbnail: row.thumbnail,
      settings: row.settings ?? {},
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      lastOpenedAt: row.last_opened_at
        ? row.last_opened_at.toISOString()
        : null,
    };
  }
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
