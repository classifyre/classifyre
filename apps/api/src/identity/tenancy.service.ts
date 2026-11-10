import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import {
  PUBLIC_SEARCH_PATH_OPTION,
  publicConnectionString,
} from '../registry/namespace-registry.sql';
import type { RoleKey } from './roles';
import { dropTenantDatabase } from '../tenant-databases';

export type TenantStatus = 'active' | 'suspended' | 'deleted';

export interface Tenant {
  id: string;
  alias: string;
  name: string;
  orgId: string | null;
  status: TenantStatus;
}

interface TenantRow {
  id: string;
  alias: string;
  name: string;
  org_id: string | null;
  suspended_at: Date | null;
  deleted_at: Date | null;
}

const TENANT_COLUMNS = 'id, alias, name, org_id, suspended_at, deleted_at';

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    alias: row.alias,
    name: row.name,
    orgId: row.org_id,
    status: row.deleted_at
      ? 'deleted'
      : row.suspended_at
        ? 'suspended'
        : 'active',
  };
}

/** A tenant as the Platform page lists it: no workspace content, only counts. */
export interface TenantSummary extends Tenant {
  createdAt: Date;
  workspaces: number;
  lastActivityAt: Date | null;
  /** Its own database, once its first workspace made it (docs/prd/TEN §4.5). */
  databaseName: string | null;
  /** Why its last upgrade failed; its workspaces answer 503 until it works. */
  upgradeError: string | null;
}

export type GrantScopeType =
  | 'tenant'
  | 'group'
  | 'workspace'
  | 'source'
  | 'asset';

/** The scopes a grant on one resource inside a workspace uses (data access). */
export const RESOURCE_SCOPE_TYPES = ['source', 'asset'] as const;
export type ResourceScopeType = (typeof RESOURCE_SCOPE_TYPES)[number];

/** `<namespaceId>/<sourceId or assetId>`: the scope id of a resource grant. */
export function resourceScopeId(namespaceId: string, resourceId: string) {
  return `${namespaceId}/${resourceId}`;
}

/**
 * Scope a grant applies to: the whole tenant, a group's workspaces, one
 * workspace, or one source or table in a workspace (`<namespaceId>/<id>`).
 */
export interface GrantScope {
  scopeType: GrantScopeType;
  scopeId: string;
}

export interface Grant extends GrantScope {
  id: string;
  tenantId: string;
  subjectType: 'group';
  subjectId: string;
  roleKey: RoleKey;
  expiresAt: Date | null;
}

/**
 * Whether a workspace is read-only for everyone of its tenant (and for
 * visitors of the first tenant). `public` never opens a workspace to another
 * tenant: every capability check still answers null across tenants first.
 */
export type WorkspaceVisibility = 'private' | 'public';

export interface WorkspaceTenancy {
  tenantId: string;
  ownerGroupId: string | null;
  visibility: WorkspaceVisibility;
}

const TENANT_TTL_MS = 60_000;

/**
 * Tenants, grants and which tenant a workspace belongs to, in `public`
 * (identity/tenancy.sql.ts). Sign-in only reads grants here; nothing about a
 * person is stored.
 */
@Injectable()
export class TenancyService implements OnModuleDestroy {
  private readonly logger = new Logger(TenancyService.name);
  private readonly pool = new Pool({
    connectionString: publicConnectionString(),
    options: PUBLIC_SEARCH_PATH_OPTION,
    max: 2,
  });
  private readonly tenantsByAlias = new Map<
    string,
    { tenant: Tenant | null; expiresAt: number }
  >();

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async tenantByAlias(alias: string): Promise<Tenant | null> {
    const hit = this.tenantsByAlias.get(alias);
    if (hit && hit.expiresAt > Date.now()) return hit.tenant;
    const { rows } = await this.pool.query<TenantRow>(
      `SELECT ${TENANT_COLUMNS} FROM iam_tenants WHERE alias = $1`,
      [alias],
    );
    const tenant = rows[0] ? toTenant(rows[0]) : null;
    this.tenantsByAlias.set(alias, {
      tenant,
      expiresAt: Date.now() + TENANT_TTL_MS,
    });
    return tenant;
  }

  async tenantById(id: string): Promise<Tenant | null> {
    const { rows } = await this.pool.query<TenantRow>(
      `SELECT ${TENANT_COLUMNS} FROM iam_tenants WHERE id = $1`,
      [id],
    );
    return rows[0] ? toTenant(rows[0]) : null;
  }

