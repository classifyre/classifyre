import { Injectable } from '@nestjs/common';
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
  sub: string;
  actor: Actor;
  tenant: Tenant;
  orgId: string;
  groupIds: Set<string>;
  grants: Grant[];
  /** How the token arrived: a cookie needs a same-origin check on writes. */
  via: 'bearer' | 'cookie';
}

export class AuthenticationError extends Error {
  constructor(
    message: string,
    /** True when the person is signed in but must pick one of several tenants. */
    readonly chooseTenant = false,
  ) {
    super(message);
  }
}

interface RequestLike {
  headers?: Record<string, unknown>;
  classifyrePrincipal?: Principal | null;
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
export function tenantAliasOf(claim: unknown): string | null {
  const aliases = Array.isArray(claim)
    ? claim.filter((value): value is string => typeof value === 'string')
    : claim && typeof claim === 'object'
      ? Object.keys(claim)
      : [];
  return aliases.length === 1 ? aliases[0] : null;
}

/**
 * Who a signed-in request is and what they may do (docs/prd §8.1, §10).
 * Only constructed with sign-in on.
 */
@Injectable()
export class IdentityService {
  private readonly verifier: Pick<JwtVerifier, 'verify'>;

  constructor(
    readonly config: IamConfig,
    private readonly membership: MembershipService,
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
    const found = tokenOf(request.headers);
    if (!found) throw new AuthenticationError('Sign in to continue.');

    let claims;
    try {
      claims = await this.verifier.verify(found.token);
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw new AuthenticationError(
          `Sign-in not accepted: ${error.message}.`,
        );
      }
      throw error;
    }

    const alias = tenantAliasOf(claims.organization);
    if (!alias) {
      throw new AuthenticationError(
        'The sign-in is not for exactly one tenant. Sign in again and choose one.',
        true,
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
      throw new AuthenticationError(
        'This account no longer has access to that tenant.',
      );
    }
    const tenant = await this.tenancy.ensureTenant(org);
    const groupIds = await this.membership.groupIds(claims.sub, org.id);
    const grants = await this.tenancy.grantsFor(
      tenant.id,
      claims.sub,
      groupIds,
    );

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
      via: found.via,
    };
    request.classifyrePrincipal = principal;
    this.rememberName(claims.sub, displayName, member.email);
    return principal;
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
    if (!tenant?.orgId) return null;
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
      grants: await this.tenancy.grantsFor(tenant.id, sub, groupIds),
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
  groupsOf(principal: Principal): Promise<OrgGroup[]> {
    return this.membership.groups(principal.orgId);
  }

  /** Whether a person (subject id) belongs to the principal's tenant. */
  async isMember(principal: Principal, sub: string): Promise<boolean> {
    const member = await this.membership.membership(sub);
    return (
      member.enabled &&
      member.organizations.some((org) => org.id === principal.orgId)
    );
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
   * First-tenant setup when sign-in is turned on: the tenant row for the
   * bootstrap organization, Tenant admin for its `admins` group, and every
   * workspace that ran without sign-in moved into it.
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
    const admins = (await this.membership.groups(org.id)).find(
      (group) => group.parentId === null && group.name === 'admins',
    );
    await this.tenancy.adoptLocalWorkspaces(tenant, admins?.id ?? null);
  }
}
