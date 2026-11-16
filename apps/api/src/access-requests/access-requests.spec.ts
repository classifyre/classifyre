import { CLS_PERSON } from '../identity/iam-access-policy';
import { AccessRequestsService } from './access-requests.service';

/**
 * Access requests (docs/prd/DQ-data-query.md §5.9): asked by a person for a
 * group of theirs, decided by the table's owner (else a steward, or an
 * access manager), approved into an expiring grant no larger than what the
 * decider holds on the table.
 */
const TABLE = {
  assetId: 'a-1',
  sourceId: 's-1',
  name: 'customers',
  sqlName: 'lake.crm.customers',
};

function setup(input: {
  me?: string;
  groups?: string[];
  capabilities?: string[];
  /** Tables the caller queries (by grant or ownership). */
  queries?: string[];
  inClear?: string[];
  roles?: {
    scopeType: 'ASSET' | 'SOURCE';
    role: string;
    principalRef: string;
  }[];
  stored?: Record<string, unknown>[];
  /** The requester's groups when a request is decided. */
  requesterGroups?: string[];
}) {
  const me = input.me ?? 'user:zephyr';
  const stored = [...(input.stored ?? [])];
  const prisma = {
    governanceRole: {
      findMany: jest.fn(({ where }: { where: { scopeType: string } }) =>
        Promise.resolve(
          (input.roles ?? [])
            .filter((role) => role.scopeType === where.scopeType)
            .map((role, i) => ({
              id: `r-${i}`,
              scopeId: role.scopeType === 'ASSET' ? 'a-1' : 's-1',
              dateIn: new Date(0),
              dateOut: null,
              replacedByRef: null,
              assignedBy: null,
              removedBy: null,
              ...role,
            })),
        ),
      ),
    },
    dataAccessRequest: {
      findFirst: jest.fn(() =>
        Promise.resolve(
          stored.find(
            (row) => row.status === 'PENDING' && row.requesterRef === me,
          ) ?? null,
        ),
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(stored.find((row) => row.id === where.id) ?? null),
      ),
      findMany: jest.fn().mockResolvedValue(stored),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: 'req-new',
          status: 'PENDING',
          createdAt: new Date(),
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
          grantExpiresAt: null,
          grantId: null,
          ...data,
        };
        stored.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = stored.find((r) => r.id === where.id)!;
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      ),
    },
  };
  const cls = {
    isActive: () => true,
    get: (key: string) =>
      key === CLS_PERSON
        ? { actorRef: me, groupIds: input.groups ?? ['g-1'] }
        : undefined,
  };
  const caps = new Set(
    input.capabilities ?? ['workspace.view', 'notification.view'],
  );
  const policy = {
    check: jest.fn((_a: unknown, capability: string) =>
      Promise.resolve({ allow: caps.has(capability) }),
    ),
    capabilities: jest.fn(() => Promise.resolve(new Set(caps))),
  };
  const catalog = {
    tables: jest.fn().mockResolvedValue({
      sources: [{ id: 's-1', name: 'Lake', sqlName: 'lake' }],
      tables: [TABLE],
    }),
    scope: jest.fn().mockResolvedValue({
      all: false,
      sourceIds: new Set(),
      assetIds: new Set(input.queries ?? []),
    }),
    clearScope: jest.fn().mockResolvedValue({
      all: false,
      sourceIds: new Set(),
      assetIds: new Set(input.inClear ?? []),
    }),
  };
  const access = {
    identity: {
      membership: {
        groupIds: jest
          .fn()
          .mockResolvedValue(new Set(input.requesterGroups ?? ['g-9'])),
      },
    },
    addGrant: jest.fn(
      (_p: unknown, grant: Record<string, unknown>, _holdings: Set<string>) =>
        Promise.resolve({
          id: 'grant-1',
          subjectLabel: '/team/analysts',
          ...grant,
        }),
    ),
  };
  const notifier = {
    accessRequested: jest.fn().mockResolvedValue(undefined),
    accessDecided: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new AccessRequestsService(
    prisma as never,
    cls as never,
    { current: () => ({ ref: me }), workspaceId: () => 'ws-1' } as never,
    { resolve: jest.fn().mockResolvedValue([]) } as never,
    { record: jest.fn() } as never,
    catalog as never,
    access as never,
    notifier as never,
    policy as never,
  );
  return { svc, prisma, access, notifier, stored };
}