  /** Every tenant, with what the Platform page shows. */
  async tenantSummaries(): Promise<TenantSummary[]> {
    const { rows } = await this.pool.query<
      TenantRow & {
        created_at: Date;
        workspaces: number;
        last_activity_at: Date | null;
        database_name: string | null;
        database_ready_at: Date | null;
        migration_error: string | null;
      }
    >(
      `SELECT t.id, t.alias, t.name, t.org_id, t.suspended_at, t.deleted_at, t.created_at,
              t.database_name, t.database_ready_at, t.migration_error,
              (SELECT count(*)::int FROM namespaces n
                WHERE n.tenant_id = t.id AND n.status <> 'deleted') AS workspaces,
              (SELECT max(e.occurred_at) FROM iam_audit_events e
                WHERE e.tenant_id = t.id) AS last_activity_at
         FROM iam_tenants t
        ORDER BY lower(t.name)`,
    );
    return rows.map((row) => ({
      ...toTenant(row),
      createdAt: row.created_at,
      workspaces: row.workspaces,
      lastActivityAt: row.last_activity_at,
      databaseName: row.database_ready_at ? row.database_name : null,
      upgradeError: row.migration_error,
    }));
  }

  /** Suspends (true) or resumes (false); false when nothing changed. */
  async setSuspended(tenantId: string, suspended: boolean): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      suspended
        ? `UPDATE iam_tenants SET suspended_at = now()
            WHERE id = $1 AND suspended_at IS NULL AND deleted_at IS NULL`
        : `UPDATE iam_tenants SET suspended_at = NULL
            WHERE id = $1 AND suspended_at IS NOT NULL AND deleted_at IS NULL`,
      [tenantId],
    );
    this.tenantsByAlias.clear();
    return Boolean(rowCount);
  }

  /**
   * Marks a tenant deleted, with its grants and the list of its workspaces
   * (their data goes with its database). Returns how many workspaces went.
   */
  async markDeleted(tenantId: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        `UPDATE iam_tenants SET deleted_at = now(), suspended_at = COALESCE(suspended_at, now())
          WHERE id = $1 AND deleted_at IS NULL`,
        [tenantId],
      );
      if (!rowCount) {
        await client.query('ROLLBACK');
        return 0;
      }
      await client.query('DELETE FROM iam_grants WHERE tenant_id = $1', [
        tenantId,
      ]);
      const removed = await client.query(
        'DELETE FROM namespaces WHERE tenant_id = $1',
        [tenantId],
      );
      await client.query('COMMIT');
      return removed.rowCount ?? 0;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
      this.tenantsByAlias.clear();
    }
  }

  /**
   * Drops a deleted tenant's database once no workspace of it is left, also
   * no soft-deleted one; the purge of the last one calls this too.
   */
  async dropDatabaseIfUnused(tenantId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM iam_tenants t
        WHERE t.id = $1 AND t.deleted_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM namespaces n WHERE n.tenant_id = t.id)`,
      [tenantId],
    );
    if (!rowCount) return false;
    await dropTenantDatabase(this.pool, tenantId);
    return true;
  }

  /** The tenant for an organization, created on first sight. */
  async ensureTenant(org: {
    id: string;
    alias: string;
    name: string;
  }): Promise<Tenant> {
    const existing = await this.tenantByAlias(org.alias);
    if (existing) return existing;
    await this.pool.query(
      `INSERT INTO iam_tenants (id, alias, name, org_id) VALUES ($1, $2, $3, $4)
         ON CONFLICT (alias) DO NOTHING`,
      [randomUUID(), org.alias, org.name, org.id],
    );
    this.tenantsByAlias.delete(org.alias);
    const tenant = await this.tenantByAlias(org.alias);
    if (!tenant) throw new Error(`Tenant ${org.alias} could not be created`);
    return tenant;
  }

  async workspaceTenancy(
    namespaceId: string,
  ): Promise<WorkspaceTenancy | null> {
    const { rows } = await this.pool.query<{
      tenant_id: string;
      owner_group_id: string | null;
      is_public: boolean;
    }>(
      `SELECT tenant_id, owner_group_id, is_public FROM namespaces WHERE id = $1`,
      [namespaceId],
    );
    return rows[0]
      ? {
          tenantId: rows[0].tenant_id,
          ownerGroupId: rows[0].owner_group_id,
          visibility: rows[0].is_public ? 'public' : 'private',
        }
      : null;
  }

  /** Every live grant in a tenant to one of these groups. */
  async grantsFor(
    tenantId: string,
    groupIds: Iterable<string>,
  ): Promise<Grant[]> {
    const { rows } = await this.pool.query<{
      id: string;
      tenant_id: string;
      subject_type: 'group';
      subject_id: string;
      role_key: RoleKey;
      scope_type: GrantScopeType;
      scope_id: string;
      expires_at: Date | null;
    }>(
      `SELECT id, tenant_id, subject_type, subject_id, role_key, scope_type, scope_id, expires_at
         FROM iam_grants
        WHERE tenant_id = $1
          AND (expires_at IS NULL OR expires_at > now())
          AND subject_type = 'group' AND subject_id = ANY($2::text[])`,
      [tenantId, [...groupIds]],
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      roleKey: row.role_key,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      expiresAt: row.expires_at,
    }));
  }

  async addGrant(
    grant: Omit<Grant, 'id' | 'expiresAt'> & {
      expiresAt?: Date | null;
      createdBy?: string;
    },
  ): Promise<string> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO iam_grants
         (id, tenant_id, subject_type, subject_id, role_key, scope_type, scope_id, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id, subject_type, subject_id, role_key, scope_type, scope_id) DO NOTHING`,
      [
        id,
        grant.tenantId,
        grant.subjectType,
        grant.subjectId,
        grant.roleKey,
        grant.scopeType,
        grant.scopeId,
        grant.expiresAt ?? null,
        grant.createdBy ?? null,
      ],
    );
    return id;
  }

  /** Every grant of a tenant, optionally only those on some scopes. */
  async listGrants(
    tenantId: string,
    scope?: { scopeType: GrantScopeType; scopeIds: string[] },
  ): Promise<(Grant & { createdBy: string | null; createdAt: Date })[]> {
    const { rows } = await this.pool.query<{
      id: string;
      tenant_id: string;
      subject_type: 'group';
      subject_id: string;
      role_key: RoleKey;
      scope_type: GrantScopeType;
      scope_id: string;
      expires_at: Date | null;
      created_by: string | null;
      created_at: Date;
    }>(
      `SELECT id, tenant_id, subject_type, subject_id, role_key, scope_type, scope_id,
              expires_at, created_by, created_at
         FROM iam_grants WHERE tenant_id = $1
         ${scope ? 'AND scope_type = $2 AND scope_id = ANY($3::text[])' : ''}
        ORDER BY created_at`,
      scope ? [tenantId, scope.scopeType, scope.scopeIds] : [tenantId],
    );
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      roleKey: row.role_key,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      expiresAt: row.expires_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }));
  }

  async grantById(tenantId: string, id: string): Promise<Grant | null> {
    const { rows } = await this.pool.query<{
      scope_type: GrantScopeType;
      scope_id: string;
    }>(
      `SELECT scope_type, scope_id FROM iam_grants WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (!rows[0]) return null;
    return (
      (
        await this.listGrants(tenantId, {
          scopeType: rows[0].scope_type,
          scopeIds: [rows[0].scope_id],
        })
      ).find((grant) => grant.id === id) ?? null
    );
  }

  async deleteGrant(tenantId: string, id: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM iam_grants WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
  }

  /** Tenant-level audit trail (grants, workspaces created or deleted). */
  async recordTenantEvent(
    tenantId: string,
    actor: string | undefined,
    action: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO iam_audit_events (id, tenant_id, actor, action, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), tenantId, actor ?? null, action, JSON.stringify(detail)],
    );
  }

  async tenantEvents(
    tenantId: string,
    query: {
      action?: string;
      actor?: string;
      search?: string;
      skip?: number;
      limit?: number;
      sortBy?: 'OCCURRED_AT' | 'ACTOR' | 'ACTION';
      sortOrder?: 'ASC' | 'DESC';
    } = {},
  ) {
    const needle = query.search?.trim() ?? '';
    const conditions: string[] = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    const push = (sql: string, value: unknown) => {
      params.push(value);
      conditions.push(sql.replace('$?', `$${params.length}`));
    };
    if (query.action) push('action = $?', query.action);
    if (query.actor) push('actor = $?', query.actor);
    if (needle) {
      params.push(`%${needle}%`);
      const like = `$${params.length}`;
      conditions.push(
        `(action ILIKE ${like} OR actor ILIKE ${like} OR detail::text ILIKE ${like})`,
      );
    }
    const where = conditions.join(' AND ');
    const sortDir = query.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    const sortCol =
      query.sortBy === 'ACTOR'
        ? 'actor'
        : query.sortBy === 'ACTION'
          ? 'action'
          : 'occurred_at';
    const skip = Math.max(query.skip ?? 0, 0);
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    const [{ rows }, { rows: counted }] = await Promise.all([
      this.pool.query<{
        id: string;
        occurred_at: Date;
        actor: string | null;
        action: string;
        detail: Record<string, unknown>;
      }>(
        `SELECT id, occurred_at, actor, action, detail FROM iam_audit_events
          WHERE ${where} ORDER BY ${sortCol} ${sortDir}, occurred_at DESC, id DESC
          OFFSET $${params.length + 1} LIMIT $${params.length + 2}`,
        [...params, skip, limit],
      ),
      this.pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM iam_audit_events WHERE ${where}`,
        params,
      ),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurred_at,
        actor: row.actor,
        action: row.action,
        detail: row.detail,
      })),
      total: Number(counted[0]?.count ?? 0),
      skip,
      limit,
    };
  }

  /**
   * Gives a tenant's top-level `admins` group Tenant admin, once per tenant
   * (`iam_tenants.admins_granted_at`), so a tenant admin can take it away
   * again. Claiming the marker and the grant are one transaction, so a second
   * pod can never give it again after a revocation. False when it was given
   * before.
   */
  async grantAdminsOnce(
    tenantId: string,
    adminsGroupId: string,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        `UPDATE iam_tenants SET admins_granted_at = now()
          WHERE id = $1 AND admins_granted_at IS NULL`,
        [tenantId],
      );
      if (!rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO iam_grants
           (id, tenant_id, subject_type, subject_id, role_key, scope_type, scope_id, created_by)
         VALUES ($1, $2, 'group', $3, 'tenant-admin', 'tenant', $4, 'system:bootstrap')
         ON CONFLICT (tenant_id, subject_type, subject_id, role_key, scope_type, scope_id) DO NOTHING`,
        // Same id twice: tenant_id is uuid, scope_id text, so one parameter cannot be both.
        [randomUUID(), tenantId, adminsGroupId, tenantId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await this.recordTenantEvent(
      tenantId,
      'system:bootstrap',
      'grant.created',
      {
        subjectType: 'group',
        subjectId: adminsGroupId,
        roleKey: 'tenant-admin',
        scopeType: 'tenant',
      },
    );
    return true;
  }

  /** True until the tenant's `admins` group has been given Tenant admin. */
  async adminsPending(tenantId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM iam_tenants WHERE id = $1 AND admins_granted_at IS NULL`,
      [tenantId],
    );
    return rows.length > 0;
  }

  /** Remember a person's name for their actor references. */
  async rememberPrincipal(
    sub: string,
    displayName: string | null,
    email: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO iam_principals (sub, display_name, email, last_seen_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (sub) DO UPDATE
         SET display_name = EXCLUDED.display_name, email = EXCLUDED.email, last_seen_at = now()`,
      [sub, displayName, email],
    );
  }

  async principalNames(
    subs: string[],
  ): Promise<
    Map<string, { displayName: string | null; email: string | null }>
  > {
    if (subs.length === 0) return new Map();
    const { rows } = await this.pool.query<{
      sub: string;
      display_name: string | null;
      email: string | null;
    }>(
      `SELECT sub, display_name, email FROM iam_principals WHERE sub = ANY($1::text[])`,
      [subs],
    );
    return new Map(
      rows.map((row) => [
        row.sub,
        { displayName: row.display_name, email: row.email },
      ]),
    );
  }

  /** Namespace ids of a tenant, for filtering the workspace directory. */
  async workspacesOf(tenantId: string): Promise<Map<string, WorkspaceTenancy>> {
    const { rows } = await this.pool.query<{
      id: string;
      tenant_id: string;
      owner_group_id: string | null;
      is_public: boolean;
    }>(
      `SELECT id, tenant_id, owner_group_id, is_public FROM namespaces WHERE tenant_id = $1 AND status = 'active'`,
      [tenantId],
    );
    return new Map(
      rows.map((row) => [
        row.id,
        {
          tenantId: row.tenant_id,
          ownerGroupId: row.owner_group_id,
          visibility: row.is_public ? 'public' : 'private',
        },
      ]),
    );
  }
}
