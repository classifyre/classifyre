import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccessManagementService } from './access-management.service';
import type { Capability } from './capabilities';
import type { IdentityService, Principal } from './identity.service';
import { BUILT_IN_ROLES } from './roles';
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
  } as unknown as TenancyService;

  const identity = {
    groupsOf: () =>
      Promise.resolve([
        { id: 'finance', name: 'finance', path: '/finance', parentId: null },
        { id: 'legal', name: 'legal', path: '/legal', parentId: null },
      ]),
    isMember: (_p: Principal, sub: string) => Promise.resolve(sub === 'u-ann'),
    ownerLineage: () => Promise.resolve(['finance']),
  } as unknown as IdentityService;

  const service = new AccessManagementService(tenancy, identity);
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
      'a person outside the tenant',
      { roleKey: 'viewer', subjectType: 'user', subjectId: 'u-x' },
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

  it('accepts a person of the tenant with an end date (U10)', async () => {
    await service.addGrant(
      principal,
      {
        ...base,
        subjectType: 'user',
        subjectId: 'u-ann',
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
    ).resolves.toBeUndefined();
    expect(events).toEqual(['grant.removed']);
  });

  it('says there is nothing to manage without sign-in', () => {
    const off = new AccessManagementService(tenancy, null);
    expect(() => off.requireSignIn()).toThrow(ConflictException);
    expect(off.roles().map((role) => role.key)).not.toContain(
      'platform-operator',
    );
  });
});