const code = (error: unknown) =>
  (error as { getResponse?: () => { code?: string } }).getResponse?.().code;

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return 'done';
  } catch (error) {
    return code(error) ?? (error as Error).constructor.name;
  }
}

const ask = {
  scopeType: 'asset',
  scopeId: 'a-1',
  groupId: 'g-1',
  reason: 'Monthly churn report for the board',
};

const waiting = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  scopeType: 'ASSET',
  scopeId: 'a-1',
  sourceId: 's-1',
  requesterRef: 'user:quill',
  groupId: 'g-9',
  roleKey: 'data-reader',
  reason: 'Monthly churn report',
  durationDays: 30,
  status: 'PENDING',
  createdAt: new Date(),
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  grantId: null,
  grantExpiresAt: null,
  ...over,
});

const OWNER = {
  scopeType: 'ASSET' as const,
  role: 'OWNER',
  principalRef: 'user:zephyr',
};

describe('asking for access', () => {
  it('asks for a group of theirs and tells the owner', async () => {
    const { svc, notifier } = setup({
      me: 'user:quill',
      roles: [
        OWNER,
        { scopeType: 'SOURCE', role: 'STEWARD', principalRef: 'group:s' },
      ],
    });
    const view = await svc.create(ask);
    expect(view).toMatchObject({
      status: 'PENDING',
      roleKey: 'data-reader',
      durationDays: 90,
    });
    expect(notifier.accessRequested).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['user:zephyr'] }),
    );
  });

  it('goes to the stewards when nobody owns it', async () => {
    const { svc, notifier } = setup({
      me: 'user:quill',
      roles: [
        { scopeType: 'SOURCE', role: 'STEWARD', principalRef: 'group:s' },
      ],
    });
    await svc.create(ask);
    expect(notifier.accessRequested).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['group:s'] }),
    );
  });

  it.each([
    ['for a group they are not in', { groupId: 'g-2' }, {}, 'GROUP_REQUIRED'],
    ['without a reason', { reason: 'pls' }, {}, 'BadRequestException'],
    [
      'for longer than a year',
      { durationDays: 400 },
      {},
      'BadRequestException',
    ],
    [
      'for a role that is not a data role',
      { roleKey: 'workspace-admin' },
      {},
      'BadRequestException',
    ],
    [
      'for what they already query',
      {},
      { queries: ['a-1'] },
      'ALREADY_HAS_ACCESS',
    ],
    [
      'twice',
      {},
      { stored: [waiting({ requesterRef: 'user:zephyr' })] },
      'REQUEST_PENDING',
    ],
  ])('refuses asking %s', async (_, body, setupInput, expected) => {
    const { svc } = setup(setupInput);
    expect(await outcome(() => svc.create({ ...ask, ...body }))).toBe(expected);
  });

  it('lets someone who queries masked ask for the unmasked role', async () => {
    const { svc } = setup({ queries: ['a-1'] });
    expect(
      await outcome(() =>
        svc.create({ ...ask, roleKey: 'data-reader-unmasked' }),
      ),
    ).toBe('done');
  });
});

