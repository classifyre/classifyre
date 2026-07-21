import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { deployForSchema } from '../database-migrations';
import {
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
  private readonly resolveCache = new Map<string, NamespaceLifecycleEvent>();
  private readonly events = new EventEmitter();

  async onModuleInit(): Promise<void> {
    // Idempotent; the pre-boot orchestrator normally created this already.
    await this.pool.query(REGISTRY_TABLE_DDL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  onCreated(fn: (e: NamespaceLifecycleEvent) => void): void {
    this.events.on('created', fn);
  }

  onDeleting(fn: (e: NamespaceLifecycleEvent) => void): void {
    this.events.on('deleting', fn);
  }

  /** Cached slug → context resolution used by the request pipeline. */
  async resolve(slug: string): Promise<NamespaceLifecycleEvent | null> {
    const hit = this.resolveCache.get(slug);
    if (hit) return hit;
    const { rows } = await this.pool.query<NamespaceRow>(
      'SELECT id, slug, schema_name FROM namespaces WHERE slug = $1',
      [slug],
    );
    const row = rows[0];
    if (!row) return null;
    const ctx: NamespaceLifecycleEvent = {
      namespaceId: row.id,
      slug: row.slug,
      schemaName: row.schema_name,
    };
    this.resolveCache.set(slug, ctx);
    return ctx;
  }

  async list(): Promise<Namespace[]> {
    const { rows } = await this.pool.query<NamespaceRow>(
      'SELECT * FROM namespaces ORDER BY created_at ASC',
    );
    return rows.map((r) => this.toNamespace(r));
  }

  async get(id: string): Promise<Namespace> {
    const { rows } = await this.pool.query<NamespaceRow>(
      'SELECT * FROM namespaces WHERE id = $1',
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

    const type = input.type ?? 'local';
    if (type === 'remote' && !input.remoteUrl) {
      throw new BadRequestException('Remote namespaces require a remoteUrl');
    }

    const schemaName = schemaForSlug(slug);
    const id = randomUUID();

    try {
      const { rows } = await this.pool.query<NamespaceRow>(
        `INSERT INTO namespaces (id, name, slug, schema_name, description, type, remote_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          id,
          name,
          slug,
          schemaName,
          input.description ?? null,
          type,
          input.remoteUrl ?? null,
        ],
      );
      const namespace = this.toNamespace(rows[0]);

      // Remote namespaces have no local schema/data — they point at another
      // Classifyre instance — so skip provisioning entirely.
      if (type === 'local') {
        try {
          await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
          await deployForSchema(schemaName);
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
      this.resolveCache.set(slug, ctx);
      this.events.emit('created', ctx);
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
    if (patch.name !== undefined) push('name', patch.name);
    if (patch.description !== undefined) push('description', patch.description);
    if (patch.remoteUrl !== undefined) push('remote_url', patch.remoteUrl);
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
    this.events.emit('deleting', ctx);

    if (namespace.type === 'local') {
      await this.pool.query(
        `DROP SCHEMA IF EXISTS "${namespace.schemaName}" CASCADE`,
      );
      await this.pool.query(
        `DROP SCHEMA IF EXISTS "${pgBossSchemaForSlug(namespace.slug)}" CASCADE`,
      );
    }
    await this.pool.query('DELETE FROM namespaces WHERE id = $1', [id]);
    this.resolveCache.delete(namespace.slug);
    this.logger.log(`Removed namespace '${namespace.slug}'`);
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
      lastOpenedAt: row.last_opened_at ? row.last_opened_at.toISOString() : null,
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}
