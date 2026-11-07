import type { IdentityService, Operator } from './identity.service';
import type { OrgGroup } from './membership.service';
import { PlatformService } from './platform.service';
import type { Tenant, TenancyService } from './tenancy.service';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GLOBEX_ORG = id(200);

const operator: Operator = {
  sub: id(1),
  actor: {
    id: `user:${id(1)}`,
    displayName: 'Ola Operator',
    kind: 'person',
    via: 'oidc',
    ref: `user:${id(1)}`,
  },
  via: 'bearer',
};

/**
 * docs/prd/TEN §4.7: operators see tenants and suspend them; tenants, their
 * people and groups are made in the identity server, which the API only reads.
 */
describe('PlatformService', () => {
  const originalUrl = process.env.DATABASE_URL;
  beforeAll(() => {
    // Its pool connects lazily; only workspace imports would use it.
    process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
  });
  afterAll(() => {
    process.env.DATABASE_URL = originalUrl;
  });

  let orgs: { id: string; alias: string; name: string }[];
  let groups: Record<string, OrgGroup[]>;
  let tenants: (Tenant & { workspaces: number; upgradeError?: string })[];
  let events: string[];
  let dropped: string[];

  function service() {
    const membership = {
      organizations: () => Promise.resolve(orgs),
      groups: (org: string) => Promise.resolve(groups[org] ?? []),
      groupMemberIds: () => Promise.resolve([]),
      members: () => Promise.resolve([]),
    };
    const identity = { membership } as unknown as IdentityService;
    const tenancy = {
      tenantSummaries: () =>
        Promise.resolve(
          tenants.map((tenant) => ({
            ...tenant,
            createdAt: new Date(0),
            lastActivityAt: null,
            databaseName: null,
            upgradeError: tenant.upgradeError ?? null,
          })),
        ),
      tenantById: (tenantId: string) =>
        Promise.resolve(tenants.find((t) => t.id === tenantId) ?? null),
      ensureTenant: (org: { id: string; alias: string; name: string }) => {
        const tenant = {
          id: `t-${org.alias}`,
          alias: org.alias,
          name: org.name,
          orgId: org.id,
          status: 'active' as const,
          workspaces: 0,
        };
        tenants.push(tenant);
        return Promise.resolve(tenant);
      },
      setSuspended: (tenantId: string, suspended: boolean) => {
        tenants = tenants.map((t) =>
          t.id === tenantId
            ? { ...t, status: suspended ? 'suspended' : 'active' }
            : t,
        );
        return Promise.resolve(true);
      },
      markDeleted: (tenantId: string) => {
        tenants = tenants.map((t) =>
          t.id === tenantId ? { ...t, status: 'deleted' as const } : t,
        );
        return Promise.resolve(2);
      },
      dropDatabaseIfUnused: (tenantId: string) => {
        dropped.push(tenantId);
        return Promise.resolve(true);
      },
      recordTenantEvent: (_t: string, _a: string, action: string) => {
        events.push(action);
        return Promise.resolve();
      },
    } as unknown as TenancyService;
    return new PlatformService(identity, tenancy);
  }

  beforeEach(() => {
    orgs = [{ id: GLOBEX_ORG, alias: 'globex', name: 'Globex' }];
    groups = {};
    tenants = [
      {
        id: 't-globex',
        alias: 'globex',
        name: 'Globex',
        orgId: GLOBEX_ORG,
        status: 'active',
        workspaces: 2,
      },
    ];
    events = [];
    dropped = [];
  });

  it('lists an organization made in the identity server as a tenant', async () => {
    orgs.push({ id: id(400), alias: 'initech', name: 'Initech' });
    const listed = await service().tenants();
    expect(listed.map((tenant) => [tenant.alias, tenant.problem])).toEqual([
      ['globex', 'NO_ADMINS_GROUP'],
      ['initech', 'NO_ADMINS_GROUP'],
    ]);
  });

  it('shows a tenant whose database could not be upgraded', async () => {
    tenants[0] = { ...tenants[0], upgradeError: 'relation "x" does not exist' };
    const [globex] = await service().tenants();
    expect(globex).toMatchObject({
      problem: 'UPGRADE_FAILED',
      upgradeError: 'relation "x" does not exist',
    });
  });

  it('suspends a tenant and records it', async () => {
    const view = await service().setSuspended(operator, 't-globex', true);
    expect(view.status).toBe('suspended');
    expect(events).toEqual(['tenant.suspended']);
  });

  it('removes a tenant only once its organization is gone, after its alias is typed', async () => {
    await expect(
      service().deleteTenant(operator, 't-globex', 'globex'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ORGANIZATION_EXISTS' }),
    });
    orgs = [];
    await expect(
      service().deleteTenant(operator, 't-globex', 'globe'),
    ).rejects.toThrow("Type the tenant's alias");
    await service().deleteTenant(operator, 't-globex', 'globex');
    expect(tenants[0].status).toBe('deleted');
    expect(dropped).toEqual(['t-globex']);
    expect(events).toEqual(['tenant.deleted']);
  });
});