describe('deciding', () => {
  const principal = { orgId: 'org-1' } as never;

  it('refuses when the requester has left the group the grant goes to', async () => {
    const { svc, access } = setup({
      roles: [OWNER],
      queries: ['a-1'],
      inClear: ['a-1'],
      stored: [waiting()],
      requesterGroups: ['g-2'],
    });
    expect(await outcome(() => svc.approve(principal, 'req-1', {}))).toBe(
      'REQUESTER_LEFT_GROUP',
    );
    expect(access.addGrant).not.toHaveBeenCalled();
  });

  it('lets the owner approve into an expiring grant on the table for the group', async () => {
    const { svc, access, notifier } = setup({
      roles: [OWNER],
      queries: ['a-1'],
      inClear: ['a-1'],
      stored: [waiting()],
    });
    const view = await svc.approve(principal, 'req-1', {});
    expect(view.status).toBe('APPROVED');
    const [, grant, holdings] = access.addGrant.mock.calls[0];
    expect(grant).toMatchObject({
      subjectType: 'group',
      subjectId: 'g-9',
      roleKey: 'data-reader',
      scopeType: 'asset',
      scopeId: 'ws-1/a-1',
    });
    const days =
      (Date.parse(grant.expiresAt as string) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    expect([...holdings]).toEqual(
      expect.arrayContaining(['data.query', 'data.connect', 'data.unmask']),
    );
    expect(notifier.accessDecided).toHaveBeenCalledWith(
      expect.objectContaining({ approved: true, requesterRef: 'user:quill' }),
    );
  });

  it('refuses the unmasked role from a decider who does not read it in clear', async () => {
    const { svc } = setup({
      capabilities: [
        'workspace.view',
        'notification.view',
        'access.manage',
        'data.query',
        'data.connect',
      ],
      queries: ['a-1'],
      stored: [waiting({ roleKey: 'data-reader-unmasked' })],
    });
    expect(await outcome(() => svc.approve(principal, 'req-1', {}))).toBe(
      'GRANT_EXCEEDS_OWN_ACCESS',
    );
  });

  it('lets that decider give Data reader instead', async () => {
    const { svc, access } = setup({
      capabilities: [
        'workspace.view',
        'notification.view',
        'access.manage',
        'data.query',
        'data.connect',
      ],
      queries: ['a-1'],
      stored: [waiting({ roleKey: 'data-reader-unmasked' })],
    });
    await svc.approve(principal, 'req-1', { roleKey: 'data-reader' });
    expect(access.addGrant.mock.calls[0][1]).toMatchObject({
      roleKey: 'data-reader',
    });
  });

  it('never gives more than asked', async () => {
    const { svc } = setup({
      roles: [OWNER],
      queries: ['a-1'],
      inClear: ['a-1'],
      stored: [waiting()],
    });
    expect(
      await outcome(() =>
        svc.approve(principal, 'req-1', { roleKey: 'data-reader-unmasked' }),
      ),
    ).toBe('BadRequestException');
  });

  it('hides the request from someone who does not decide it', async () => {
    const { svc } = setup({
      roles: [{ ...OWNER, principalRef: 'user:cleo' }],
      stored: [waiting()],
    });
    expect(await outcome(() => svc.approve(principal, 'req-1', {}))).toBe(
      'NotFoundException',
    );
    expect(await svc.list({ view: 'decide' })).toEqual([]);
  });

  it('refuses deciding your own request', async () => {
    const { svc } = setup({
      capabilities: ['workspace.view', 'access.manage'],
      stored: [waiting({ requesterRef: 'user:zephyr' })],
    });
    expect(await outcome(() => svc.deny('req-1', {}))).toBe('OWN_REQUEST');
  });

  it('declines with a note for the requester', async () => {
    const { svc, notifier } = setup({ roles: [OWNER], stored: [waiting()] });
    const view = await svc.deny('req-1', { note: 'Use the aggregated table' });
    expect(view).toMatchObject({
      status: 'DENIED',
      decisionNote: 'Use the aggregated table',
    });
    expect(notifier.accessDecided).toHaveBeenCalledWith(
      expect.objectContaining({
        approved: false,
        note: 'Use the aggregated table',
      }),
    );
  });

  it('lets only the requester withdraw', async () => {
    const mine = setup({ me: 'user:quill', stored: [waiting()] });
    expect((await mine.svc.withdraw('req-1')).status).toBe('WITHDRAWN');
    const other = setup({ stored: [waiting()] });
    expect(await outcome(() => other.svc.withdraw('req-1'))).toBe(
      'NotFoundException',
    );
  });
});
