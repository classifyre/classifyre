import {
  NamespacePurgeService,
  parseRetentionDays,
} from './namespace-purge.service';

describe('parseRetentionDays', () => {
  const original = process.env.NAMESPACE_RETENTION_DAYS;
  afterEach(() => {
    if (original === undefined) delete process.env.NAMESPACE_RETENTION_DAYS;
    else process.env.NAMESPACE_RETENTION_DAYS = original;
  });

  it('defaults to a week', () => {
    expect(parseRetentionDays(undefined)).toBe(7);
    expect(parseRetentionDays('')).toBe(7);
  });

  it('accepts zero as "never purge"', () => {
    expect(parseRetentionDays('0')).toBe(0);
  });

  it('rejects nonsense rather than silently keeping data forever', () => {
    // Number('abc') is NaN, and NaN milliseconds would make every comparison
    // false — the purge would quietly do nothing instead of failing loudly.
    expect(() => parseRetentionDays('abc')).toThrow(/NAMESPACE_RETENTION_DAYS/);
    expect(() => parseRetentionDays('-1')).toThrow(/NAMESPACE_RETENTION_DAYS/);
  });
});

describe('NamespacePurgeService', () => {
  const expired = [
    {
      id: 'a',
      slug: 'old-one',
      schemaName: 'ns_a',
      type: 'local',
      deletedAt: new Date(0),
    },
    {
      id: 'b',
      slug: 'old-two',
      schemaName: 'ns_b',
      type: 'local',
      deletedAt: new Date(0),
    },
  ];

  const build = (over: Record<string, unknown> = {}) => {
    const registry = {
      listExpiredDeleted: jest.fn().mockResolvedValue(expired),
      purgeDeleted: jest.fn().mockResolvedValue(true),
      ...over,
    };
    const prismaManager = {
      dropWhenIdle: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new NamespacePurgeService(
        registry as never,
        prismaManager as never,
      ),
      registry,
      prismaManager,
    };
  };

  const withRetention = async <T>(value: string, fn: () => Promise<T>) => {
    const previous = process.env.NAMESPACE_RETENTION_DAYS;
    process.env.NAMESPACE_RETENTION_DAYS = value;
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env.NAMESPACE_RETENTION_DAYS;
      else process.env.NAMESPACE_RETENTION_DAYS = previous;
    }
  };

  it('purges every expired workspace', async () => {
    const { service, registry } = build();

    const purged = await withRetention('7', () => service.sweep());

    expect(purged).toBe(2);
    expect(registry.purgeDeleted).toHaveBeenCalledWith('a');
    expect(registry.purgeDeleted).toHaveBeenCalledWith('b');
  });

  it('releases the tenant pool before dropping its schema', async () => {
    const { service, prismaManager, registry } = build();

    await withRetention('7', () => service.sweep());

    // Dropping a schema out from under a live connection is how you get
    // errors on a pool that then keeps handing out the same dead connection.
    expect(prismaManager.dropWhenIdle).toHaveBeenCalledWith('ns_a');
    expect(prismaManager.dropWhenIdle.mock.invocationCallOrder[0]).toBeLessThan(
      registry.purgeDeleted.mock.invocationCallOrder[0],
    );
  });

  it('does nothing when retention is disabled', async () => {
    const { service, registry } = build();

    const purged = await withRetention('0', () => service.sweep());

    expect(purged).toBe(0);
    expect(registry.listExpiredDeleted).not.toHaveBeenCalled();
  });

  it('keeps going when one workspace fails to drop', async () => {
    const { service, registry } = build({
      purgeDeleted: jest
        .fn()
        .mockRejectedValueOnce(new Error('schema locked'))
        .mockResolvedValue(true),
    });

    const purged = await withRetention('7', () => service.sweep());

    // A single stuck schema must not park the sweep forever; the failed one is
    // retried on the next pass.
    expect(purged).toBe(1);
    expect(registry.purgeDeleted).toHaveBeenCalledTimes(2);
  });

  it('counts only workspaces the registry actually deleted', async () => {
    // purgeDeleted returns false when the row was restored between listing and
    // dropping — the count must reflect reality, not intent.
    const { service } = build({
      purgeDeleted: jest.fn().mockResolvedValue(false),
    });

    expect(await withRetention('7', () => service.sweep())).toBe(0);
  });

  it('does not start a second sweep while one is running', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, registry } = build({
      listExpiredDeleted: jest.fn().mockImplementation(async () => {
        await gate;
        return [];
      }),
    });

    const first = withRetention('7', () => service.sweep());
    const second = await withRetention('7', () => service.sweep());
    release();
    await first;

    expect(second).toBe(0);
    expect(registry.listExpiredDeleted).toHaveBeenCalledTimes(1);
  });
});
