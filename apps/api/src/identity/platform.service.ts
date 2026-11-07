import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';
import { moveWorkspaces, UsageError } from '../admin';
import {
  PUBLIC_SEARCH_PATH_OPTION,
  publicConnectionString,
} from '../registry/namespace-registry.sql';
import type { IdentityService, Operator } from './identity.service';
import { IDENTITY } from './identity.tokens';
import type { MembershipService, OrgMember } from './membership.service';
import { PeopleService, type Acting } from './people.service';
import { LOCAL_TENANT_ID } from './tenancy.sql';
import {
  TenancyService,
  type Tenant,
  type TenantStatus,
} from './tenancy.service';

const ALIAS = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const ADMINS = 'admins';

export type TenantProblem =
  /** The organization was deleted in the identity server. */
  | 'ORGANIZATION_MISSING'
  /** An organization with this alias exists, but it is not the tenant's. */
  | 'ORGANIZATION_REPLACED'
  /** Nobody can manage the tenant: it has no top-level `admins` group. */
  | 'NO_ADMINS_GROUP';

export interface PlatformTenant {
  id: string;
  alias: string;
  name: string;
  status: TenantStatus;
  createdAt: Date;
  workspaces: number;
  members: number;
  admins: { id: string; name: string; email: string | null }[];
  lastActivityAt: Date | null;
  problem: TenantProblem | null;
}

/**
 * Tenants, for operators (docs/prd/TEN §4.7): create, suspend, resume and
 * delete them, change their admins and bring workspaces made without sign-in
 * into one. Operators see tenants, never what is inside their workspaces.
 *
 * Changes inside a tenant (its first admin, admins added or removed) go
 * through {@link PeopleService} acting in that tenant as the operator, so the
 * same rules hold as on the Tenant access page and every change is in that
 * tenant's activity.
 */
