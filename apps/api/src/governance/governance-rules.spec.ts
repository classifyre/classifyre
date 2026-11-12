import { BadRequestException } from '@nestjs/common';
import { governanceAssetWhere } from './governance-filter';
import {
  canGovern,
  checklist,
  effectiveRoles,
  effectiveStatus,
  holdsRole,
  principalError,
  type RoleRow,
} from './governance-rules';

let seq = 0;
function row(over: Partial<RoleRow>): RoleRow {
  seq += 1;
  return {
    id: `r${seq}`,
    scopeType: 'ASSET',
    scopeId: 'a1',
    role: 'OWNER',
    principalRef: 'user:alice',
    dateIn: new Date(2026, 0, seq),
    dateOut: null,
    replacedByRef: null,
    assignedBy: null,
    removedBy: null,
    ...over,
  };
}

describe('governance rules (GOV R1–R3)', () => {
  describe('principalError', () => {
    it('makes the owner one person', () => {
      expect(principalError('OWNER', 'user:alice')).toBeNull();
      expect(principalError('OWNER', 'group:finance')).toMatch(/one person/);
    });
    it('makes the custodian a team', () => {
      expect(principalError('CUSTODIAN', 'group:platform')).toBeNull();
      expect(principalError('CUSTODIAN', 'user:bob')).toMatch(/group/);
    });
    it('lets a steward be a person or a group', () => {
      expect(principalError('STEWARD', 'user:bob')).toBeNull();
      expect(principalError('STEWARD', 'group:finance')).toBeNull();
    });
    it('refuses tokens, agents and plain names', () => {
      expect(principalError('STEWARD', 'mcp:t1')).not.toBeNull();
      expect(principalError('STEWARD', 'agent:autopilot')).not.toBeNull();
      expect(principalError('STEWARD', 'Alice')).not.toBeNull();
      expect(principalError('OWNER', 'user:alice@mcp:t1')).not.toBeNull();
    });
  });

  describe('effectiveRoles', () => {
    const sourceOwner = row({ scopeType: 'SOURCE', scopeId: 's1' });
    const sourceSteward = row({
      scopeType: 'SOURCE',
      scopeId: 's1',
      role: 'STEWARD',
      principalRef: 'group:finance',
    });
    const sourceCustodian = row({
      scopeType: 'SOURCE',
      scopeId: 's1',
      role: 'CUSTODIAN',
      principalRef: 'group:platform',
    });

    it('inherits every kind from the source when the asset sets none', () => {
      const roles = effectiveRoles(
        [],
        [sourceOwner, sourceSteward, sourceCustodian],
      );
      expect(roles.map((r) => [r.role, r.inherited])).toEqual([
        ['OWNER', true],
        ['STEWARD', true],
        ['CUSTODIAN', true],
      ]);
    });

    it("lets an asset's own role replace the source's, per kind", () => {
      const ownSteward = row({ role: 'STEWARD', principalRef: 'user:bob' });
      const roles = effectiveRoles([ownSteward], [sourceOwner, sourceSteward]);
      expect(roles.map((r) => [r.role, r.principalRef, r.inherited])).toEqual([
        ['OWNER', 'user:alice', true],
        ['STEWARD', 'user:bob', false],
      ]);
    });

    it('ignores ended roles', () => {
      const ended = row({ principalRef: 'user:carol', dateOut: new Date() });
      expect(effectiveRoles([ended], [sourceOwner])).toEqual([
        expect.objectContaining({
          principalRef: 'user:alice',
          inherited: true,
        }),
      ]);
    });
  });

  describe('holdsRole and canGovern', () => {
    const steward = row({ role: 'STEWARD', principalRef: 'group:finance' });
    const owner = row({ principalRef: 'user:alice' });

    it('names a person directly or through a group', () => {
      expect(holdsRole([owner], { actorRef: 'user:alice', groupIds: [] })).toBe(
        true,
      );
      expect(
        holdsRole([steward], { actorRef: 'user:bob', groupIds: ['finance'] }),
      ).toBe(true);
      expect(
        holdsRole([steward], { actorRef: 'user:bob', groupIds: ['sales'] }),
      ).toBe(false);
    });

    it('does not count custodians or ended roles', () => {
      const custodian = row({
        role: 'CUSTODIAN',
        principalRef: 'group:platform',
      });
      const ended = row({ principalRef: 'user:bob', dateOut: new Date() });
      const bob = { actorRef: 'user:bob', groupIds: ['platform'] };
      expect(holdsRole([custodian, ended], bob)).toBe(false);
    });

    it('allows the capability, or an owner or steward, and no one else', () => {
      expect(canGovern({ hasCapability: true, person: null, rows: [] })).toBe(
        true,
      );
      expect(
        canGovern({
          hasCapability: false,
          person: { actorRef: 'user:alice', groupIds: [] },
          rows: [owner],
        }),
      ).toBe(true);
      expect(
        canGovern({
          hasCapability: false,
          person: { actorRef: 'user:mallory', groupIds: [] },
          rows: [owner, steward],
        }),
      ).toBe(false);
      expect(
        canGovern({ hasCapability: false, person: null, rows: [owner] }),
      ).toBe(false);
    });
  });

  describe('effectiveStatus and checklist', () => {
    it('is ungoverned without an owner, whatever was written', () => {
      expect(effectiveStatus({ status: 'ACTIVE' }, false)).toBeNull();
      expect(effectiveStatus(null, true)).toBe('DRAFT');
      expect(effectiveStatus({ status: 'DEPRECATED' }, true)).toBe(
        'DEPRECATED',
      );
    });

    it('lists what is missing', () => {
      const roles = effectiveRoles([row({})], []);
      const items = checklist({
        roles,
        description: '  ',
        approvedTerms: 2,
        status: 'DRAFT',
      });
      expect(Object.fromEntries(items.map((i) => [i.key, i.done]))).toEqual({
        owner: true,
        steward: false,
        description: false,
        meaning: true,
        certified: false,
      });
    });
  });
});

