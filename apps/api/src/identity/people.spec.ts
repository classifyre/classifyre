import type { IdentityService, Principal } from './identity.service';
import type { OrgGroup } from './membership.service';
import { descendants, PeopleService } from './people.service';
import type { TenancyService, WorkspaceTenancy } from './tenancy.service';

const ORG = 'org-acme';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = id(1);
const ADA = id(2);
const OUTSIDER = id(3);
const ADMINS = id(10);
const FINANCE = id(11);
const AP = id(12);
const GLOBEX_GROUP = id(20);

const principal = {
  sub: ME,
  orgId: ORG,
  tenant: { id: 't-acme', alias: 'acme', name: 'Acme', orgId: ORG },
  actor: { ref: `user:${ME}` },
} as unknown as Principal;

describe('PeopleService', () => {
  let sent: string[];
  let groups: OrgGroup[];
  let groupMembers: Record<string, string[]>;
  let orgsOf: Record<string, string[]>;
  let usersByEmail: Record<string, { id: string; email: string }[]>;
  let created: Set<string>;
  let owned: WorkspaceTenancy[];
  let statusFor: (method: string, path: string) => number;
  let peopleManagement: boolean;
  let deletedGrants: string[][];

  function service() {
    const membership = {
      groups: () => Promise.resolve(groups),
      members: () =>
        Promise.resolve(
          Object.entries(orgsOf)
            .filter(([, orgs]) => orgs.includes(ORG))
            .map(([user]) => ({
              id: user,
              username: user,
              email: `${user}@example.test`,
              firstName: null,
              lastName: null,
              enabled: true,
              fromDirectory: false,
            })),
        ),
      groupMemberIds: (_org: string, group: string) =>
        Promise.resolve(groupMembers[group] ?? []),
      read: (path: string) => {
        const email = /email=([^&]+)/.exec(path)?.[1];
        if (email)
          return Promise.resolve(usersByEmail[decodeURIComponent(email)] ?? []);
        const member = /members\/([^/]+)\/organizations/.exec(path)?.[1];
        return Promise.resolve(
          (orgsOf[member ?? ''] ?? []).map((org) => ({ id: org })),
        );
      },
      send: (method: string, path: string) => {
        sent.push(`${method} ${path}`);
        const status = statusFor(method, path);
        const headers =
          method === 'POST' && path === '/users'
            ? { location: `http://iam/admin/realms/r/users/${ADA}` }
            : undefined;
        if (status < 300 && method === 'POST' && path === '/users')
          orgsOf[ADA] = [];
        if (status < 300 && method === 'POST' && path.endsWith('/members')) {
          orgsOf[ADA] = [ORG];
        }
        if (status < 300 && method === 'POST' && path.endsWith('/groups')) {
          groups.push({
            id: id(30),
            name: 'sales',
            path: '/sales',
            parentId: null,
          });
        }
        return Promise.resolve(new Response(null, { status, headers }));
      },
      forget: () => undefined,
    };
    const identity = {
      membership,
      config: { peopleManagement },
    } as unknown as IdentityService;
    const tenancy = {
      createdPeople: () => Promise.resolve(created),
      createdHere: (sub: string) => Promise.resolve(created.has(sub)),
      rememberCreatedPerson: (sub: string) => {
        created.add(sub);
        return Promise.resolve();
      },
      forgetCreatedPerson: (sub: string) => {
        created.delete(sub);
        return Promise.resolve();
      },
      workspacesOf: () =>
        Promise.resolve(new Map(owned.map((ws, i) => [`ws-${i}`, ws]))),
      deleteGroupGrants: (_t: string, ids: string[]) => {
        deletedGrants.push(ids);
        return Promise.resolve(2);
      },
      deletePersonGrants: () => Promise.resolve(0),
      recordTenantEvent: () => Promise.resolve(),
    } as unknown as TenancyService;
    return new PeopleService(identity, tenancy);
  }

  beforeEach(() => {
    sent = [];
    groups = [
      { id: ADMINS, name: 'admins', path: '/admins', parentId: null },
      { id: FINANCE, name: 'finance', path: '/finance', parentId: null },
      { id: AP, name: 'ap', path: '/finance/ap', parentId: FINANCE },
    ];
    groupMembers = { [ADMINS]: [ME] };
    orgsOf = { [ME]: [ORG], [OUTSIDER]: ['org-globex'] };
    usersByEmail = {};
    created = new Set();
    owned = [];
    statusFor = (method) => (method === 'POST' ? 201 : 204);
    peopleManagement = true;
    deletedGrants = [];
  });

  describe('the tenant boundary', () => {
    it("never touches another tenant's group or person", async () => {
      const people = service();
      await expect(
        people.addToGroup(principal, GLOBEX_GROUP, ME),
      ).rejects.toThrow('No such group');
      await expect(
        people.addToGroup(principal, FINANCE, OUTSIDER),
      ).rejects.toThrow('No such person');
      await expect(people.removePerson(principal, OUTSIDER)).rejects.toThrow(
        'No such person',
      );
      await expect(
        people.renameGroup(principal, '../../users', { name: 'x' }),
      ).rejects.toThrow('No such group');
      expect(sent).toEqual([]);
    });

    it("refuses someone else's account like an unusable address, without adding it", async () => {
      usersByEmail['bo@globex.test'] = [
        { id: OUTSIDER, email: 'bo@globex.test' },
      ];
      await expect(
        service().addPerson(principal, {
          email: 'bo@globex.test',
          firstName: 'Bo',
          lastName: 'Lind',
        }),
      ).rejects.toMatchObject({ response: { code: 'PERSON_UNAVAILABLE' } });
      expect(sent).toEqual([]);
    });

    it('refuses every write when the directory owns membership', async () => {
      peopleManagement = false;
      await expect(
        service().createGroup(principal, { name: 'sales' }),
      ).rejects.toMatchObject({
        response: { code: 'PEOPLE_MANAGED_ELSEWHERE' },
      });
      expect(sent).toEqual([]);
    });
  });

  describe('people', () => {
    it('creates an account with a temporary password and adds it to the tenant', async () => {
      const result = await service().addPerson(principal, {
        email: 'Ada@Example.test',
        firstName: 'Ada',
        lastName: 'Kowalczyk',
      });
      expect(result.temporaryPassword).toMatch(/^[\w-]{20}$/);
      expect(sent).toEqual([
        'POST /users',
        `PUT /users/${ADA}/reset-password`,
        `POST /organizations/${ORG}/members`,
      ]);
      expect(created.has(ADA)).toBe(true);
      expect(result.person.createdHere).toBe(true);
    });

    it('deletes the new account again when it cannot join the tenant', async () => {
      statusFor = (method, path) =>
        path.endsWith('/members') ? 500 : method === 'POST' ? 201 : 204;
      await expect(
        service().addPerson(principal, {
          email: 'ada@example.test',
          firstName: 'Ada',
          lastName: 'K',
        }),
      ).rejects.toThrow('could not add the person');
      expect(sent).toContain(`DELETE /users/${ADA}`);
      expect(created.has(ADA)).toBe(false);
    });

    it('keeps a tenant from locking itself out', async () => {
      const people = service();
      await expect(people.removePerson(principal, ME)).rejects.toThrow(
        'cannot remove yourself',
      );
      await expect(
        people.removeFromGroup(principal, ADMINS, ME),
      ).rejects.toThrow('cannot remove yourself from admins');
      orgsOf[ADA] = [ORG];
      groupMembers[ADMINS] = [ADA];
      await expect(
        people.removeFromGroup(principal, ADMINS, ADA),
      ).rejects.toThrow('at least one admin');
      expect(sent).toEqual([]);
    });

    it('deletes an account made here once it is in no tenant, and only that one', async () => {
      orgsOf[ADA] = [ORG];
      groupMembers[FINANCE] = [ADA];
      created.add(ADA);
      // The identity server takes them out of the organization.
      statusFor = (method, path) => {
        if (method === 'DELETE' && path.endsWith(`/members/${ADA}`)) {
          orgsOf[ADA] = [];
        }
        return 204;
      };
      await expect(service().removePerson(principal, ADA)).resolves.toEqual({
        accountDeleted: true,
      });
      expect(sent).toEqual([
        `DELETE /organizations/${ORG}/groups/${FINANCE}/members/${ADA}`,
        `DELETE /organizations/${ORG}/members/${ADA}`,
        `DELETE /users/${ADA}`,
      ]);
    });

    it('sets passwords only for accounts made here', async () => {
      orgsOf[ADA] = [ORG];
      await expect(service().resetPassword(principal, ADA)).rejects.toThrow(
        'not created in Classifyre',
      );
      created.add(ADA);
      await expect(
        service().resetPassword(principal, ADA),
      ).resolves.toMatchObject({ temporaryPassword: expect.any(String) });
    });
  });

  describe('groups', () => {
    it('keeps admins as it is', async () => {
      const people = service();
      await expect(
        people.renameGroup(principal, ADMINS, { name: 'owners' }),
      ).rejects.toThrow('keeps its name');
      await expect(people.deleteGroup(principal, ADMINS)).rejects.toThrow(
        'cannot be deleted',
      );
    });

    it('keeps a group that owns workspaces, below it too', async () => {
      owned = [{ tenantId: 't-acme', ownerGroupId: AP }];
      await expect(
        service().deleteGroup(principal, FINANCE),
      ).rejects.toMatchObject({ response: { code: 'GROUP_OWNS_WORKSPACES' } });
      expect(sent).toEqual([]);
    });

    it('deletes a group with the grants of its whole subtree', async () => {
      await service().deleteGroup(principal, FINANCE);
      expect(sent).toEqual([`DELETE /organizations/${ORG}/groups/${FINANCE}`]);
      expect(deletedGrants).toEqual([[FINANCE, AP]]);
    });

    it('creates a group inside one of its own', async () => {
      await expect(
        service().createGroup(principal, { name: 'a/b' }),
      ).rejects.toThrow('cannot contain "/"');
      await service().createGroup(principal, { name: 'sales' });
      expect(sent).toEqual([`POST /organizations/${ORG}/groups`]);
      await expect(
        service().createGroup(principal, { name: 'x', parentId: GLOBEX_GROUP }),
      ).rejects.toThrow('No such group');
    });
  });

  it('walks the whole subtree', () => {
    expect(descendants(groups, FINANCE)).toEqual([FINANCE, AP]);
  });
});