@Injectable()
export class PlatformService implements OnModuleDestroy {
  /** For workspace imports, which move registry rows in one transaction. */
  private readonly pool = new Pool({
    connectionString: publicConnectionString(),
    options: PUBLIC_SEARCH_PATH_OPTION,
    max: 1,
  });

  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityService | null,
    private readonly tenancy: TenancyService,
    private readonly people: PeopleService,
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
          name: tenant.name,
          status: tenant.status,
          createdAt: tenant.createdAt,
          workspaces: tenant.workspaces,
          lastActivityAt: tenant.lastActivityAt,
        };
        const org = tenant.orgId ? byId.get(tenant.orgId) : undefined;
        if (tenant.status === 'deleted' || !org) {
          return {
            ...base,
            members: 0,
            admins: [],
            problem:
              tenant.status === 'deleted'
                ? null
                : byAlias.has(tenant.alias)
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
          problem: admins ? null : ('NO_ADMINS_GROUP' as const),
        };
      }),
    );
  }

  /** Workspaces made without sign-in, which an operator can bring into a tenant. */
  async localWorkspaces(): Promise<
    { id: string; slug: string; name: string }[]
  > {
    this.directory();
    const { rows } = await this.pool.query<{
      id: string;
      slug: string;
      name: string;
    }>(
      `SELECT id, slug, name FROM namespaces
        WHERE tenant_id = $1 AND status <> 'deleted' ORDER BY slug`,
      [LOCAL_TENANT_ID],
    );
    return rows;
  }

  // ---- tenants -------------------------------------------------------------

  /**
   * A new tenant: its organization, the top-level `admins` group, its first
   * admin (an account in no tenant, or a new one with a temporary password)
   * and Tenant admin for that group. Undone as a whole when a step fails.
   */
  async createTenant(
    operator: Operator,
    input: {
      name?: unknown;
      alias?: unknown;
      adminEmail?: unknown;
      adminFirstName?: unknown;
      adminLastName?: unknown;
    },
  ): Promise<{ tenant: PlatformTenant; temporaryPassword: string | null }> {
    const directory = this.writable();
    const name = text(input.name, 'name', 100);
    const alias = text(input.alias, 'alias', 40).toLowerCase();
    if (!ALIAS.test(alias)) {
      throw new BadRequestException(
        'The alias is lowercase letters, digits and dashes, and starts and ends with a letter or digit.',
      );
    }
    if (alias === 'local') {
      throw new BadRequestException(
        "'local' is kept for workspaces made without sign-in.",
      );
    }
    // Deleted tenants keep their alias, so nobody inherits their history.
    if (
      (await this.tenancy.tenantByAlias(alias)) ||
      (await directory.organizationByAlias(alias))
    ) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'ALIAS_TAKEN',
        message: `The alias '${alias}' is taken, also by tenants deleted earlier.`,
      });
    }

    const created = await directory.send('POST', '/organizations', {
      name,
      alias,
      enabled: true,
    });
    if (created.status === 409) {
      throw new ConflictException(`The name or alias '${alias}' is taken.`);
    }
    expect(created, 'create the organization', [201]);
    const orgId = locationId(created, 'organization');

    let tenant: Tenant | null = null;
    let firstAdmin: { id: string; created: boolean } | null = null;
    try {
      const group = await directory.send(
        'POST',
        `/organizations/${orgId}/groups`,
        { name: ADMINS },
      );
      expect(group, 'create the admins group', [201]);
      const adminsId = locationId(group, 'group');
      tenant = await this.tenancy.ensureTenant({ id: orgId, alias, name });

      const acting = this.acting(operator, tenant);
      const added = await this.people.addPerson(acting, {
        email: input.adminEmail,
        firstName: input.adminFirstName,
        lastName: input.adminLastName,
      });
      firstAdmin = {
        id: added.person.id,
        created: added.temporaryPassword !== null,
      };
      await this.people.addToGroup(acting, adminsId, added.person.id);
      await this.tenancy.grantAdminsOnce(tenant.id, adminsId);
      await this.tenancy.recordTenantEvent(
        tenant.id,
        operator.actor.ref,
        'tenant.created',
        { alias, name },
      );
      return {
        tenant: await this.tenantView(tenant.id),
        temporaryPassword: added.temporaryPassword,
      };
    } catch (error) {
      // Never leave half a tenant: no organization, row or account behind.
      if (firstAdmin?.created) {
        await directory
          .send('DELETE', `/users/${firstAdmin.id}`)
          .catch(() => undefined);
      }
      await directory
        .send('DELETE', `/organizations/${orgId}`)
        .catch(() => undefined);
      if (tenant) {
        await this.tenancy.forgetNewTenant(tenant.id).catch(() => undefined);
      }
      throw error;
    }
  }

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
   * Deletes a tenant that has no workspaces left: its organization goes,
   * with it everyone's membership; the accounts Classifyre made for it go
   * too, when they are in no other tenant. The tenant row stays, marked
   * deleted, so the alias is never handed out again and its activity stays.
   */
  async deleteTenant(
    operator: Operator,
    tenantId: string,
    confirmAlias: unknown,
  ): Promise<void> {
    const directory = this.writable();
    const tenant = await this.requireTenant(tenantId);
    if (confirmAlias !== tenant.alias) {
      throw new BadRequestException(
        `Type the tenant's alias, '${tenant.alias}', to delete it.`,
      );
    }
    const summary = (await this.tenancy.tenantSummaries()).find(
      (candidate) => candidate.id === tenant.id,
    );
    if (summary && summary.workspaces > 0) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'TENANT_HAS_WORKSPACES',
        message: `The tenant still has ${summary.workspaces} workspace(s). Its admins delete them, or an operator moves them out, first.`,
      });
    }

    // Read before anything is removed, so a retry after a failure still
    // knows which accounts were made here.
    const createdHere = [...(await this.tenancy.createdPeople(tenant.id))];
    if (tenant.orgId) {
      expect(
        await directory.send('DELETE', `/organizations/${tenant.orgId}`),
        'delete the organization',
        [204, 404],
      );
      directory.forget(tenant.orgId);
    }
    await this.tenancy.markDeleted(tenant.id);
    for (const sub of createdHere) {
      const orgs =
        (await directory.read<{ id: string }[]>(
          `/organizations/members/${sub}/organizations`,
        )) ?? [];
      if (orgs.length === 0) {
        await directory.send('DELETE', `/users/${sub}`).catch(() => undefined);
      }
    }
    await this.tenancy.recordTenantEvent(
      tenant.id,
      operator.actor.ref,
      'tenant.deleted',
      { alias: tenant.alias, accountsRemoved: createdHere.length },
    );
  }

  // ---- admins --------------------------------------------------------------

  /**
   * Makes someone a tenant admin: a member of the tenant already, an account
   * in no tenant, or a new account with a temporary password.
   */
  async addAdmin(
    operator: Operator,
    tenantId: string,
    input: { email?: unknown; firstName?: unknown; lastName?: unknown },
  ): Promise<{ temporaryPassword: string | null }> {
    const directory = this.writable();
    const { acting, adminsId } = await this.inTenant(operator, tenantId);
    const email =
      typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const member = (await directory.members(acting.orgId)).find(
      (candidate) => candidate.email?.toLowerCase() === email,
    );
    let temporaryPassword: string | null = null;
    let userId = member?.id;
    if (!userId) {
      const added = await this.people.addPerson(acting, input);
      userId = added.person.id;
      temporaryPassword = added.temporaryPassword;
    }
    await this.people.addToGroup(acting, adminsId, userId);
    return { temporaryPassword };
  }

  /** Takes someone out of `admins`; the last admin stays. */
  async removeAdmin(
    operator: Operator,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    this.writable();
    const { acting, adminsId } = await this.inTenant(operator, tenantId);
    await this.people.removeFromGroup(acting, adminsId, userId);
  }

  // ---- workspaces ----------------------------------------------------------

  /** Moves workspaces made without sign-in into a tenant (docs/prd/TEN §6). */
  async importWorkspaces(
    operator: Operator,
    tenantId: string,
    slugs: unknown,
  ): Promise<{ moved: string[] }> {
    this.directory();
    const tenant = await this.requireTenant(tenantId);
    if (tenant.status === 'deleted') {
      throw new ConflictException('This tenant has been deleted.');
    }
    if (
      !Array.isArray(slugs) ||
      slugs.length === 0 ||
      slugs.length > 500 ||
      !slugs.every((slug) => typeof slug === 'string')
    ) {
      throw new BadRequestException('Pick the workspaces to bring in.');
    }
    try {
      const moved = await moveWorkspaces(
        this.pool,
        {
          to: { tenant: tenant.alias },
          slugs: slugs.map((slug) => slug.toLowerCase()),
        },
        operator.actor.ref,
      );
      return { moved: moved.map((workspace) => workspace.slug) };
    } catch (error) {
      // The command's own refusals name the workspaces; nothing else leaks.
      if (error instanceof UsageError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
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
      typeof tenantId === 'string' && tenantId !== LOCAL_TENANT_ID
        ? await this.tenancy.tenantById(tenantId).catch(() => null)
        : null;
    if (!tenant) throw new NotFoundException('No such tenant.');
    return tenant;
  }

  /** The operator acting inside a live tenant, and its `admins` group. */
  private async inTenant(
    operator: Operator,
    tenantId: string,
  ): Promise<{ acting: Acting; adminsId: string }> {
    const tenant = await this.requireTenant(tenantId);
    if (tenant.status === 'deleted' || !tenant.orgId) {
      throw new ConflictException('This tenant has been deleted.');
    }
    const admins = (
      await this.directory().groups(tenant.orgId, { fresh: true })
    ).find((group) => group.parentId === null && group.name === ADMINS);
    if (!admins) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'NO_ADMINS_GROUP',
        message:
          "The tenant has no top-level 'admins' group in the identity server.",
      });
    }
    return { acting: this.acting(operator, tenant), adminsId: admins.id };
  }

  private acting(operator: Operator, tenant: Tenant): Acting {
    return {
      sub: operator.sub,
      orgId: tenant.orgId!,
      tenant,
      actor: operator.actor,
    };
  }

  private directory(): MembershipService {
    if (!this.identity) {
      throw new ConflictException(
        'Sign-in is off: there are no tenants to manage.',
      );
    }
    return this.identity.membership;
  }

  /** Changes in the identity server need the chart's people management on. */
  private writable(): MembershipService {
    const directory = this.directory();
    if (!this.identity!.config.peopleManagement) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'PEOPLE_MANAGED_ELSEWHERE',
        message:
          'Tenants, people and groups are managed in the identity server on this installation (iam.peopleManagement is off).',
      });
    }
    return directory;
  }
}

function nameOf(member: OrgMember): string {
  return (
    [member.firstName, member.lastName].filter(Boolean).join(' ') ||
    member.email ||
    member.username
  );
}

function text(value: unknown, label: string, max: number): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new BadRequestException(`Enter a ${label}.`);
  if (trimmed.length > max) {
    throw new BadRequestException(
      `The ${label} is longer than ${max} characters.`,
    );
  }
  return trimmed;
}

function expect(response: Response, what: string, ok: number[]): void {
  if (ok.includes(response.status)) return;
  if (response.status === 403) {
    throw new BadGatewayException(
      `Classifyre may not ${what} in the identity server: its service account lacks the rights (iam.peopleManagement).`,
    );
  }
  throw new BadGatewayException(
    `The identity server could not ${what} (${response.status}).`,
  );
}

function locationId(response: Response, what: string): string {
  const id = response.headers.get('location')?.split('/').pop() ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new BadGatewayException(
      `The identity server did not say which ${what} it created.`,
    );
  }
  return id;
}