describe('governanceAssetWhere (GOV §5.6)', () => {
  const rows = [
    {
      scopeType: 'ASSET',
      scopeId: 'a1',
      role: 'OWNER',
      principalRef: 'user:alice',
    },
    {
      scopeType: 'SOURCE',
      scopeId: 's1',
      role: 'OWNER',
      principalRef: 'user:bob',
    },
    {
      scopeType: 'SOURCE',
      scopeId: 's2',
      role: 'STEWARD',
      principalRef: 'group:finance',
    },
  ];
  const db = {
    governanceRole: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          rows.filter((r) => {
            if (where.role && r.role !== where.role) return false;
            if (where.scopeType && r.scopeType !== where.scopeType)
              return false;
            const refs = (where.principalRef as { in?: string[] } | undefined)
              ?.in;
            if (refs && !refs.includes(r.principalRef)) return false;
            return true;
          }),
        ),
      ),
    },
  } as never;

  it('is null without governance filters', async () => {
    expect(await governanceAssetWhere(db, {}, null)).toBeNull();
  });

  it('splits owned and ungoverned by asset and source owners', async () => {
    expect(
      await governanceAssetWhere(db, { governance: 'governed' }, null),
    ).toEqual({
      AND: [
        {
          OR: [{ id: { in: ['a1'] } }, { sourceId: { in: ['s1'] } }],
        },
      ],
    });
    expect(
      await governanceAssetWhere(db, { governance: 'ungoverned' }, null),
    ).toEqual({
      AND: [
        {
          AND: [{ id: { notIn: ['a1'] } }, { sourceId: { notIn: ['s1'] } }],
        },
      ],
    });
  });

  it("gives a source's owner the assets without an owner of their own", async () => {
    expect(
      await governanceAssetWhere(db, { ownerRef: 'user:bob' }, null),
    ).toEqual({
      AND: [
        {
          OR: [
            { id: { in: [] } },
            {
              AND: [{ sourceId: { in: ['s1'] } }, { id: { notIn: ['a1'] } }],
            },
          ],
        },
      ],
    });
  });

  it('reads `me` as the person, and their groups for stewards', async () => {
    const where = await governanceAssetWhere(
      db,
      { stewardRef: 'me' },
      { actorRef: 'user:carol', groupIds: ['finance'] },
    );
    expect(where).toEqual({
      AND: [{ OR: [{ id: { in: [] } }, { sourceId: { in: ['s2'] } }] }],
    });
  });

  it('refuses unknown values and `me` without a person', async () => {
    await expect(
      governanceAssetWhere(db, { governance: 'owned' }, null),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      governanceAssetWhere(db, { ownerRef: 'me' }, null),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
