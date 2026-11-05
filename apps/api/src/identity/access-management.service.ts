import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Capability } from './capabilities';
import { grantApplies, roleCapabilities } from './grant-evaluation';
import type { IdentityService, Principal } from './identity.service';
import { IDENTITY } from './identity.tokens';
import { BUILT_IN_ROLES } from './roles';
import {
  TenancyService,
  type Grant,
  type GrantScope,
  type GrantScopeType,
  type Tenant,
} from './tenancy.service';

export interface GrantInput extends GrantScope {
  subjectType: 'group' | 'user';
  subjectId: string;
  roleKey: string;
  expiresAt?: string | null;
}

export interface GrantView extends Grant {
  /** Group path or person's name, for people reading the list. */
  subjectLabel: string;
  scopeLabel: string;
  /** True when the grant comes from the tenant or a group, not this workspace. */
  inherited?: boolean;
  createdBy?: string | null;
  createdAt?: Date;
}

/** Which scopes each role can be granted on. */
const ROLE_SCOPES: Record<string, GrantScopeType[]> = Object.fromEntries(
  BUILT_IN_ROLES.map((role) => [
    role.key,
    role.key === 'workspace-manager'
      ? ['group', 'tenant']
      : role.scope === 'workspace'
        ? ['workspace', 'group', 'tenant']
        : role.scope === 'tenant'
          ? ['tenant']
          : [],
  ]),
);

/**
 * Giving and removing access (docs/prd §10 item 11, §12.4). A grant can never
 * give more than its author holds where they give it, so access only ever
 * flows down from a tenant admin.
 */
@Injectable()
export class AccessManagementService {
  constructor(
    private readonly tenancy: TenancyService,
    @Inject(IDENTITY) private readonly identity: IdentityService | null,
  ) {}

  /** The identity service; a 409 explaining why when sign-in is off. */
  requireSignIn(): IdentityService {
    if (!this.identity) {
      throw new ConflictException(
        'Sign-in is off: everyone can do everything, so there is no access to manage.',
      );
    }
    return this.identity;
  }

  roles() {
    return BUILT_IN_ROLES.filter(
      (role) => role.key !== 'platform-operator',
    ).map((role) => ({
      key: role.key,
      title: role.title,
      scopes: ROLE_SCOPES[role.key],
      capabilities: [...role.capabilities],
    }));
  }

  tenantEvents(principal: Principal) {
    this.requireSignIn();
    return this.tenancy.tenantEvents(principal.tenant.id);
  }

  /** Every tenant the principal belongs to, for the account menu's switcher (§12.2). */
  async tenants(principal: Principal): Promise<Tenant[]> {
    const identity = this.requireSignIn();
    const { organizations } = await identity.membership.membership(
      principal.sub,
    );
    const tenants: Tenant[] = [];
    for (const org of organizations) {
      const tenant = await this.tenancy.tenantByAlias(org.alias);
      if (tenant) tenants.push({ ...tenant, orgId: org.id });
    }
    return tenants.sort((a, b) => a.name.localeCompare(b.name));
  }

  async groups(principal: Principal) {
    const groups = await this.requireSignIn().groupsOf(principal);
    return groups.map(({ id, name, path, parentId }) => ({
      id,
      name,
      path,
      parentId,
    }));
  }

  /** Every grant that reaches a workspace: its own, its owner groups', the tenant's. */
  async workspaceGrants(
    principal: Principal,
    namespaceId: string,
  ): Promise<GrantView[]> {
    const identity = this.requireSignIn();
    const lineage = await identity.ownerLineage(principal, namespaceId);
    const grants = (await this.tenancy.listGrants(principal.tenant.id)).filter(
      (grant) => grantApplies(grant, { namespaceId, ownerLineage: lineage }),
    );
    return this.label(
      principal,
      grants,
      (grant) => grant.scopeType !== 'workspace',
    );
  }

  async tenantGrants(principal: Principal): Promise<GrantView[]> {
    return this.label(
      principal,
      await this.tenancy.listGrants(principal.tenant.id),
    );
  }

  /** The principal's own grants that give a capability in a workspace ("why can I…"). */
  async explain(
    principal: Principal,
    namespaceId: string,
    capability: Capability,
  ): Promise<GrantView[]> {
    const lineage = await this.requireSignIn().ownerLineage(
      principal,
      namespaceId,
    );
    const giving = principal.grants.filter(
      (grant) =>
        grantApplies(grant, { namespaceId, ownerLineage: lineage }) &&
        roleCapabilities(grant.roleKey).includes(capability),
    );
    return this.label(
      principal,
      giving,
      (grant) => grant.scopeType !== 'workspace',
    );
  }

