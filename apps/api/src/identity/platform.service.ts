import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';
import {
  PUBLIC_SEARCH_PATH_OPTION,
  publicConnectionString,
} from '../registry/namespace-registry.sql';
import type { IdentityService, Operator } from './identity.service';
import { IDENTITY } from './identity.tokens';
import type { MembershipService, OrgMember } from './membership.service';
import {
  TenancyService,
  type Tenant,
  type TenantStatus,
} from './tenancy.service';

const ADMINS = 'admins';

export type TenantProblem =
  /** The organization was deleted in the identity server. */
  | 'ORGANIZATION_MISSING'
  /** An organization with this alias exists, but it is not the tenant's. */
  | 'ORGANIZATION_REPLACED'
  /** Nobody can manage the tenant: it has no top-level `admins` group. */
  | 'NO_ADMINS_GROUP'
  /** Its database could not be upgraded at boot; its workspaces answer 503. */
  | 'UPGRADE_FAILED';

export interface PlatformTenant {
  id: string;
  alias: string;
  /** Its organization in the identity server; null once that is gone. */
  organizationId: string | null;
  name: string;
  status: TenantStatus;
  createdAt: Date;
  workspaces: number;
  members: number;
  admins: { id: string; name: string; email: string | null }[];
  lastActivityAt: Date | null;
  /** Its own database; null until its first workspace. */
  database: string | null;
  upgradeError: string | null;
  problem: TenantProblem | null;
}

/**
 * Tenants, for operators (docs/prd/TEN §4.7): list them, suspend and resume
 * them, and remove one whose
 * organization was deleted. Tenants, their people and groups are made in the
 * identity server; the API only reads it. Operators see tenants, never what
 * is inside their workspaces.
 */
@Injectable()
export class PlatformService implements OnModuleDestroy {
  /** The control database, for copies into tenants and their databases. */
  private readonly pool = new Pool({
    connectionString: publicConnectionString(),
    options: PUBLIC_SEARCH_PATH_OPTION,
    max: 1,
  });
  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityService,
    private readonly tenancy: TenancyService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  // ---- reads ---------------------------------------------------------------

  /**
   * Every tenant. An organization made in the identity server's console that
   * nobody has signed in to yet becomes a tenant here, as at its first
   * sign-in.
   */
  async tenants(): Promise<PlatformTenant[]> {
    const directory = this.directory();
    const organizations = await directory.organizations();
    const known = new Set(
      (await this.tenancy.tenantSummaries()).map((tenant) => tenant.alias),
    );
    for (const org of organizations) {
      if (!known.has(org.alias)) await this.tenancy.ensureTenant(org);
    }
    const byId = new Map(organizations.map((org) => [org.id, org]));
    const byAlias = new Map(organizations.map((org) => [org.alias, org]));

    return Promise.all(
      (await this.tenancy.tenantSummaries()).map(async (tenant) => {
        const base = {
          id: tenant.id,
          alias: tenant.alias,
          organizationId: tenant.orgId,
          name: tenant.name,
          status: tenant.status,
          createdAt: tenant.createdAt,
          workspaces: tenant.workspaces,
          lastActivityAt: tenant.lastActivityAt,
          database: tenant.databaseName,
          upgradeError: tenant.upgradeError,
        };
        const upgrade = tenant.upgradeError
          ? ('UPGRADE_FAILED' as const)
          : null;
        const org = tenant.orgId ? byId.get(tenant.orgId) : undefined;
        if (tenant.status === 'deleted' || !org) {
          return {
            ...base,
            organizationId: null,
            members: 0,
            admins: [],
            problem:
              tenant.status === 'deleted'
                ? null
                : (upgrade ?? byAlias.has(tenant.alias))
                  ? ('ORGANIZATION_REPLACED' as const)
                  : ('ORGANIZATION_MISSING' as const),
          };
        }
        const [members, groups] = await Promise.all([
          directory.members(org.id),
          directory.groups(org.id, { fresh: true }),
        ]);
        const admins = groups.find(
          (group) => group.parentId === null && group.name === ADMINS,
        );
        const adminIds = new Set(
          admins ? await directory.groupMemberIds(org.id, admins.id) : [],
        );
        return {
          ...base,
          members: members.length,
          admins: members
            .filter((member) => adminIds.has(member.id))
            .map((member) => ({
              id: member.id,
              name: nameOf(member),
              email: member.email,
            })),
          problem: upgrade ?? (admins ? null : ('NO_ADMINS_GROUP' as const)),
        };
      }),
    );
  }

  // ---- tenants -------------------------------------------------------------

  /**
   * Suspended: its people and their agents are refused within a minute, its
   * data is kept. Background work in its workspaces keeps running.
   */
  async setSuspended(
    operator: Operator,
    tenantId: string,
    suspended: boolean,
  ): Promise<PlatformTenant> {
    this.directory();
    const tenant = await this.requireTenant(tenantId);
    if (tenant.status === 'deleted') {
      throw new ConflictException('This tenant has been deleted.');
    }
    if (await this.tenancy.setSuspended(tenant.id, suspended)) {
      await this.tenancy.recordTenantEvent(
        tenant.id,
        operator.actor.ref,
        suspended ? 'tenant.suspended' : 'tenant.resumed',
        { alias: tenant.alias },
      );
    }
    return this.tenantView(tenant.id);
  }

  /**
   * Removes a tenant whose organization was deleted in the identity server:
   * its workspaces and their data (its database is dropped), its grants. The
   * tenant row stays, marked deleted, so the alias is never handed out again
   * and its activity stays. Tenants, their people and groups are made and
   * removed in the identity server, never here.
   */
  async deleteTenant(
    operator: Operator,
    tenantId: string,
    confirmAlias: unknown,
  ): Promise<void> {
    const directory = this.directory();
    const tenant = await this.requireTenant(tenantId);
    if (confirmAlias !== tenant.alias) {
      throw new BadRequestException(
        `Type the tenant's alias, '${tenant.alias}', to delete it.`,
      );
    }
    const organizations = await directory.organizations();
    if (organizations.some((org) => org.id === tenant.orgId)) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'ORGANIZATION_EXISTS',
        message:
          'Delete the organization in the identity server first; then its data can be removed here.',
      });
    }
    const workspaces = await this.tenancy.markDeleted(tenant.id);
    await this.tenancy.dropDatabaseIfUnused(tenant.id);
    await this.tenancy.recordTenantEvent(
      tenant.id,
      operator.actor.ref,
      'tenant.deleted',
      { alias: tenant.alias, workspacesRemoved: workspaces },
    );
  }

  // ---- helpers -------------------------------------------------------------

  private async tenantView(tenantId: string): Promise<PlatformTenant> {
    const view = (await this.tenants()).find(
      (tenant) => tenant.id === tenantId,
    );
    if (!view) throw new NotFoundException('No such tenant.');
    return view;
  }

  private async requireTenant(tenantId: string): Promise<Tenant> {
    const tenant =
      typeof tenantId === 'string'
        ? await this.tenancy.tenantById(tenantId).catch(() => null)
        : null;
    if (!tenant) throw new NotFoundException('No such tenant.');
    return tenant;
  }

  private directory(): MembershipService {
    return this.identity.membership;
  }
}

function nameOf(member: OrgMember): string {
  return (
    [member.firstName, member.lastName].filter(Boolean).join(' ') ||
    member.email ||
    member.username
  );
}
