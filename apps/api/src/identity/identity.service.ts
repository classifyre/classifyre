import { Injectable, Logger } from '@nestjs/common';
import type { Actor } from './actor';
import type { Capability } from './capabilities';
import {
  canCreateWorkspaceFor,
  capabilitiesInWorkspace,
  tenantCapabilities,
} from './grant-evaluation';
import type { IamConfig } from './iam-config';
import { InvalidTokenError, JwtVerifier } from './jwt-verifier';
import { MembershipService, type OrgGroup } from './membership.service';
import { TenancyService, type Grant, type Tenant } from './tenancy.service';

/** The browser's session cookie (set by the web app in step 6). */
export const SESSION_COOKIE = 'cf_session';

export interface Principal {
  /** Keycloak subject id of the signed-in person; never a group or actor ref. */
  sub: string;
  actor: Actor;
  tenant: Tenant;
  orgId: string;
  groupIds: Set<string>;
  grants: Grant[];
  /** How the token arrived: a cookie needs a same-origin check on writes. */
  via: 'bearer' | 'cookie';
  /**
   * Someone who has not signed in, browsing the public tenant: `sub` is
   * empty, the only grant is Visitor on that tenant.
   */
  visitor?: true;
}

/**
 * Why a request is not signed in, as the API's 401 `code`. All but
 * `SIGN_IN_REQUIRED` are signed-in people whom renewing the session would not
 * help, so the web shows them a page saying why instead of retrying.
 */
export type AuthenticationCode =
  | 'SIGN_IN_REQUIRED'
  | 'NO_TENANT'
  | 'CHOOSE_TENANT'
  | 'TENANT_SUSPENDED'
  | 'TENANT_DELETED'
  | 'TENANT_REPLACED';

/** The realm role that opens the Platform page (docs/prd/TEN §4.7). */
export const OPERATOR_ROLE = 'classifyre-operator';

/**
 * Someone who manages tenants (docs/prd/TEN §4.7). Needs no tenant: an
 * operator sees tenants, never their workspaces, unless also a member.
 */
export interface Operator {
  sub: string;
  actor: Actor;
  via: 'bearer' | 'cookie';
}

export class AuthenticationError extends Error {
  constructor(
    message: string,
    readonly code: AuthenticationCode = 'SIGN_IN_REQUIRED',
  ) {
    super(message);
  }
}

interface RequestLike {
  headers?: Record<string, unknown>;
  classifyrePrincipal?: Principal | null;
  classifyreOperator?: Operator | null;
}

function header(headers: Record<string, unknown> | undefined, name: string) {
  const value = headers?.[name];
  return Array.isArray(value) ? (value[0] as unknown) : value;
}

/** The access token of a request: `Authorization: Bearer` or the session cookie. */
export function tokenOf(
  headers: Record<string, unknown> | undefined,
): { token: string; via: 'bearer' | 'cookie' } | null {
  const authorization = header(headers, 'authorization');
  if (typeof authorization === 'string') {
    const [scheme, token] = authorization.trim().split(/\s+/, 2);
    // MCP tokens are not identity-server tokens; the MCP handler owns them.
    if (
      scheme?.toLowerCase() === 'bearer' &&
      token &&
      !token.startsWith('inmcp_')
    ) {
      return { token, via: 'bearer' };
    }
  }
  const cookie = header(headers, 'cookie');
  if (typeof cookie === 'string') {
    for (const part of cookie.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === SESSION_COOKIE && rest.length > 0) {
        return { token: decodeURIComponent(rest.join('=')), via: 'cookie' };
      }
    }
  }
  return null;
}

/** The single tenant a token was issued for (`organization` claim). */
function tenantAliases(claim: unknown): string[] {
  return Array.isArray(claim)
    ? claim.filter((value): value is string => typeof value === 'string')
    : claim && typeof claim === 'object'
      ? Object.keys(claim)
      : [];
}

export function tenantAliasOf(claim: unknown): string | null {
  const aliases = tenantAliases(claim);
  return aliases.length === 1 ? aliases[0] : null;
}

