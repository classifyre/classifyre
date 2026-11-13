import { ConnectionRightsService } from './connection-rights.service';

function rights(options: {
  caps?: string[];
  person?: { actorRef: string; groupIds: string[] } | null;
  rolesFor?: (refs: string[]) => number;
  recipient?: { capabilities: string[]; groups: string[] } | null;
}) {
  const counted: string[][] = [];
  const prisma = {
    governanceRole: {
      count: ({ where }: { where: { principalRef: { in: string[] } } }) => {
        counted.push(where.principalRef.in);
        return Promise.resolve(options.rolesFor?.(where.principalRef.in) ?? 0);
      },
    },
  };
  const cls = {
    isActive: () => true,
    get: () => options.person ?? undefined,
  };
  const actors = { current: () => ({}), workspaceId: () => 'ns-1' };
  const policy = {
    check: (_a: unknown, cap: string) =>
      Promise.resolve({ allow: (options.caps ?? []).includes(cap) }),
  };
  const identity = {
    principalFor: () =>
      Promise.resolve(
        options.recipient
          ? {
              principal: { groupIds: new Set(options.recipient.groups) },
              capabilities: new Set(options.recipient.capabilities),
            }
          : null,
      ),
    groupLineage: () => Promise.resolve(options.recipient?.groups ?? []),
  };
  return {
    service: new ConnectionRightsService(
      prisma as never,
      cls as never,
      actors as never,
      policy as never,
      identity as never,
    ),
    counted,
  };
}

describe('ConnectionRightsService', () => {
  it('lets managers and role holders connect to everything, no one else', async () => {
    expect(
      await rights({
        caps: ['data.connection.manage'],
      }).service.canConnectAll(),
    ).toBe(true);
    const steward = rights({
      person: { actorRef: 'user:s', groupIds: ['g1'] },
      rolesFor: (refs) => (refs.includes('group:g1') ? 1 : 0),
    });
    expect(await steward.service.canConnectAll()).toBe(true);
    expect(steward.counted[0]).toEqual(['user:s', 'group:g1']);
    const reader = rights({ person: { actorRef: 'user:r', groupIds: [] } });
    expect(await reader.service.canConnectAll()).toBe(false);
  });

  it('judges the recipient of a given connection by the recipient’s rights', async () => {
    // The giver is a manager; the recipient holds nothing.
    const plain = rights({
      caps: ['data.connection.manage'],
      recipient: { capabilities: ['workspace.view'], groups: ['g2'] },
    });
    expect(await plain.service.personMayConnectAll('user:r')).toBe(false);
    expect(plain.counted[0]).toEqual(['user:r', 'group:g2']);
    const custodian = rights({
      recipient: { capabilities: [], groups: ['ops'] },
      rolesFor: (refs) => (refs.includes('group:ops') ? 1 : 0),
    });
    expect(await custodian.service.personMayConnectAll('user:c')).toBe(true);
    const admin = rights({
      recipient: { capabilities: ['data.connection.manage'], groups: [] },
    });
    expect(await admin.service.personMayConnectAll('user:a')).toBe(true);
    expect(
      await rights({ recipient: null }).service.personMayConnectAll('user:x'),
    ).toBe(false);
    expect(await rights({}).service.personMayConnectAll('group:g')).toBe(false);
  });
});
