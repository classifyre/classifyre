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
  const acme = { id: 't-acme', alias: 'acme', name: 'Acme', orgId: 'org-acme' };
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

  function service(member: { enabled: boolean; orgs: string[] }) {
    const membership = {
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
      ancestry: (_org: string, id: string) =>
        Promise.resolve(id === 'ap-team' ? ['ap-team', 'finance'] : [id]),
    } as unknown as MembershipService;
    const tenancy = {
      ensureTenant: () => Promise.resolve(acme),
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
          organization: ['acme'],
        } as VerifiedClaims),
    };
    return new IdentityService(config, membership, tenancy, verifier);
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

  it('refuses a disabled account and one that left the tenant (U11, U12)', async () => {
    await expect(
      service({ enabled: false, orgs: ['acme'] }).authenticate(request()),
    ).rejects.toBeInstanceOf(AuthenticationError);
    await expect(
      service({ enabled: true, orgs: ['globex'] }).authenticate(request()),
    ).rejects.toBeInstanceOf(AuthenticationError);
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
