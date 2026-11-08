import { generateKeyPairSync, sign, type KeyObject } from 'crypto';
import { assertIamAllowed, readIamConfig } from './iam-config';
import {
  canCreateWorkspaceFor,
  capabilitiesInWorkspace,
  tenantCapabilities,
} from './grant-evaluation';
import {
  AuthenticationError,
  IdentityService,
  tenantAliasOf,
  tokenOf,
} from './identity.service';
import {
  InvalidTokenError,
  JwtVerifier,
  type VerifiedClaims,
} from './jwt-verifier';
import type { MembershipService } from './membership.service';
import type { Grant, TenancyService } from './tenancy.service';

const ISSUER = 'https://classifyre.example/iam/realms/classifyre';

function keyPair(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  return {
    kid,
    privateKey,
    jwk: {
      ...publicKey.export({ format: 'jwk' }),
      kid,
      use: 'sig',
      alg: 'RS256',
    },
  };
}

function signToken(
  privateKey: KeyObject,
  kid: string,
  claims: Record<string, unknown>,
): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = encode({ alg: 'RS256', kid, typ: 'JWT' });
  const body = encode(claims);
  const signature = sign('sha256', Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${signature.toString('base64url')}`;
}

describe('JwtVerifier', () => {
  const current = keyPair('k1');
  const rotated = keyPair('k2');
  let published = [current.jwk];
  let fetches = 0;
  const fetchImpl = (() => {
    fetches += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ keys: published }), { status: 200 }),
    );
  }) as typeof fetch;
  const verifier = new JwtVerifier({
    jwksUrl: 'http://iam/certs',
    issuer: ISSUER,
    audience: 'classifyre-api',
    fetchImpl,
  });
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: 'u1',
    iss: ISSUER,
    aud: ['classifyre-api', 'account'],
    exp: now + 300,
    organization: ['acme'],
  };

  it('accepts a token signed with a published key', async () => {
    await expect(
      verifier.verify(signToken(current.privateKey, 'k1', claims)),
    ).resolves.toMatchObject({ sub: 'u1', organization: ['acme'] });
  });

  it.each([
    ['another issuer', { iss: 'https://evil.example/realms/x' }],
    ['another audience', { aud: 'account' }],
    ['an expired token', { exp: now - 3600 }],
    ['no subject', { sub: '' }],
  ])('refuses %s', async (_label, override) => {
    await expect(
      verifier.verify(
        signToken(current.privateKey, 'k1', { ...claims, ...override }),
      ),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it.each([
    ['no algorithm', 'none'],
    ['a symmetric algorithm', 'HS256'],
    ['another algorithm than the key is published for', 'RS512'],
  ])('refuses %s', async (_label, alg) => {
    const token = signToken(current.privateKey, 'k1', claims);
    const [, body, signature] = token.split('.');
    const head = Buffer.from(
      JSON.stringify({ alg, kid: 'k1', typ: 'JWT' }),
    ).toString('base64url');
    await expect(
      verifier.verify(`${head}.${body}.${signature}`),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('refuses a signature made with another key under a known key id', async () => {
    await expect(
      verifier.verify(signToken(rotated.privateKey, 'k1', claims)),
    ).rejects.toThrow('Bad signature');
  });

  it('fetches the keys again when a token names a new key id', async () => {
    published = [current.jwk, rotated.jwk];
    // The refetch interval keeps a flood of unknown ids from hammering the server.
    (verifier as unknown as { lastFetch: number }).lastFetch = 0;
    const before = fetches;
    await expect(
      verifier.verify(signToken(rotated.privateKey, 'k2', claims)),
    ).resolves.toMatchObject({ sub: 'u1' });
    expect(fetches).toBe(before + 1);
  });
});

describe('request tokens and tenants', () => {
  it('takes a bearer token but leaves MCP tokens to the MCP handler', () => {
    expect(tokenOf({ authorization: 'Bearer abc.def.ghi' })).toEqual({
      token: 'abc.def.ghi',
      via: 'bearer',
    });
    expect(tokenOf({ authorization: 'Bearer inmcp_x.y' })).toBeNull();
  });

  it('reads the session cookie', () => {
    expect(tokenOf({ cookie: 'theme=dark; cf_session=a.b.c' })).toEqual({
      token: 'a.b.c',
      via: 'cookie',
    });
  });

  it('needs exactly one tenant in the organization claim', () => {
    expect(tenantAliasOf(['acme'])).toBe('acme');
    expect(tenantAliasOf({ acme: {} })).toBe('acme');
    expect(tenantAliasOf(['acme', 'globex'])).toBeNull();
    expect(tenantAliasOf(undefined)).toBeNull();
  });
});

describe('grant evaluation', () => {
  const ws = (namespaceId: string, ownerLineage: string[] = []) => ({
    namespaceId,
    ownerLineage,
  });

  it('applies tenant, workspace and owning-group grants (U1, U4, U7)', () => {
    const grants = [
      {
        scopeType: 'group' as const,
        scopeId: 'finance',
        roleKey: 'viewer' as const,
      },
      {
        scopeType: 'workspace' as const,
        scopeId: 'ws-q3',
        roleKey: 'investigator' as const,
      },
    ];
    // Owned by /finance/ap-team: the /finance grant covers it through the lineage.
    const owned = capabilitiesInWorkspace(
      grants,
      ws('ws-ap', ['ap-team', 'finance']),
    );
    expect(owned.has('workspace.view')).toBe(true);
    expect(owned.has('source.manage')).toBe(false);

    const q3 = capabilitiesInWorkspace(grants, ws('ws-q3', ['sales']));
    expect(q3.has('case.edit')).toBe(true);

    // Sales' workspace: nothing applies, so it is invisible.
    expect(
      capabilitiesInWorkspace(grants, ws('ws-sales', ['sales'])).size,
    ).toBe(0);
  });

  it('keeps cases away from a source manager (U3)', () => {
    const capabilities = capabilitiesInWorkspace(
      [{ scopeType: 'tenant', scopeId: 't', roleKey: 'source-manager' }],
      ws('ws'),
    );
    expect(capabilities.has('source.manage')).toBe(true);
    expect(capabilities.has('case.view')).toBe(false);
  });

  it('lets a workspace manager create only for their group and below (U5)', () => {
    const grants = [
      {
        scopeType: 'group' as const,
        scopeId: 'finance',
        roleKey: 'workspace-manager' as const,
      },
    ];
    expect(canCreateWorkspaceFor(grants, ['finance'])).toBe(true);
    expect(canCreateWorkspaceFor(grants, ['ap-team', 'finance'])).toBe(true);
    expect(canCreateWorkspaceFor(grants, ['sales'])).toBe(false);
    expect(
      canCreateWorkspaceFor([{ ...grants[0], roleKey: 'viewer' }], ['finance']),
    ).toBe(false);
  });

  it('only counts tenant-wide grants for tenant capabilities', () => {
    expect(
      tenantCapabilities([
        { scopeType: 'group', roleKey: 'tenant-admin' },
        { scopeType: 'tenant', roleKey: 'auditor' },
      ]).has('tenant.access.manage'),
    ).toBe(false);
  });
});

describe('sign-in configuration', () => {
  const env = {
    IAM_ENABLED: 'true',
    IAM_ISSUER_URL: `${ISSUER}/`,
    IAM_INTERNAL_URL: 'http://classifyre-iam:8080/iam',
    IAM_REALM: 'classifyre',
    IAM_API_CLIENT_ID: 'classifyre-api',
    IAM_API_CLIENT_SECRET: 's',
    IAM_APP_URL: 'https://classifyre.example/',
  };

  it('is off unless IAM_ENABLED=true', () => {
    expect(readIamConfig({})).toBeNull();
  });

  it('reads the chart environment', () => {
    expect(readIamConfig(env)).toMatchObject({
      issuerUrl: ISSUER,
      adminUrl: 'http://classifyre-iam:8080/iam/admin/realms/classifyre',
      appOrigin: 'https://classifyre.example',
      bootstrapTenantAlias: 'default',
    });
  });

  it('refuses to start in the all-in-one Docker image', () => {
    expect(() => assertIamAllowed({ ...env, ENVIRONMENT: 'docker' })).toThrow(
      /not supported in the all-in-one Docker image/,
    );
    expect(() => assertIamAllowed({ ENVIRONMENT: 'docker' })).not.toThrow();
  });

  it('refuses to start without the internal key (scan callbacks stay closed)', () => {
    expect(() => assertIamAllowed(env)).toThrow(/CLASSIFYRE_INTERNAL_KEY/);
    expect(() =>
      assertIamAllowed({
        ...env,
        CLASSIFYRE_INTERNAL_KEY: 'k',
        CLASSIFYRE_TENANT_DATABASE_KEY: 't',
      }),
    ).not.toThrow();
  });

  it('refuses to start without the key of the tenant databases', () => {
    expect(() =>
      assertIamAllowed({ ...env, CLASSIFYRE_INTERNAL_KEY: 'k' }),
    ).toThrow(/CLASSIFYRE_TENANT_DATABASE_KEY/);
  });
});

describe('IdentityService', () => {
  const config = readIamConfig({
    IAM_ENABLED: 'true',
    IAM_ISSUER_URL: ISSUER,
    IAM_INTERNAL_URL: 'http://iam',
    IAM_REALM: 'classifyre',
    IAM_API_CLIENT_ID: 'classifyre-api',
    IAM_API_CLIENT_SECRET: 's',
  })!;
  const acme = {
    id: 't-acme',
    alias: 'acme',
    name: 'Acme',
    orgId: 'org-acme',
    status: 'active' as const,
  };
  const grants: Grant[] = [
    {
      id: 'g1',
      tenantId: 't-acme',
      subjectType: 'group',
      subjectId: 'finance',
      roleKey: 'viewer',
      scopeType: 'group',
      scopeId: 'finance',
      expiresAt: null,
    },
  ];

  let pending: boolean;
  let adminGrants: string[];
  let tenantOrg: string;
  let orgClaim: unknown;
  let tenantStatus: 'active' | 'suspended' | 'deleted';
  let realmRoles: string[];

  beforeEach(() => {
    orgClaim = ['acme'];
    tenantStatus = 'active';
    realmRoles = [];
    pending = false;
    adminGrants = [];
    tenantOrg = 'org-acme';
  });

  function service(
    member: { enabled: boolean; orgs: string[] },
    cfg: typeof config = config,
  ) {
    const membership = {
      organizationByAlias: (alias: string) =>
        Promise.resolve(
          alias === 'acme' ? { id: 'org-acme', alias, name: 'Acme' } : null,
        ),
      membership: () =>
        Promise.resolve({
          enabled: member.enabled,
          displayName: 'Ada Kowalczyk',
          email: null,
          organizations: member.orgs.map((alias) => ({
            id: `org-${alias}`,
            alias,
            name: alias,
          })),
        }),
      groupIds: () => Promise.resolve(new Set(['finance'])),
      groups: () =>
        Promise.resolve([
          { id: 'admins', name: 'admins', path: '/admins', parentId: null },
          { id: 'finance', name: 'finance', path: '/finance', parentId: null },
        ]),
      ancestry: (_org: string, id: string) =>
        Promise.resolve(id === 'ap-team' ? ['ap-team', 'finance'] : [id]),
      realmRoles: () => Promise.resolve(realmRoles),
    } as unknown as MembershipService;
    const tenancy = {
      ensureTenant: () =>
        Promise.resolve({ ...acme, orgId: tenantOrg, status: tenantStatus }),
      tenantById: () =>
        Promise.resolve({ ...acme, orgId: tenantOrg, status: tenantStatus }),
      adminsPending: () => Promise.resolve(pending),
      grantAdminsOnce: (_tenant: string, group: string) => {
        adminGrants.push(group);
        pending = false;
        return Promise.resolve(true);
      },
      rememberPrincipal: () => Promise.resolve(),
      grantsFor: () => Promise.resolve(grants),
      workspaceTenancy: (id: string) =>
        Promise.resolve(
          id === 'ws-globex'
            ? { tenantId: 't-globex', ownerGroupId: 'finance' }
            : id === 'ws-sales'
              ? { tenantId: 't-acme', ownerGroupId: 'sales' }
              : { tenantId: 't-acme', ownerGroupId: 'ap-team' },
        ),
    } as unknown as TenancyService;
    const verifier = {
      verify: () =>
        Promise.resolve({
          sub: 'u1',
          iss: ISSUER,
          exp: 0,
          organization: orgClaim,
        } as VerifiedClaims),
    };
    return new IdentityService(cfg, membership, tenancy, verifier);
  }

  const request = () => ({ headers: { authorization: 'Bearer a.b.c' } });

  it('builds the principal from the token and the identity server', async () => {
    const principal = await service({
      enabled: true,
      orgs: ['acme'],
    }).authenticate(request());
    expect(principal.actor).toEqual({
      id: 'user:u1',
      displayName: 'Ada Kowalczyk',
      kind: 'person',
      via: 'oidc',
      ref: 'user:u1',
    });
    expect(principal.tenant.alias).toBe('acme');
  });

  describe('a public tenant (IAM step 8e)', () => {
    const publicConfig = { ...config, publicTenantAlias: 'acme' };
    const anonymous = () => ({ headers: {} });

    it('makes someone without credentials a visitor who may only read it', async () => {
      const identity = service({ enabled: true, orgs: [] }, publicConfig);
      const visitor = await identity.authenticate(anonymous());
      expect(visitor).toMatchObject({
        visitor: true,
        sub: '',
        tenant: { alias: 'acme' },
        actor: { kind: 'visitor', ref: undefined },
      });
      const capabilities = await identity.capabilitiesIn(visitor, 'ws-ledger');
      expect(capabilities?.has('finding.view')).toBe(true);
      expect(capabilities?.has('access.view')).toBe(false);
      expect(capabilities?.has('mcp.token.own')).toBe(false);
      expect(capabilities?.has('source.manage')).toBe(false);
      expect(
        identity.tenantCapabilities(visitor).has('tenant.audit.view'),
      ).toBe(false);
      // Another tenant's workspace does not exist for a visitor.
      expect(await identity.capabilitiesIn(visitor, 'ws-globex')).toBeNull();
    });

    it('never turns a request with a token into a visitor', async () => {
      orgClaim = [];
      const identity = service({ enabled: true, orgs: [] }, publicConfig);
      await expect(
        identity.authenticate({ headers: { cookie: 'cf_session=a.b.c' } }),
      ).rejects.toMatchObject({ code: 'NO_TENANT' });
    });

    it('signs people in to their own tenant as before', async () => {
      orgClaim = ['acme'];
      const principal = await service(
        { enabled: true, orgs: ['acme'] },
        publicConfig,
      ).authenticate(request());
      expect(principal.visitor).toBeUndefined();
      expect(principal.actor.kind).toBe('person');
    });

    it('has no visitors without a public tenant, or while it is suspended', async () => {
      await expect(
        service({ enabled: true, orgs: [] }).authenticate(anonymous()),
      ).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' });
      tenantStatus = 'suspended';
      await expect(
        service({ enabled: true, orgs: [] }, publicConfig).authenticate(
          anonymous(),
        ),
      ).rejects.toMatchObject({ code: 'SIGN_IN_REQUIRED' });
    });
  });

  it('refuses the people of a suspended or deleted tenant (TEN §4.7)', async () => {
    for (const status of ['suspended', 'deleted'] as const) {
      tenantStatus = status;
      await expect(
        service({ enabled: true, orgs: ['acme'] }).authenticate(request()),
      ).rejects.toMatchObject({ code: 'TENANT_SUSPENDED' });
    }
  });

  it("stops a suspended tenant's MCP agents too", async () => {
    tenantStatus = 'suspended';
    expect(
      await service({ enabled: true, orgs: ['acme'] }).principalForOwner(
        'u1',
        'tok',
        'ws-ledger',
      ),
    ).toBeNull();
  });

  it('lets an operator in without a tenant, and nobody else (TEN §4.7)', async () => {
    orgClaim = [];
    realmRoles = ['default-roles-classifyre', 'classifyre-operator'];
    const operator = await service({
      enabled: true,
      orgs: [],
    }).authenticateOperator(request());
    expect(operator?.actor.ref).toBe('user:u1');

    realmRoles = ['default-roles-classifyre'];
    expect(
      await service({ enabled: true, orgs: [] }).authenticateOperator(
        request(),
      ),
    ).toBeNull();

    realmRoles = ['classifyre-operator'];
    expect(
      await service({ enabled: false, orgs: [] }).authenticateOperator(
        request(),
      ),
    ).toBeNull();
  });

  it('refuses a disabled account and one that left the tenant (U11, U12)', async () => {
    await expect(
      service({ enabled: false, orgs: ['acme'] }).authenticate(request()),
    ).rejects.toBeInstanceOf(AuthenticationError);
    await expect(
      service({ enabled: true, orgs: ['globex'] }).authenticate(request()),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("gives a new tenant's admins group Tenant admin on its first sign-in, once", async () => {
    pending = true;
    const identity = service({ enabled: true, orgs: ['acme'] });
    await identity.authenticate(request());
    await identity.authenticate(request());
    expect(adminGrants).toEqual(['admins']);
  });

  it('refuses a tenant whose organization was made again under its alias', async () => {
    tenantOrg = 'org-old';
    await expect(
      service({ enabled: true, orgs: ['acme'] }).authenticate(request()),
    ).rejects.toThrow(/organization that was deleted/);
  });

  it('tells a person in no tenant from one in several (NO_TENANT, CHOOSE_TENANT)', async () => {
    orgClaim = undefined;
    await expect(
      service({ enabled: true, orgs: [] }).authenticate(request()),
    ).rejects.toMatchObject({ code: 'NO_TENANT' });
    orgClaim = ['acme', 'globex'];
    await expect(
      service({ enabled: true, orgs: ['acme', 'globex'] }).authenticate(
        request(),
      ),
    ).rejects.toMatchObject({ code: 'CHOOSE_TENANT' });
    // Removed from every organization after the token was issued.
    orgClaim = ['acme'];
    await expect(
      service({ enabled: true, orgs: [] }).authenticate(request()),
    ).rejects.toMatchObject({ code: 'NO_TENANT' });
  });

  it('refuses a request without a token', async () => {
    await expect(
      service({ enabled: true, orgs: ['acme'] }).authenticate({ headers: {} }),
    ).rejects.toThrow('Sign in to continue.');
  });

  it('hides other tenants and workspaces no grant covers (H7, U4)', async () => {
    const identity = service({ enabled: true, orgs: ['acme'] });
    const principal = await identity.authenticate(request());
    expect(await identity.capabilitiesIn(principal, 'ws-globex')).toBeNull();
    expect((await identity.capabilitiesIn(principal, 'ws-sales'))?.size).toBe(
      0,
    );
    expect(
      (await identity.capabilitiesIn(principal, 'ws-ap'))?.has(
        'workspace.view',
      ),
    ).toBe(true);
  });
});
