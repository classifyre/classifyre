import type { IdentityService, Operator } from './identity.service';
import type { OrgGroup } from './membership.service';
import { PeopleService } from './people.service';
import { PlatformService } from './platform.service';
import type { Tenant, TenancyService } from './tenancy.service';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NEW_ORG = id(100);
const NEW_ADMINS = id(101);
const NEW_USER = id(102);
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

/** docs/prd/TEN §4.7: operators create and delete tenants. */
describe('PlatformService', () => {
  const originalUrl = process.env.DATABASE_URL;
  beforeAll(() => {
    // Its pool connects lazily; only workspace imports would use it.
    process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/test';
  });
  afterAll(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
  });

  let sent: string[];
  let failOn: string | null;
  let orgs: { id: string; alias: string; name: string }[];
  let groups: Record<string, OrgGroup[]>;
  let members: Record<string, string[]>;
  let tenants: (Tenant & { workspaces: number })[];
  let created: Set<string>;
  let events: string[];
  let adminGrants: string[];
  let forgotten: string[];

  function service() {
    const respond = (status: number, location?: string) =>
      Promise.resolve(
        new Response(null, {
          status,
          headers: location ? { location: `http://iam/x/${location}` } : {},
        }),
      );
    const membership = {
      organizations: () => Promise.resolve(orgs),
      organizationByAlias: (alias: string) =>
        Promise.resolve(orgs.find((org) => org.alias === alias) ?? null),
      groups: (org: string) => Promise.resolve(groups[org] ?? []),
      groupMemberIds: () => Promise.resolve([]),
      members: (org: string) =>
        Promise.resolve(
          (members[org] ?? []).map((user) => ({
            id: user,
            username: user,
            email: `${user}@example.test`,
            firstName: null,
            lastName: null,
            enabled: true,
            fromDirectory: false,
          })),
        ),
      read: (path: string) => {
        if (path.includes('email=')) return Promise.resolve([]);
        const user = /members\/([^/]+)\/organizations/.exec(path)?.[1] ?? '';
        return Promise.resolve(
          Object.entries(members)
            .filter(([, users]) => users.includes(user))
            .map(([org]) => ({ id: org })),
        );
      },
      send: (method: string, path: string, body?: { alias?: string }) => {
        const call = `${method} ${path}`;
        sent.push(call);
        if (failOn && call.startsWith(failOn)) return respond(500);
        if (call === 'POST /organizations') {
          orgs.push({ id: NEW_ORG, alias: body!.alias!, name: 'Acme' });
          return respond(201, NEW_ORG);
        }
        if (call === `POST /organizations/${NEW_ORG}/groups`) {
          groups[NEW_ORG] = [
            { id: NEW_ADMINS, name: 'admins', path: '/admins', parentId: null },
          ];
          return respond(201, NEW_ADMINS);
        }
        if (call === 'POST /users') return respond(201, NEW_USER);
        if (call.endsWith('/members') && method === 'POST') {
          members[path.split('/')[2]] = [
            ...(members[path.split('/')[2]] ?? []),
            NEW_USER,
          ];
          return respond(201);
        }
        if (method === 'DELETE' && path.startsWith('/organizations/')) {
          delete members[path.split('/')[2]];
        }
        return respond(204);
      },
      forget: () => undefined,
    };
    const identity = {
      membership,
      config: { peopleManagement: true },
    } as unknown as IdentityService;
    const summaries = () =>
      tenants.map((tenant) => ({
        ...tenant,
        createdAt: new Date(0),
        lastActivityAt: null,
      }));
    const tenancy = {
      tenantSummaries: () => Promise.resolve(summaries()),
      tenantByAlias: (alias: string) =>
        Promise.resolve(tenants.find((t) => t.alias === alias) ?? null),
      tenantById: (tenantId: string) =>
        Promise.resolve(tenants.find((t) => t.id === tenantId) ?? null),
      ensureTenant: (org: { id: string; alias: string; name: string }) => {
        const existing = tenants.find((t) => t.alias === org.alias);
        if (existing) return Promise.resolve(existing);
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
      forgetNewTenant: (tenantId: string) => {
        forgotten.push(tenantId);
        tenants = tenants.filter((t) => t.id !== tenantId);
        return Promise.resolve();
      },
      grantAdminsOnce: (_t: string, group: string) => {
        adminGrants.push(group);
        return Promise.resolve(true);
      },
      createdPeople: () => Promise.resolve(created),
      rememberCreatedPerson: (sub: string) => {
        created.add(sub);
        return Promise.resolve();
      },
      markDeleted: (tenantId: string) => {
        tenants = tenants.map((t) =>
          t.id === tenantId ? { ...t, status: 'deleted' as const } : t,
        );
        return Promise.resolve([...created]);
      },
      recordTenantEvent: (_t: string, _a: string, action: string) => {
        events.push(action);
        return Promise.resolve();
      },
    } as unknown as TenancyService;
    return new PlatformService(
      identity,
      tenancy,
      new PeopleService(identity, tenancy),
    );
  }

  const acme = {
    name: 'Acme',
    alias: 'acme',
    adminEmail: 'ada@example.test',
    adminFirstName: 'Ada',
    adminLastName: 'Kowalczyk',
  };

  beforeEach(() => {
    sent = [];
    failOn = null;
    orgs = [{ id: GLOBEX_ORG, alias: 'globex', name: 'Globex' }];
    groups = {};
    members = { [GLOBEX_ORG]: [] };
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
    created = new Set();
    events = [];
    adminGrants = [];
    forgotten = [];
  });

  it('creates the organization, its admins group and a first admin with a temporary password', async () => {
    const { tenant, temporaryPassword } = await service().createTenant(
      operator,
      acme,
    );
    expect(tenant.alias).toBe('acme');
    expect(temporaryPassword).toMatch(/.{20}/);
    expect(sent).toEqual([
      'POST /organizations',
      `POST /organizations/${NEW_ORG}/groups`,
      'POST /users',
      `PUT /users/${NEW_USER}/reset-password`,
      `POST /organizations/${NEW_ORG}/members`,
      `PUT /organizations/${NEW_ORG}/groups/${NEW_ADMINS}/members/${NEW_USER}`,
    ]);
    expect(adminGrants).toEqual([NEW_ADMINS]);
    expect(events).toEqual([
      'person.added',
      'group.member_added',
      'tenant.created',
    ]);
  });

  it('leaves nothing behind when a step fails', async () => {
    failOn = `POST /organizations/${NEW_ORG}/members`;
    await expect(service().createTenant(operator, acme)).rejects.toThrow(
      'could not add the person to the tenant',
    );
    expect(sent).toContain(`DELETE /users/${NEW_USER}`);
    expect(sent).toContain(`DELETE /organizations/${NEW_ORG}`);
    expect(forgotten).toEqual(['t-acme']);
  });

  it.each([
    [{ ...acme, alias: 'globex' }, 'is taken'],
    [{ ...acme, alias: 'local' }, "'local' is kept"],
    [{ ...acme, alias: 'Not An Alias' }, 'lowercase letters'],
    [{ ...acme, name: '' }, 'Enter a name'],
  ])(
    'refuses %o before touching the identity server',
    async (input, message) => {
      await expect(service().createTenant(operator, input)).rejects.toThrow(
        message,
      );
      expect(sent).toEqual([]);
    },
  );

  it('keeps the alias of a deleted tenant reserved', async () => {
    tenants[0].status = 'deleted';
    orgs = [];
    await expect(
      service().createTenant(operator, { ...acme, alias: 'globex' }),
    ).rejects.toThrow('also by tenants deleted earlier');
  });

  it('deletes only an empty tenant, after its alias is typed', async () => {
    await expect(
      service().deleteTenant(operator, 't-globex', 'globex'),
    ).rejects.toThrow('still has 2 workspace(s)');
    tenants[0].workspaces = 0;
    await expect(
      service().deleteTenant(operator, 't-globex', 'acme'),
    ).rejects.toThrow("Type the tenant's alias");

    created = new Set([id(300)]);
    await service().deleteTenant(operator, 't-globex', 'globex');
    expect(sent).toEqual([
      `DELETE /organizations/${GLOBEX_ORG}`,
      `DELETE /users/${id(300)}`,
    ]);
    expect(tenants[0].status).toBe('deleted');
    expect(events).toEqual(['tenant.deleted']);
  });

  it('lists an organization made in the console as a tenant', async () => {
    orgs.push({ id: id(400), alias: 'initech', name: 'Initech' });
    const listed = await service().tenants();
    expect(listed.map((tenant) => [tenant.alias, tenant.problem])).toEqual([
      ['globex', 'NO_ADMINS_GROUP'],
      ['initech', 'NO_ADMINS_GROUP'],
    ]);
  });
});
