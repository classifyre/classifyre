import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccessManagementService } from './access-management.service';
import type { Capability } from './capabilities';
import type { IdentityService, Principal } from './identity.service';
import { BUILT_IN_ROLES } from './roles';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import type { Grant, TenancyService } from './tenancy.service';

const roleCaps = (key: string): Set<Capability> =>
  new Set(BUILT_IN_ROLES.find((role) => role.key === key)?.capabilities ?? []);

describe('AccessManagementService', () => {
  const principal = {
    sub: 'u-admin',
    actor: { ref: 'user:u-admin' },
    tenant: { id: 't1', alias: 'acme', name: 'Acme', orgId: 'org1' },
    orgId: 'org1',
    groupIds: new Set(['finance']),
    grants: [],
    via: 'bearer',
  } as unknown as Principal;

  let added: Grant[];
  let events: string[];
  let stored: Grant[];

  const tenancy = {
    addGrant: (grant: Grant) => {
      added.push(grant);
      return Promise.resolve('g-new');
    },
    recordTenantEvent: (_t: string, _a: string, action: string) => {
      events.push(action);
      return Promise.resolve();
    },
    workspaceTenancy: (id: string) =>
      Promise.resolve(
        id === 'ws-other-tenant'
          ? { tenantId: 't2', ownerGroupId: null }
          : { tenantId: 't1', ownerGroupId: 'finance' },
      ),
    principalNames: () => Promise.resolve(new Map()),
    listGrants: () => Promise.resolve(stored),
    grantById: (_t: string, id: string) =>
      Promise.resolve(stored.find((grant) => grant.id === id) ?? null),
    deleteGrant: () => Promise.resolve(),
    tenantByAlias: (alias: string) =>
      Promise.resolve(
        alias === 'acme'
          ? { id: 't1', alias: 'acme', name: 'Acme', orgId: 'org1' }
          : alias === 'globex'
            ? { id: 't2', alias: 'globex', name: 'Globex', orgId: 'org2' }
            : null,
      ),
  } as unknown as TenancyService;

  const identity = {
    membership: {
      membership: (_sub: string) =>
        Promise.resolve({
          enabled: true,
          displayName: 'Admin',
          email: null,
          organizations: [
            { id: 'org1', alias: 'acme', name: 'Acme' },
            { id: 'org9', alias: 'unknown', name: 'Unknown' },
          ],
        }),
    },
    // `east` was just made in the identity server: only a fresh read has it.
    groupsOf: (_p: Principal, fresh = false) =>
      Promise.resolve([
        { id: 'finance', name: 'finance', path: '/finance', parentId: null },
        { id: 'legal', name: 'legal', path: '/legal', parentId: null },
        ...(fresh
          ? [{ id: 'east', name: 'east', path: '/east', parentId: null }]
          : []),
      ]),
    ownerLineage: () => Promise.resolve(['finance']),
  } as unknown as IdentityService;

  // Like the real ones: tenant data can only be read inside a workspace.
  let store: Record<string, string> | null = null;
  const cls = {
    isActive: () => store !== null,
    get: (key: string) => store?.[key],
    set: (key: string, value: string) => {
      if (store) store[key] = value;
    },
    run: async <T>(fn: () => Promise<T>): Promise<T> => {
      const outer = store;
      store = { ...outer };
      try {
        return await fn();
      } finally {
        store = outer;
      }
    },
  };
  const inWorkspace = <T>(rows: Record<string, T>): Promise<T> => {
    const schema = store?.[CLS_SCHEMA];
    if (!schema) throw new Error('PrismaService accessed outside a workspace');
    return Promise.resolve(rows[schema] ?? ([] as unknown as T));
  };
  const registry = {
    get: (id: string) =>
      id === 'ws-gone'
        ? Promise.reject(new NotFoundException('Unknown namespace'))
        : Promise.resolve({ id, slug: id, schemaName: `ns_${id}` }),
  };

  const service = new AccessManagementService(
    tenancy,
    identity,
    {
      source: {
        findMany: () =>
          inWorkspace({ 'ns_ws-q3': [{ id: 's-shop', name: 'Shop lake' }] }),
      },
      asset: {
        findMany: () =>
          inWorkspace({
            'ns_ws-q3': [
              { id: 'a-orders', name: 'orders', sourceId: 's-shop' },
            ],
          }),
      },
    } as never,
    cls as never,
    registry as never,
  );
  const base = {
    subjectType: 'group' as const,
    subjectId: 'legal',
    scopeType: 'workspace' as const,
    scopeId: 'ws-q3',
  };

  beforeEach(() => {
    added = [];
    events = [];
    stored = [];
  });

  it('gives a role the author fully holds, and records it (U6)', async () => {
    const view = await service.addGrant(
      principal,
      { ...base, roleKey: 'viewer' },
      roleCaps('workspace-admin'),
    );
    expect(added).toHaveLength(1);
    expect(events).toEqual(['grant.added']);
    expect(view.subjectLabel).toBe('/legal');
  });

  it('finds a group made in the identity server a moment ago', async () => {
    const view = await service.addGrant(
      principal,
      { ...base, subjectId: 'east', roleKey: 'viewer' },
      roleCaps('workspace-admin'),
    );
    expect(view.subjectLabel).toBe('/east');
  });

  it('refuses to give more than the author holds (no escalation)', async () => {
    await expect(
      service.addGrant(
        principal,
        { ...base, roleKey: 'code-author' },
        roleCaps('workspace-admin'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(added).toHaveLength(0);
  });

  it.each([
    ['a tenant role on a workspace', { roleKey: 'tenant-admin' }],
    ['a workspace manager on a workspace', { roleKey: 'workspace-manager' }],
    ['an unknown role', { roleKey: 'superuser' }],
    [
      'a group from another tenant',
      { roleKey: 'viewer', subjectId: 'globex-sales' },
    ],
    [
      'one person instead of a group',
      { roleKey: 'viewer', subjectType: 'user', subjectId: 'u-ann' },
    ],
    [
      'an expiry in the past',
      { roleKey: 'viewer', expiresAt: '2001-01-01T00:00:00Z' },
    ],
  ])('refuses %s', async (_label, override) => {
    await expect(
      service.addGrant(
        principal,
        { ...base, ...override } as never,
        roleCaps('tenant-admin'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a group for a while, with an end date (U10)', async () => {
    await service.addGrant(
      principal,
      {
        ...base,
        roleKey: 'investigator',
        expiresAt: new Date(Date.now() + 42 * 86_400_000).toISOString(),
      },
      roleCaps('workspace-admin'),
    );
    expect(added[0].expiresAt).toBeInstanceOf(Date);
  });

  it('treats another tenant’s workspace as unknown', async () => {
    await expect(
      service.addGrant(
        principal,
        { ...base, roleKey: 'viewer', scopeId: 'ws-other-tenant' },
        roleCaps('tenant-admin'),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a workspace admin remove only grants made on their workspace', async () => {
    stored = [
      {
        id: 'g-inherited',
        tenantId: 't1',
        subjectType: 'group',
        subjectId: 'finance',
        roleKey: 'viewer',
        scopeType: 'group',
        scopeId: 'finance',
        expiresAt: null,
      },
    ];
    await expect(
      service.removeGrant(principal, 'g-inherited', 'ws-q3'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.removeGrant(principal, 'g-inherited'),
    ).resolves.toMatchObject({ id: 'g-inherited', subjectLabel: '/finance' });
    expect(events).toEqual(['grant.removed']);
  });

  it('never offers the operator role as a grant', () => {
    expect(service.roles().map((role) => role.key)).not.toContain(
      'platform-operator',
    );
  });

  it('lists only the tenants Classifyre knows, current one last marked', async () => {
    const tenants = await service.tenants(principal);
    // `unknown` is an organization without a tenant row: not offered.
    expect(tenants.map((tenant) => tenant.alias)).toEqual(['acme']);
  });

  it("names single-table and single-source grants, and the table's source", async () => {
    stored = [
      {
        ...base,
        id: 'g-src',
        tenantId: 't1',
        roleKey: 'data-reader',
        scopeType: 'source',
        scopeId: 'ws-q3/s-shop',
        expiresAt: null,
      },
      {
        ...base,
        id: 'g-tbl',
        tenantId: 't1',
        roleKey: 'data-reader',
        scopeType: 'asset',
        scopeId: 'ws-q3/a-orders',
        expiresAt: null,
      },
    ] as Grant[];
    const removed = await service.removeGrant(principal, 'g-tbl');
    expect(removed).toMatchObject({ scopeLabel: 'orders', sourceId: 's-shop' });
    const source = await service.removeGrant(principal, 'g-src');
    expect(source).toMatchObject({ scopeLabel: 'Shop lake' });
    expect(source).not.toHaveProperty('sourceId');
  });

  it('names single-source grants in a tenant-wide list, with no current workspace', async () => {
    stored = [
      {
        ...base,
        id: 'g-src',
        tenantId: 't1',
        roleKey: 'data-reader',
        scopeType: 'source',
        scopeId: 'ws-q3/s-shop',
        expiresAt: null,
      },
      {
        ...base,
        id: 'g-gone',
        tenantId: 't1',
        roleKey: 'data-reader',
        scopeType: 'source',
        scopeId: 'ws-gone/s-old',
        expiresAt: null,
      },
    ] as Grant[];
    const list = await service.tenantGrants(principal);
    expect(list.map((grant) => grant.scopeLabel)).toEqual([
      'Shop lake',
      'One source',
    ]);
  });
});
