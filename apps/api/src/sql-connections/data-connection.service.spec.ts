import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataConnectionService } from './data-connection.service';

interface Options {
  canConnect?: boolean;
  canManage?: boolean;
  canConnectAll?: boolean;
  recipientMayConnectAll?: boolean;
  governs?: (scopeId: string) => boolean;
}

function setup(options: Options = {}) {
  const created: Record<string, unknown>[] = [];
  const named: { scope: unknown; mustQuery: boolean }[] = [];
  const audited: string[] = [];
  const prisma = {
    dataConnection: {
      findUnique: () => Promise.resolve(null),
      create: ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({
          id: 'c1',
          blocks: [],
          revokedAt: null,
          expiresAt: new Date(Date.now() + 86_400_000),
          scramStoredKey: data.scramStoredKey ?? null,
          scopeSourceIds: data.scopeSourceIds,
          scopeAssetIds: data.scopeAssetIds,
          ...data,
        });
      },
    },
  };
  const rights = {
    me: () => 'user:me',
    person: () => ({ actorRef: 'user:me', groupIds: [] }),
    canConnect: () => Promise.resolve(options.canConnect ?? true),
    canManage: () => Promise.resolve(options.canManage ?? false),
    canConnectAll: () => Promise.resolve(options.canConnectAll ?? false),
    personMayConnectAll: () =>
      Promise.resolve(options.recipientMayConnectAll ?? false),
    refuse: () => {
      throw new ForbiddenException();
    },
  };
  const exposures = {
    assertNamedScope: (scope: unknown, opts: { mustQuery: boolean }) => {
      named.push({ scope, mustQuery: opts.mustQuery });
      return Promise.resolve();
    },
    names: () => Promise.resolve(new Map()),
  };
  const governance = {
    mayGovernScope: ({ scopeId }: { scopeId: string }) =>
      Promise.resolve({
        allowed: options.governs?.(scopeId) ?? false,
        name: scopeId,
        sourceId: 's1',
      }),
    tenantMember: () =>
      Promise.resolve({ username: 'ana', email: 'ana@example.com' }),
  };
  const service = new DataConnectionService(
    prisma as never,
    { isActive: () => false } as never,
    { current: () => ({ ref: 'user:me' }) } as never,
    {
      record: (e: { operation: string }) => audited.push(e.operation),
    } as never,
    governance as never,
    { connectionChanged: () => Promise.resolve() } as never,
    rights as never,
    exposures as never,
  );
  return { service, created, named, audited };
}

const SCOPE_REQUIRED = {
  response: expect.objectContaining({ code: 'SCOPE_REQUIRED' }),
};