function tenantCount(claim: unknown): number {
  return tenantAliases(claim).length;
}

/**
 * Who a signed-in request is and what they may do (docs/prd §8.1, §10).
 * Only constructed with sign-in on.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private readonly verifier: Pick<JwtVerifier, 'verify'>;

  constructor(
    readonly config: IamConfig,
    /** Also the identity server's admin client for {@link PeopleService}. */
    readonly membership: MembershipService,
    private readonly tenancy: TenancyService,
    verifier?: Pick<JwtVerifier, 'verify'>,
  ) {
    this.verifier =
      verifier ??
      new JwtVerifier({
        jwksUrl: `${config.internalRealmUrl}/protocol/openid-connect/certs`,
        issuer: config.issuerUrl,
        audience: config.audience,
      });
  }

  /**
   * The principal of a request, verified once and kept on the request.
   * Throws {@link AuthenticationError} without a valid token for a tenant
   * the person still belongs to.
   */
  async authenticate(request: RequestLike): Promise<Principal> {
    if (request.classifyrePrincipal) return request.classifyrePrincipal;
    // No credentials at all, never a bad or expired token: that one stays a
    // 401, so the web renews the session instead of dropping to a visitor.
    if (
      this.config.publicTenantAlias &&
      header(request.headers, 'authorization') === undefined &&
      !tokenOf(request.headers)
    ) {
      const visitor = await this.visitor();
      request.classifyrePrincipal = visitor;
      return visitor;
    }
    const { claims, via } = await this.verified(request);

    const alias = tenantAliasOf(claims.organization);
    if (!alias) {
      throw tenantCount(claims.organization) === 0
        ? new AuthenticationError(
            'This account is not in any tenant yet. A tenant admin adds it to their organization in the identity server.',
            'NO_TENANT',
          )
        : new AuthenticationError(
            'This account is in several tenants. Sign in again and choose one.',
            'CHOOSE_TENANT',
          );
    }
    // The token proves who it was issued to; the identity server says who
    // the person is now. A disabled account or one moved out of the tenant
    // stops working within a minute, not when its token expires.
    const member = await this.membership.membership(claims.sub);
    const org = member.organizations.find(
      (candidate) => candidate.alias === alias,
    );
    if (!member.enabled || !org) {
      throw member.enabled && member.organizations.length === 0
        ? new AuthenticationError(
            'This account is no longer in any tenant.',
            'NO_TENANT',
          )
        : new AuthenticationError(
            'This account no longer has access to that tenant.',
          );
    }
    const tenant = await this.tenancy.ensureTenant(org);
    if (tenant.status !== 'active') {
      throw tenant.status === 'suspended'
        ? new AuthenticationError(
            'This tenant is suspended. Its data is kept; an operator can resume it.',
            'TENANT_SUSPENDED',
          )
        : new AuthenticationError(
            'This tenant has been deleted, with its workspaces.',
            'TENANT_DELETED',
          );
    }
    if (tenant.orgId !== org.id) {
      // An organization deleted and made again under the same alias is not
      // the tenant whose workspaces and grants carry that alias.
      throw new AuthenticationError(
        `Tenant '${alias}' belonged to an organization that was deleted, so its workspaces stay closed. Ask an operator: the deleted organization can only come back from a backup of the identity server.`,
        'TENANT_REPLACED',
      );
    }
    await this.ensureAdmins(tenant, org.id);
    const groupIds = await this.membership.groupIds(claims.sub, org.id);
    const grants = await this.tenancy.grantsFor(tenant.id, groupIds);

    const displayName =
      (typeof claims.name === 'string' && claims.name) ||
      member.displayName ||
      (typeof claims.preferred_username === 'string'
        ? claims.preferred_username
        : null);
    const principal: Principal = {
      sub: claims.sub,
      actor: {
        id: `user:${claims.sub}`,
        displayName,
        kind: 'person',
        via: 'oidc',
        ref: `user:${claims.sub}`,
      },
      tenant,
      orgId: org.id,
      groupIds,
      grants,
      via,
    };
    request.classifyrePrincipal = principal;
    this.rememberName(claims.sub, displayName, member.email);
    return principal;
  }

  private visitorCache: {
    principal: Principal | null;
    until: number;
  } | null = null;

  /**
   * The principal of everyone who has not signed in: Visitor on the public
   * tenant, nothing else. Looked up at most once a minute, also when there
   * is none (not set up, suspended), so anonymous requests never reach the
   * identity server one by one.
   */
  private async visitor(): Promise<Principal> {
    if (!this.visitorCache || this.visitorCache.until <= Date.now()) {
      this.visitorCache = {
        principal: await this.lookUpVisitor(),
        until: Date.now() + 60_000,
      };
    }
    const { principal } = this.visitorCache;
    if (!principal) throw new AuthenticationError('Sign in to continue.');
    return principal;
  }

  private async lookUpVisitor(): Promise<Principal | null> {
    const alias = this.config.publicTenantAlias!;
    const org = await this.membership.organizationByAlias(alias);
    const tenant = org ? await this.tenancy.ensureTenant(org) : null;
    if (
      !org ||
      !tenant ||
      tenant.status !== 'active' ||
      tenant.orgId !== org.id
    ) {
      // Not set up (yet), suspended or replaced: nothing is public.
      return null;
    }
    const principal: Principal = {
      sub: '',
      actor: {
        id: null,
        displayName: null,
        kind: 'visitor',
        via: 'none',
        // Nothing a visitor does is attributed to anyone; they only read.
        ref: undefined,
      },
      tenant,
      orgId: org.id,
      groupIds: new Set(),
      grants: [
        {
          id: 'visitor',
          tenantId: tenant.id,
          subjectType: 'group',
          subjectId: '',
          roleKey: 'visitor',
          scopeType: 'tenant',
          scopeId: tenant.id,
          expiresAt: null,
        },
      ],
      // No credentials at all; it never writes, so no origin check applies.
      via: 'cookie',
      visitor: true,
    };
    return principal;
  }

  /**
   * The operator of a request (Platform routes), verified once and kept on
   * the request. Being in a tenant is not needed; holding
   * {@link OPERATOR_ROLE} now, per the identity server, is.
   */
  async authenticateOperator(request: RequestLike): Promise<Operator | null> {
    if (request.classifyreOperator !== undefined) {
      return request.classifyreOperator;
    }
    const { claims, via } = await this.verified(request);
    const member = await this.membership.membership(claims.sub);
    const operator =
      member.enabled && (await this.isOperator(claims.sub))
        ? {
            sub: claims.sub,
            actor: {
              id: `user:${claims.sub}`,
              displayName: member.displayName,
              kind: 'person' as const,
              via: 'oidc' as const,
              ref: `user:${claims.sub}`,
            },
            via,
          }
        : null;
    request.classifyreOperator = operator;
    if (operator) {
      this.rememberName(claims.sub, member.displayName, member.email);
    }
    return operator;
  }

  async isOperator(sub: string): Promise<boolean> {
    return (await this.membership.realmRoles(sub)).includes(OPERATOR_ROLE);
  }

  private async verified(request: RequestLike): Promise<{
    claims: Awaited<ReturnType<JwtVerifier['verify']>>;
    via: 'bearer' | 'cookie';
  }> {
    const found = tokenOf(request.headers);
    if (!found) throw new AuthenticationError('Sign in to continue.');
    try {
      return {
        claims: await this.verifier.verify(found.token),
        via: found.via,
      };
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw new AuthenticationError(
          `Sign-in not accepted: ${error.message}.`,
        );
      }
      throw error;
    }
  }

  /** Tenants whose `admins` group already has Tenant admin, and when others were last checked. */
  private readonly adminsChecked = new Map<string, number>();

  /**
   * Every tenant's top-level `admins` group gets Tenant admin once, the first
   * time anyone of the tenant signs in; without it nobody could give a grant
   * in a new tenant. Checked at most once a minute while the group is missing.
   */
  private async ensureAdmins(tenant: Tenant, orgId: string): Promise<void> {
    const checked = this.adminsChecked.get(tenant.id);
    if (checked === Infinity) return;
    if (checked && Date.now() - checked < 60_000) return;
    if (!(await this.tenancy.adminsPending(tenant.id))) {
      this.adminsChecked.set(tenant.id, Infinity);
      return;
    }
    const admins = await this.adminsGroup(orgId);
    if (admins && (await this.tenancy.grantAdminsOnce(tenant.id, admins.id))) {
      this.logger.log(`Gave ${admins.path} Tenant admin in ${tenant.alias}`);
    }
    this.adminsChecked.set(tenant.id, admins ? Infinity : Date.now());
  }

  private async adminsGroup(orgId: string) {
    return (await this.membership.groups(orgId)).find(
      (group) => group.parentId === null && group.name === 'admins',
    );
  }

  private readonly namesWritten = new Map<string, number>();

  /** Keeps `iam_principals` current, at most every ten minutes per person. */
  private rememberName(
    sub: string,
    displayName: string | null,
    email: string | null,
  ) {
    const last = this.namesWritten.get(sub) ?? 0;
    if (Date.now() - last < 10 * 60_000) return;
    this.namesWritten.set(sub, Date.now());
    // Never part of signing in: a failed write must not fail the request.
    void Promise.resolve()
      .then(() => this.tenancy.rememberPrincipal(sub, displayName, email))
      .catch(() => {
        // A missing name is cosmetic; the next sign-in writes it.
        this.namesWritten.delete(sub);
      });
  }

  /**
   * The principal an MCP token acts as: its owner, as they are now (docs/prd
   * §8.3). Rebuilt on every call, so a viewer's agent stays read-only, a
   * mover's agent follows the move and a leaver's agent stops. Null when the
   * owner can no longer see the workspace.
   */
  async principalForOwner(
    sub: string,
    tokenId: string,
    namespaceId: string,
  ): Promise<{ principal: Principal; capabilities: Set<Capability> } | null> {
    const tenancy = await this.tenancy.workspaceTenancy(namespaceId);
    const tenant = tenancy
      ? await this.tenancy.tenantById(tenancy.tenantId)
      : null;
    if (!tenant?.orgId || tenant.status !== 'active') return null;
    const member = await this.membership.membership(sub);
    if (
      !member.enabled ||
      !member.organizations.some((org) => org.id === tenant.orgId)
    ) {
      return null;
    }
    const groupIds = await this.membership.groupIds(sub, tenant.orgId);
    const principal: Principal = {
      sub,
      actor: {
        id: `user:${sub}`,
        displayName: member.displayName,
        kind: 'person',
        via: 'mcp-token',
        ref: `user:${sub}@mcp:${tokenId}`,
      },
      tenant,
      orgId: tenant.orgId,
      groupIds,
      grants: await this.tenancy.grantsFor(tenant.id, groupIds),
      via: 'bearer',
    };
    const capabilities = await this.capabilitiesIn(principal, namespaceId);
    if (!capabilities?.has('workspace.view')) return null;
    return { principal, capabilities };
  }

  /**
   * Capabilities in one workspace, or null when the workspace is in another
   * tenant (which must look exactly like a workspace that does not exist).
   */
  async capabilitiesIn(
    principal: Principal,
    namespaceId: string,
  ): Promise<Set<Capability> | null> {
    const tenancy = await this.tenancy.workspaceTenancy(namespaceId);
    if (!tenancy || tenancy.tenantId !== principal.tenant.id) return null;
    const ownerLineage = tenancy.ownerGroupId
      ? await this.membership.ancestry(principal.orgId, tenancy.ownerGroupId)
      : [];
    return capabilitiesInWorkspace(principal.grants, {
      namespaceId,
      ownerLineage,
    });
  }

  /** The owner group of a workspace and the groups above it; empty without an owner. */
  async ownerLineage(
    principal: Principal,
    namespaceId: string,
  ): Promise<string[]> {
    const tenancy = await this.tenancy.workspaceTenancy(namespaceId);
    if (
      !tenancy ||
      tenancy.tenantId !== principal.tenant.id ||
      !tenancy.ownerGroupId
    ) {
      return [];
    }
    return this.membership.ancestry(principal.orgId, tenancy.ownerGroupId);
  }

  /** Every group of the principal's tenant. */
  /**
   * The tenant's groups. `fresh` skips the minute's cache: groups are made,
   * renamed and removed in the identity server, and an admin who just made
   * one expects to find it here.
   */
  groupsOf(principal: Principal, fresh = false): Promise<OrgGroup[]> {
    return this.membership.groups(principal.orgId, { fresh });
  }

  /** Every workspace of the principal's tenant they can see, with what they may do there. */
  async visibleWorkspaces(
    principal: Principal,
  ): Promise<Map<string, Set<Capability>>> {
    const workspaces = await this.tenancy.workspacesOf(principal.tenant.id);
    const visible = new Map<string, Set<Capability>>();
    for (const [namespaceId, tenancy] of workspaces) {
      const ownerLineage = tenancy.ownerGroupId
        ? await this.membership.ancestry(principal.orgId, tenancy.ownerGroupId)
        : [];
      const capabilities = capabilitiesInWorkspace(principal.grants, {
        namespaceId,
        ownerLineage,
      });
      if (capabilities.has('workspace.view'))
        visible.set(namespaceId, capabilities);
    }
    return visible;
  }

  tenantCapabilities(principal: Principal): Set<Capability> {
    return tenantCapabilities(principal.grants);
  }

  /**
   * Whether the principal may create a workspace owned by `ownerGroupId`:
   * they must be in that group (or below it) — an invariant no grant lifts,
   * except for tenant admins — and hold `tenant.workspace.create` on it.
   */
  async canCreateWorkspace(
    principal: Principal,
    ownerGroupId: string,
  ): Promise<boolean> {
    const ownerLineage = await this.membership.ancestry(
      principal.orgId,
      ownerGroupId,
    );
    if (
      !(await this.membership.groups(principal.orgId)).some(
        (g) => g.id === ownerGroupId,
      )
    ) {
      return false;
    }
    const isTenantAdmin = principal.grants.some(
      (grant) =>
        grant.scopeType === 'tenant' && grant.roleKey === 'tenant-admin',
    );
    if (!isTenantAdmin && !principal.groupIds.has(ownerGroupId)) return false;
    return canCreateWorkspaceFor(principal.grants, ownerLineage);
  }

  /** Groups the principal may create workspaces for (§8.2 owning-group picker). */
  async owningGroups(principal: Principal) {
    const groups = await this.membership.groups(principal.orgId);
    const allowed: OrgGroup[] = [];
    for (const group of groups) {
      if (await this.canCreateWorkspace(principal, group.id))
        allowed.push(group);
    }
    return allowed;
  }

  /**
   * First-tenant setup: the tenant row for the bootstrap organization and
   * Tenant admin for its `admins` group (once). Workspaces of installs from
   * before sign-in was always on stay in their open database until an
   * operator copies them (src/admin.ts, docs/prd/TEN §6).
   */
  async bootstrap(): Promise<void> {
    const org = await this.membership.organizationByAlias(
      this.config.bootstrapTenantAlias,
    );
    if (!org) {
      // The chart's setup job creates it right after the realm: a failure the
      // caller retries, not a finished setup.
      throw new Error(
        `Bootstrap tenant '${this.config.bootstrapTenantAlias}' does not exist in the identity server yet`,
      );
    }
    const tenant = await this.tenancy.ensureTenant(org);
    const admins = await this.adminsGroup(org.id);
    if (!admins) {
      // The setup job creates it right after the organization: retried.
      throw new Error(
        `Bootstrap tenant '${org.alias}' has no 'admins' group in the identity server yet`,
      );
    }
    await this.tenancy.grantAdminsOnce(tenant.id, admins.id);
  }
}
