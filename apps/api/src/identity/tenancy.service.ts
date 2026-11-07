import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import {
  PUBLIC_SEARCH_PATH_OPTION,
  publicConnectionString,
} from '../registry/namespace-registry.sql';
import type { RoleKey } from './roles';
import { LOCAL_TENANT_ID } from './tenancy.sql';

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
}

export type GrantScopeType = 'tenant' | 'group' | 'workspace';

/** Scope a grant applies to: the whole tenant, a group's workspaces, or one workspace. */
export interface GrantScope {
  scopeType: GrantScopeType;
  scopeId: string;
}

export interface Grant extends GrantScope {
  id: string;
  tenantId: string;
  subjectType: 'group' | 'user';
  subjectId: string;
  roleKey: RoleKey;
  expiresAt: Date | null;
}

export interface WorkspaceTenancy {
  tenantId: string;
  ownerGroupId: string | null;
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

  /** Every tenant but `local`, with what the Platform page shows. */
  async tenantSummaries(): Promise<TenantSummary[]> {
    const { rows } = await this.pool.query<
      TenantRow & {
        created_at: Date;
        workspaces: number;
        last_activity_at: Date | null;
      }
    >(
      `SELECT t.id, t.alias, t.name, t.org_id, t.suspended_at, t.deleted_at, t.created_at,
              (SELECT count(*)::int FROM namespaces n
                WHERE n.tenant_id = t.id AND n.status <> 'deleted') AS workspaces,
              (SELECT max(e.occurred_at) FROM iam_audit_events e
                WHERE e.tenant_id = t.id) AS last_activity_at
         FROM iam_tenants t
        WHERE t.id <> $1
        ORDER BY lower(t.name)`,
      [LOCAL_TENANT_ID],
    );
    return rows.map((row) => ({
      ...toTenant(row),
      createdAt: row.created_at,
      workspaces: row.workspaces,
      lastActivityAt: row.last_activity_at,
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
   * Marks a tenant deleted and drops what gave anyone access to it: grants and
   * the record of accounts made here. Returns those accounts, for the caller
   * to delete where they are in no other tenant.
   */
  async markDeleted(tenantId: string): Promise<string[]> {
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
        return [];
      }
      await client.query('DELETE FROM iam_grants WHERE tenant_id = $1', [
        tenantId,
      ]);
      const { rows } = await client.query<{ sub: string }>(
        'DELETE FROM iam_people WHERE tenant_id = $1 RETURNING sub',
        [tenantId],
      );
      await client.query('COMMIT');
      return rows.map((row) => row.sub);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
      this.tenantsByAlias.clear();
    }
  }

  /** Removes a tenant row that never got anything: a creation rolled back. */
  async forgetNewTenant(tenantId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM iam_tenants t WHERE t.id = $1
          AND NOT EXISTS (SELECT 1 FROM namespaces n WHERE n.tenant_id = t.id)`,
      [tenantId],
    );
    this.tenantsByAlias.clear();
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
    }>(`SELECT tenant_id, owner_group_id FROM namespaces WHERE id = $1`, [
      namespaceId,
    ]);
    return rows[0]
      ? { tenantId: rows[0].tenant_id, ownerGroupId: rows[0].owner_group_id }
      : null;
  }

  /** Every live grant in a tenant whose subject is this person or one of their groups. */
  async grantsFor(
    tenantId: string,
    sub: string,
    groupIds: Iterable<string>,
  ): Promise<Grant[]> {
    const { rows } = await this.pool.query<{
      id: string;
      tenant_id: string;
      subject_type: 'group' | 'user';
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
          AND ((subject_type = 'user' AND subject_id = $2)
            OR (subject_type = 'group' AND subject_id = ANY($3::text[])))`,
      [tenantId, sub, [...groupIds]],
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
      subject_type: 'group' | 'user';
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

  async tenantEvents(tenantId: string, limit = 100) {
    const { rows } = await this.pool.query<{
      id: string;
      occurred_at: Date;
      actor: string | null;
      action: string;
      detail: Record<string, unknown>;
    }>(
      `SELECT id, occurred_at, actor, action, detail FROM iam_audit_events
        WHERE tenant_id = $1 ORDER BY occurred_at DESC LIMIT $2`,
      [tenantId, Math.min(Math.max(limit, 1), 500)],
    );
    return rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at,
      actor: row.actor,
      action: row.action,
      detail: row.detail,
    }));
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

  /** An account Classifyre created for this tenant (People → Add). */
  async rememberCreatedPerson(
    sub: string,
    tenantId: string,
    createdBy: string | undefined,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO iam_people (sub, tenant_id, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (sub, tenant_id) DO NOTHING`,
      [sub, tenantId, createdBy ?? null],
    );
  }

  async createdHere(sub: string, tenantId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM iam_people WHERE sub = $1 AND tenant_id = $2`,
      [sub, tenantId],
    );
    return rows.length > 0;
  }

  /** Subjects of the accounts Classifyre created for this tenant. */
  async createdPeople(tenantId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ sub: string }>(
      `SELECT sub FROM iam_people WHERE tenant_id = $1`,
      [tenantId],
    );
    return new Set(rows.map((row) => row.sub));
  }

  async forgetCreatedPerson(sub: string, tenantId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM iam_people WHERE sub = $1 AND tenant_id = $2`,
      [sub, tenantId],
    );
  }

  /** Grants given to these groups or on their workspaces; returns how many went. */
  async deleteGroupGrants(
    tenantId: string,
    groupIds: string[],
  ): Promise<number> {
    if (groupIds.length === 0) return 0;
    const { rowCount } = await this.pool.query(
      `DELETE FROM iam_grants
        WHERE tenant_id = $1
          AND ((subject_type = 'group' AND subject_id = ANY($2::text[]))
            OR (scope_type = 'group' AND scope_id = ANY($2::text[])))`,
      [tenantId, groupIds],
    );
    return rowCount ?? 0;
  }

  /** A person's own grants in a tenant (not their groups'). */
  async deletePersonGrants(tenantId: string, sub: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM iam_grants
        WHERE tenant_id = $1 AND subject_type = 'user' AND subject_id = $2`,
      [tenantId, sub],
    );
    return rowCount ?? 0;
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
    }>(
      `SELECT id, tenant_id, owner_group_id FROM namespaces WHERE tenant_id = $1 AND status = 'active'`,
      [tenantId],
    );
    return new Map(
      rows.map((row) => [
        row.id,
        { tenantId: row.tenant_id, ownerGroupId: row.owner_group_id },
      ]),
    );
  }
}
