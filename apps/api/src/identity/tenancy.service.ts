import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import {
  PUBLIC_SEARCH_PATH_OPTION,
  publicConnectionString,
} from '../registry/namespace-registry.sql';
import type { RoleKey } from './roles';
import { LOCAL_TENANT_ID } from './tenancy.sql';

export interface Tenant {
  id: string;
  alias: string;
  name: string;
  orgId: string | null;
}

export type GrantScopeType = 'tenant' | 'group' | 'workspace';

export interface Grant {
  id: string;
  tenantId: string;
  subjectType: 'group' | 'user';
  subjectId: string;
  roleKey: RoleKey;
  scopeType: GrantScopeType;
  scopeId: string;
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
    const { rows } = await this.pool.query<{
      id: string;
      alias: string;
      name: string;
      org_id: string | null;
    }>(`SELECT id, alias, name, org_id FROM iam_tenants WHERE alias = $1`, [
      alias,
    ]);
    const tenant = rows[0]
      ? {
          id: rows[0].id,
          alias: rows[0].alias,
          name: rows[0].name,
          orgId: rows[0].org_id,
        }
      : null;
    this.tenantsByAlias.set(alias, {
      tenant,
      expiresAt: Date.now() + TENANT_TTL_MS,
    });
    return tenant;
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
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO iam_grants
         (id, tenant_id, subject_type, subject_id, role_key, scope_type, scope_id, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id, subject_type, subject_id, role_key, scope_type, scope_id) DO NOTHING`,
      [
        randomUUID(),
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
  }

  /**
   * Turning sign-in on for an instance that ran without it: workspaces in the
   * `local` tenant move to the first tenant, owned by its `admins` group, and
   * that group becomes Tenant admin. Idempotent; a no-op once nothing is left
   * in `local`.
   */
  async adoptLocalWorkspaces(
    tenant: Tenant,
    adminsGroupId: string | null,
  ): Promise<void> {
    if (adminsGroupId) {
      await this.addGrant({
        tenantId: tenant.id,
        subjectType: 'group',
        subjectId: adminsGroupId,
        roleKey: 'tenant-admin',
        scopeType: 'tenant',
        scopeId: tenant.id,
        createdBy: 'system:bootstrap',
      });
    }
    const { rowCount } = await this.pool.query(
      `UPDATE namespaces
          SET tenant_id = $1, owner_group_id = COALESCE(owner_group_id, $2)
        WHERE tenant_id = $3`,
      [tenant.id, adminsGroupId, LOCAL_TENANT_ID],
    );
    if (rowCount) {
      this.logger.log(
        `Moved ${rowCount} workspace(s) without sign-in into tenant ${tenant.alias}`,
      );
    }
  }

  /** File a newly created workspace under its tenant and owning group. */
  async assignWorkspace(
    namespaceId: string,
    tenantId: string,
    ownerGroupId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE namespaces SET tenant_id = $2, owner_group_id = $3 WHERE id = $1`,
      [namespaceId, tenantId, ownerGroupId],
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
