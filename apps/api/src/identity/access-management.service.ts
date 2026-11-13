import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
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
import {
  CLS_DATABASE_LANE,
  CLS_NAMESPACE_ID,
  CLS_SCHEMA,
  CLS_SLUG,
} from '../namespace/namespace.constants';
import { PrismaService } from '../prisma.service';
import { NamespaceRegistryService } from '../registry/namespace-registry.service';

export interface GrantInput extends GrantScope {
  /** Always a group: people get access by being in one. */
  subjectType: 'group';
  subjectId: string;
  roleKey: string;
  expiresAt?: string | null;
}

export interface GrantView extends Grant {
  /** Group path, for people reading the list. */
  subjectLabel: string;
  scopeLabel: string;
  /** True when the grant comes from the tenant or a group, not this workspace. */
  inherited?: boolean;
  /** For a table grant: the source the table belongs to. */
  sourceId?: string;
  createdBy?: string | null;
  createdAt?: Date;
}

/** Which scopes each role can be granted on. */
const ROLE_SCOPES: Record<string, GrantScopeType[]> = Object.fromEntries(
  BUILT_IN_ROLES.map((role) => [
    role.key,
    role.key === 'workspace-manager'
      ? ['group', 'tenant']
      : role.key === 'data-reader'
        ? // Data access is the one thing given on a single source or table.
          ['workspace', 'group', 'tenant', 'source', 'asset']
        : role.scope === 'workspace'
          ? ['workspace', 'group', 'tenant']
          : role.scope === 'tenant'
            ? ['tenant']
            : [],
  ]),
);

function isResourceScope(scopeType: GrantScopeType): boolean {
  return scopeType === 'source' || scopeType === 'asset';
}

/** The workspace a resource grant's scope id (`<namespaceId>/<id>`) is in. */
function resourceWorkspace(scopeId: string): string {
  return scopeId.split('/')[0] ?? '';
}

/** The source or table id in a resource grant's scope id. */
function resourceIdOf(scopeId: string): string {
  return scopeId.split('/').slice(1).join('/');
}

/**
 * Giving and removing access (docs/prd §10 item 11, §12.4). A grant can never
 * give more than its author holds where they give it, so access only ever
 * flows down from a tenant admin.
 */
@Injectable()
export class AccessManagementService {
  constructor(
    private readonly tenancy: TenancyService,
    @Inject(IDENTITY) readonly identity: IdentityService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly registry: NamespaceRegistryService,
  ) {}

  roles() {
    return BUILT_IN_ROLES.filter(
      (role) => role.scope === 'workspace' || role.scope === 'tenant',
    ).map((role) => ({
      key: role.key,
      title: role.title,
      scopes: ROLE_SCOPES[role.key],
      capabilities: [...role.capabilities],
    }));
  }

  tenantEvents(
    principal: Principal,
    query?: {
      action?: string;
      actor?: string;
      search?: string;
      skip?: number;
      limit?: number;
      sortBy?: 'OCCURRED_AT' | 'ACTOR' | 'ACTION';
      sortOrder?: 'ASC' | 'DESC';
    },
  ) {
    return this.tenancy.tenantEvents(principal.tenant.id, query);
  }

