import { SharedDatasetResolver } from './shared-dataset-resolver';

/** A catalog with one queryable input, as a group might see it. */
function catalogWith(canQuery: boolean) {
  return {
    canQueryAll: false,
    limits: { maxRows: 1, timeoutSeconds: 1, exportMaxRows: 1 },
    sources: [
      {
        id: 'src',
        name: 'Shop',
        type: 'POSTGRESQL',
        sqlName: 'shop',
        queryable: true,
        tables: [
          {
            assetId: 'orders',
            sourceId: 'src',
            name: 'orders',
            schema: 'public',
            table: 'orders',
            sqlName: 'shop.public.orders',
            columns: [{ name: 'email', type: 'VARCHAR' }],
            queryable: true,
            canQuery,
            location: { kind: 'catalog', database: 'shop', table: 'orders' },
            masks: [{ column: 'email', action: 'mask', mask: 'redact' }],
          },
        ],
      },
    ],
  };
}

function setup(options: {
  status?: string;
  blocks?: { id: string }[];
  group?: 'missing' | 'reads' | 'lost';
  unavailableAt?: Date | null;
  /** Read over a SQL connection with this scope. */
  connection?: Record<string, string[]>;
}) {
  const row = {
    assetId: 'ds',
    domain: 'sales',
    name: 'orders_by_region',
    sql: 'SELECT * FROM shop.public.orders',
    owningGroupId: 'finance',
    inputs: ['orders'],
    columns: [{ name: 'email', type: 'VARCHAR', upstreams: [], traced: false }],
    unavailableAt: options.unavailableAt ?? null,
    blocks: options.blocks ?? [],
    asset: {
      name: 'orders_by_region',
      governance: options.status ? { status: options.status } : null,
    },
  };
  const prisma = {
    sharedDataset: {
      findMany: jest.fn().mockResolvedValue([row]),
      update: jest.fn().mockResolvedValue(row),
    },
  };
  const catalog = {
    catalog: jest.fn().mockResolvedValue(catalogWith(options.group !== 'lost')),
  };
  const identity = {
    groupAccessIn: jest.fn().mockResolvedValue(
      options.group === 'missing'
        ? null
        : {
            lineage: ['finance'],
            capabilities: new Set(),
            resourceGrants: {},
          },
    ),
  };
  const resolver = new SharedDatasetResolver(
    prisma as never,
    catalog as never,
    { workspaceId: () => 'ws' } as never,
    identity as never,
    {
      isActive: () => true,
      get: () =>
        options.connection
          ? {
              sourceIds: [],
              assetIds: [],
              blockedSourceIds: [],
              blockedAssetIds: [],
              openSourceIds: [],
              openAssetIds: [],
              ...options.connection,
            }
          : undefined,
    } as never,
  );
  const told = jest.fn();
  resolver.onUnavailable(told);
  return { resolver, prisma, catalog, identity, told };
}

describe('SharedDatasetResolver (DQ §5.12)', () => {
  it('expands a dataset into its SQL and its inputs as the group sees them', async () => {
    const { resolver, catalog } = setup({ group: 'reads' });
    const result = await resolver.resolve(['ds']);
    expect('datasets' in result && result.datasets[0]).toMatchObject({
      assetId: 'ds',
      sql: 'SELECT * FROM shop.public.orders',
      columns: ['email'],
      inputs: [
        {
          source: { sqlName: 'shop' },
          table: {
            sqlName: 'shop.public.orders',
            masks: [{ column: 'email', action: 'mask' }],
          },
        },
      ],
    });
    // The catalog was asked for the group, not for the reader.
    expect(catalog.catalog.mock.calls[0][0].person).toEqual({
      actorRef: 'group:finance',
      groupIds: ['finance'],
    });
  });

  it('refuses a retired dataset', async () => {
    const { resolver } = setup({ status: 'RETIRED', group: 'reads' });
    expect(await resolver.resolve(['ds'])).toMatchObject({
      refused: { code: 'dataset_retired' },
    });
  });

  it('refuses a blocked dataset', async () => {
    const { resolver } = setup({ blocks: [{ id: 'b' }], group: 'reads' });
    expect(await resolver.resolve(['ds'])).toMatchObject({
      refused: { code: 'dataset_blocked' },
    });
  });

  it('refuses, and tells once, when the group lost an input', async () => {
    const { resolver, told, prisma } = setup({ group: 'lost' });
    expect(await resolver.resolve(['ds'])).toMatchObject({
      refused: {
        code: 'dataset_inputs_unavailable',
        message: expect.stringContaining('shop.public.orders'),
      },
    });
    expect(told).toHaveBeenCalledTimes(1);
    expect(prisma.sharedDataset.update).toHaveBeenCalled();
  });

  it('does not tell again while it stays unavailable', async () => {
    const { resolver, told } = setup({
      group: 'lost',
      unavailableAt: new Date(),
    });
    await resolver.resolve(['ds']);
    expect(told).not.toHaveBeenCalled();
  });

  it('refuses when the owning group is gone', async () => {
    const { resolver } = setup({ group: 'missing' });
    expect(await resolver.resolve(['ds'])).toMatchObject({
      refused: { code: 'dataset_inputs_unavailable' },
    });
  });

  it('clears the outage once a read works again', async () => {
    const { resolver, prisma } = setup({
      group: 'reads',
      unavailableAt: new Date(),
    });
    await resolver.resolve(['ds']);
    expect(prisma.sharedDataset.update).toHaveBeenCalledWith({
      where: { assetId: 'ds' },
      data: { unavailableAt: null, unavailableWhy: null },
    });
  });

  it('reads over a SQL connection when every input is open to connections', async () => {
    const { resolver } = setup({
      group: 'reads',
      connection: { openSourceIds: ['src'] },
    });
    expect(await resolver.resolve(['ds'])).toHaveProperty('datasets');
  });

  it('refuses over a SQL connection when an input is closed or blocked', async () => {
    const closed = setup({ group: 'reads', connection: {} });
    expect(await closed.resolver.resolve(['ds'])).toMatchObject({
      refused: {
        code: 'dataset_inputs_closed',
        message: expect.stringContaining('shop.public.orders'),
      },
    });
    // Not an outage: the owner is not told.
    expect(closed.told).not.toHaveBeenCalled();
    const blocked = setup({
      group: 'reads',
      connection: { openAssetIds: ['orders'], blockedSourceIds: ['src'] },
    });
    expect(await blocked.resolver.resolve(['ds'])).toMatchObject({
      refused: { code: 'dataset_inputs_closed' },
    });
  });
});