  async addGrant(
    principal: Principal,
    input: GrantInput,
    granterCapabilities: ReadonlySet<Capability>,
  ): Promise<GrantView> {
    const identity = this.requireSignIn();
    const scopes = ROLE_SCOPES[input.roleKey];
    if (!scopes)
      throw new BadRequestException(`Unknown role '${input.roleKey}'`);
    if (!scopes.includes(input.scopeType)) {
      throw new BadRequestException(
        `The ${input.roleKey} role is granted on ${scopes.join(' or ')}, not on a ${input.scopeType}.`,
      );
    }

    const groups = await identity.groupsOf(principal);
    const groupIds = new Set(groups.map((group) => group.id));
    if (input.subjectType === 'group' && !groupIds.has(input.subjectId)) {
      throw new BadRequestException('That group is not part of this tenant.');
    }
    if (
      input.subjectType === 'user' &&
      !(await identity.isMember(principal, input.subjectId))
    ) {
      throw new BadRequestException(
        'That person is not a member of this tenant.',
      );
    }
    if (input.scopeType === 'group' && !groupIds.has(input.scopeId)) {
      throw new BadRequestException(
        'The scope group is not part of this tenant.',
      );
    }
    if (input.scopeType === 'tenant' && input.scopeId !== principal.tenant.id) {
      throw new BadRequestException('A tenant grant is on your own tenant.');
    }
    if (input.scopeType === 'workspace') {
      const tenancy = await this.tenancy.workspaceTenancy(input.scopeId);
      if (tenancy?.tenantId !== principal.tenant.id) {
        throw new NotFoundException(`Unknown namespace '${input.scopeId}'`);
      }
    }

    // No escalation: the author must already hold everything the role gives.
    const missing = roleCapabilities(input.roleKey).find(
      (capability) => !granterCapabilities.has(capability),
    );
    if (missing) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'GRANT_EXCEEDS_OWN_ACCESS',
        capability: missing,
        message: `You cannot give the ${input.roleKey} role: it includes ${missing}, which you do not have here.`,
      });
    }

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (
      expiresAt &&
      (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())
    ) {
      throw new BadRequestException('expiresAt must be a date in the future.');
    }
    const id = await this.tenancy.addGrant({
      tenantId: principal.tenant.id,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      roleKey: input.roleKey as Grant['roleKey'],
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      expiresAt,
      createdBy: principal.actor.ref,
    });
    await this.tenancy.recordTenantEvent(
      principal.tenant.id,
      principal.actor.ref,
      'grant.added',
      {
        grantId: id,
        ...input,
      },
    );
    const [view] = await this.label(principal, [
      {
        id,
        tenantId: principal.tenant.id,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        roleKey: input.roleKey as Grant['roleKey'],
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        expiresAt,
      },
    ]);
    return view;
  }

  /**
   * Removes a grant. `onlyWorkspace` limits a workspace admin to the grants
   * made on their workspace; inherited ones are the tenant admin's to remove.
   */
  async removeGrant(
    principal: Principal,
    id: string,
    onlyWorkspace?: string,
  ): Promise<void> {
    this.requireSignIn();
    const grant = await this.tenancy.grantById(principal.tenant.id, id);
    if (
      !grant ||
      (onlyWorkspace &&
        (grant.scopeType !== 'workspace' || grant.scopeId !== onlyWorkspace))
    ) {
      throw new NotFoundException('No such grant here.');
    }
    await this.tenancy.deleteGrant(principal.tenant.id, id);
    await this.tenancy.recordTenantEvent(
      principal.tenant.id,
      principal.actor.ref,
      'grant.removed',
      {
        grantId: id,
        subjectType: grant.subjectType,
        subjectId: grant.subjectId,
        roleKey: grant.roleKey,
        scopeType: grant.scopeType,
        scopeId: grant.scopeId,
      },
    );
  }

  private async label<T extends Grant>(
    principal: Principal,
    grants: T[],
    inherited?: (grant: T) => boolean,
  ): Promise<(T & GrantView)[]> {
    const identity = this.requireSignIn();
    const groups = new Map(
      (await identity.groupsOf(principal)).map((g) => [g.id, g.path]),
    );
    const people = await this.tenancy.principalNames(
      grants
        .filter((grant) => grant.subjectType === 'user')
        .map((grant) => grant.subjectId),
    );
    return grants.map((grant) => ({
      ...grant,
      subjectLabel:
        grant.subjectType === 'group'
          ? (groups.get(grant.subjectId) ?? 'Removed group')
          : (people.get(grant.subjectId)?.displayName ?? 'Former member'),
      scopeLabel:
        grant.scopeType === 'tenant'
          ? principal.tenant.name
          : grant.scopeType === 'group'
            ? `Workspaces of ${groups.get(grant.scopeId) ?? 'a removed group'}`
            : 'This workspace',
      ...(inherited ? { inherited: inherited(grant) } : {}),
    }));
  }
}