  /** Every tenant the principal belongs to, for the account menu's switcher (§12.2). */
  async tenants(principal: Principal): Promise<Tenant[]> {
    const identity = this.identity;
    if (principal.visitor) return [];
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

  /** For the access screens: always as the identity server has them now. */
  async groups(principal: Principal) {
    const groups = await this.identity.groupsOf(principal, true);
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
    const identity = this.identity;
    const lineage = await identity.ownerLineage(principal, namespaceId);
    const grants = (await this.tenancy.listGrants(principal.tenant.id)).filter(
      (grant) =>
        grantApplies(grant, { namespaceId, ownerLineage: lineage }) ||
        (isResourceScope(grant.scopeType) &&
          resourceWorkspace(grant.scopeId) === namespaceId),
    );
    return this.label(
      principal,
      grants,
      (grant) =>
        grant.scopeType !== 'workspace' && !isResourceScope(grant.scopeType),
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
    const lineage = await this.identity.ownerLineage(principal, namespaceId);
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
    const identity = this.identity;
    // The DTO says so too; a caller that skips validation still gets told.
    if ((input.subjectType as string) !== 'group') {
      throw new BadRequestException(
        'Access is given to groups. Put the person in a group and give the group access.',
      );
    }
    const scopes = ROLE_SCOPES[input.roleKey];
    if (!scopes)
      throw new BadRequestException(`Unknown role '${input.roleKey}'`);
    if (!scopes.includes(input.scopeType)) {
      throw new BadRequestException(
        `The ${input.roleKey} role is granted on ${scopes.join(' or ')}, not on a ${input.scopeType}.`,
      );
    }

    let groups = await identity.groupsOf(principal);
    // Made in the identity server a moment ago: not in the cache yet.
    const named = [
      input.subjectId,
      input.scopeType === 'group' ? input.scopeId : null,
    ];
    if (named.some((id) => id && !groups.some((group) => group.id === id))) {
      groups = await identity.groupsOf(principal, true);
    }
    const groupIds = new Set(groups.map((group) => group.id));
    if (!groupIds.has(input.subjectId)) {
      throw new BadRequestException('That group is not part of this tenant.');
    }
    if (input.scopeType === 'group' && !groupIds.has(input.scopeId)) {
      throw new BadRequestException(
        'The scope group is not part of this tenant.',
      );
    }
    if (input.scopeType === 'tenant' && input.scopeId !== principal.tenant.id) {
      throw new BadRequestException('A tenant grant is on your own tenant.');
    }
    if (input.scopeType === 'workspace' || isResourceScope(input.scopeType)) {
      const namespaceId =
        input.scopeType === 'workspace'
          ? input.scopeId
          : resourceWorkspace(input.scopeId);
      if (
        isResourceScope(input.scopeType) &&
        !/^[^/]+\/[^/]+$/.test(input.scopeId)
      ) {
        throw new BadRequestException(
          'A grant on a source or table is scoped as <workspace id>/<id>.',
        );
      }
      const tenancy = await this.tenancy.workspaceTenancy(namespaceId);
      if (tenancy?.tenantId !== principal.tenant.id) {
        throw new NotFoundException(`Unknown namespace '${namespaceId}'`);
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
  ): Promise<GrantView> {
    const grant = await this.tenancy.grantById(principal.tenant.id, id);
    if (
      !grant ||
      (onlyWorkspace &&
        !(
          (grant.scopeType === 'workspace' &&
            grant.scopeId === onlyWorkspace) ||
          (isResourceScope(grant.scopeType) &&
            resourceWorkspace(grant.scopeId) === onlyWorkspace)
        ))
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
    // What was removed, labelled like the list: the trail names it and the
    // caller can say what went.
    const [view] = await this.label(principal, [grant]);
    return view;
  }

  private async label<T extends Grant>(
    principal: Principal,
    grants: T[],
    inherited?: (grant: T) => boolean,
  ): Promise<(T & GrantView)[]> {
    const identity = this.identity;
    const groups = new Map(
      (await identity.groupsOf(principal, true)).map((g) => [g.id, g.path]),
    );
    // Single-resource grants name their source or table, so the access
    // screens and the audit trail read without extra lookups.
    const resources = await this.resources(grants);
    return grants.map((grant) => {
      const resource = isResourceScope(grant.scopeType)
        ? resources.get(`${grant.scopeType}/${resourceIdOf(grant.scopeId)}`)
        : undefined;
      return {
        ...grant,
        subjectLabel: groups.get(grant.subjectId) ?? 'Removed group',
        scopeLabel:
          grant.scopeType === 'tenant'
            ? principal.tenant.name
            : grant.scopeType === 'group'
              ? `Workspaces of ${groups.get(grant.scopeId) ?? 'a removed group'}`
              : (resource?.name ??
                (grant.scopeType === 'source'
                  ? 'One source'
                  : grant.scopeType === 'asset'
                    ? 'One table'
                    : 'This workspace')),
        ...(resource?.sourceId ? { sourceId: resource.sourceId } : {}),
        ...(inherited ? { inherited: inherited(grant) } : {}),
      };
    });
  }

  /**
   * Single-source/table grant scopes (`source/<id>`, `asset/<id>`) → the
   * source or table name, and a table's source, batched in two reads per
   * workspace. A tenant-wide list has no current workspace, so each grant is
   * read in the workspace its scope id names. Deleted resources and
   * workspaces that cannot be read stay absent, and the generic labels apply.
   */
  private async resources(
    grants: Grant[],
  ): Promise<Map<string, { name: string; sourceId?: string }>> {
    const byWorkspace = new Map<
      string,
      { sourceIds: Set<string>; assetIds: Set<string> }
    >();
    for (const grant of grants) {
      if (!isResourceScope(grant.scopeType)) continue;
      const workspaceId = resourceWorkspace(grant.scopeId);
      let ids = byWorkspace.get(workspaceId);
      if (!ids) {
        ids = { sourceIds: new Set(), assetIds: new Set() };
        byWorkspace.set(workspaceId, ids);
      }
      (grant.scopeType === 'source' ? ids.sourceIds : ids.assetIds).add(
        resourceIdOf(grant.scopeId),
      );
    }
    const out = new Map<string, { name: string; sourceId?: string }>();
    for (const [workspaceId, { sourceIds, assetIds }] of byWorkspace) {
      try {
        await this.inWorkspace(workspaceId, async () => {
          if (sourceIds.size) {
            const rows = await this.prisma.source.findMany({
              where: { id: { in: [...sourceIds] } },
              select: { id: true, name: true },
            });
            for (const row of rows) {
              out.set(`source/${row.id}`, { name: row.name });
            }
          }
          if (assetIds.size) {
            const rows = await this.prisma.asset.findMany({
              where: { id: { in: [...assetIds] } },
              select: { id: true, name: true, sourceId: true },
            });
            for (const row of rows) {
              out.set(`asset/${row.id}`, {
                name: row.name,
                sourceId: row.sourceId,
              });
            }
          }
        });
      } catch {
        // A removed workspace or an unreadable one: its rows keep the
        // generic labels, the list still answers.
      }
    }
    return out;
  }

  /** Runs `read` with `workspaceId` as the current workspace. */
  private async inWorkspace<T>(
    workspaceId: string,
    read: () => Promise<T>,
  ): Promise<T> {
    if (
      this.cls.isActive() &&
      this.cls.get<string>(CLS_SCHEMA) &&
      this.cls.get<string>(CLS_NAMESPACE_ID) === workspaceId
    ) {
      return read();
    }
    const workspace = await this.registry.get(workspaceId);
    return this.cls.run(async () => {
      this.cls.set(CLS_SCHEMA, workspace.schemaName);
      this.cls.set(CLS_NAMESPACE_ID, workspace.id);
      this.cls.set(CLS_SLUG, workspace.slug);
      this.cls.set(CLS_DATABASE_LANE, 'interactive');
      return read();
    });
  }
}