describe('DataConnectionService', () => {
  describe('create (one’s own)', () => {
    it('needs the right to connect at all', async () => {
      const { service } = setup({ canConnect: false });
      await expect(
        service.create({ name: 'BI', scope: ['asset:a1'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses "everything" to people who may not have it', async () => {
      const { service, created } = setup({ canConnectAll: false });
      await expect(service.create({ name: 'BI' })).rejects.toMatchObject(
        SCOPE_REQUIRED,
      );
      expect(created).toHaveLength(0);
    });

    it('allows "everything" to admins and role holders', async () => {
      const { service, created, audited } = setup({ canConnectAll: true });
      const secret = await service.create({ name: 'BI' });
      expect(secret.password).toHaveLength(32);
      expect(created[0]).toMatchObject({
        scopeSourceIds: [],
        scopeAssetIds: [],
      });
      expect(created[0]).not.toHaveProperty('password');
      expect(audited).toEqual(['data-connections.create']);
    });

    it('checks named sources and tables are open and readable', async () => {
      const { service, named } = setup();
      await service.create({ name: 'BI', scope: ['asset:a1'] });
      expect(named).toEqual([
        { scope: { sourceIds: [], assetIds: ['a1'] }, mustQuery: true },
      ]);
    });
  });

  describe('issue (to someone else)', () => {
    it('does not let an owner or steward give a connection for everything', async () => {
      const { service, created } = setup({
        canManage: false,
        governs: () => true,
      });
      await expect(
        service.issue({ name: 'BI', personRef: 'user:r' }),
      ).rejects.toMatchObject(SCOPE_REQUIRED);
      expect(created).toHaveLength(0);
    });

    it('gives "everything" only to a recipient who may have it', async () => {
      const refused = setup({ canManage: true, recipientMayConnectAll: false });
      await expect(
        refused.service.issue({ name: 'BI', personRef: 'user:r' }),
      ).rejects.toMatchObject(SCOPE_REQUIRED);
      const given = setup({ canManage: true, recipientMayConnectAll: true });
      await given.service.issue({ name: 'BI', personRef: 'user:r' });
      expect(given.created[0]).toMatchObject({
        personRef: 'user:r',
        scopeAssetIds: [],
      });
    });

    it('lets an owner give one only for what they govern', async () => {
      const { service } = setup({ governs: (id) => id === 'a1' });
      await expect(
        service.issue({ name: 'BI', personRef: 'user:r', scope: ['asset:a2'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      const ok = setup({ governs: (id) => id === 'a1' });
      await ok.service.issue({
        name: 'BI',
        personRef: 'user:r',
        scope: ['asset:a1'],
      });
      expect(ok.named).toEqual([
        { scope: { sourceIds: [], assetIds: ['a1'] }, mustQuery: false },
      ]);
      expect(ok.created[0]).toMatchObject({ issuedBy: 'user:me' });
      expect(ok.created[0]).not.toHaveProperty('scramStoredKey');
    });

    it('still checks a manager’s named scope is open', async () => {
      const { service, named } = setup({ canManage: true });
      await service.issue({
        name: 'BI',
        personRef: 'user:r',
        scope: ['source:s1'],
      });
      expect(named[0]).toMatchObject({ mustQuery: false });
    });
  });

  describe('endpoint', () => {
    const keys = [
      'SQL_GATEWAY_ENABLED',
      'SQL_GATEWAY_PUBLIC_HOST',
      'SQL_GATEWAY_PUBLIC_PORT',
    ] as const;
    const saved: Partial<Record<string, string | undefined>> = {};
    beforeEach(() => {
      for (const key of keys) {
        saved[key] = process.env[key];
        delete process.env[key];
      }
    });
    afterEach(() => {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });

    it('is off when the deployment has no gateway', () => {
      const { service } = setup();
      expect(service.endpoint()).toMatchObject({
        enabled: false,
        configured: false,
        host: null,
      });
    });

    it('is on but not configured while no public host is set', () => {
      process.env.SQL_GATEWAY_ENABLED = 'true';
      process.env.SQL_GATEWAY_PUBLIC_HOST = '  ';
      const { service } = setup();
      expect(service.endpoint()).toMatchObject({
        enabled: true,
        configured: false,
        host: null,
      });
    });

    it('is configured with a public host, on the port given', () => {
      process.env.SQL_GATEWAY_ENABLED = 'true';
      process.env.SQL_GATEWAY_PUBLIC_HOST = 'sql.example.com';
      process.env.SQL_GATEWAY_PUBLIC_PORT = '5433';
      const { service } = setup();
      expect(service.endpoint()).toMatchObject({
        enabled: true,
        configured: true,
        host: 'sql.example.com',
        port: 5433,
      });
    });

    it('is not on just because a host is set: the gateway has to be on', () => {
      process.env.SQL_GATEWAY_PUBLIC_HOST = 'sql.example.com';
      const { service } = setup();
      expect(service.endpoint()).toMatchObject({
        enabled: false,
        configured: true,
      });
    });
  });

  it('refuses a person outside the tenant', async () => {
    const { service } = setup({
      canManage: true,
      recipientMayConnectAll: true,
    });
    (
      service as unknown as {
        governance: { tenantMember: () => Promise<null> };
      }
    ).governance.tenantMember = () => Promise.resolve(null);
    await expect(
      service.issue({ name: 'BI', personRef: 'user:x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
