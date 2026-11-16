/* eslint-disable @typescript-eslint/require-await -- async mocks stand in for Prisma */
import { ConflictException } from '@nestjs/common';
import { ConnectionExposureService } from './connection-exposure.service';

type Exposure = { scopeType: 'ASSET' | 'SOURCE'; scopeId: string };

/**
 * A workspace with table `orders` (source `shop`) and one shared dataset
 * `ds` (built-in source `shared`) reading it.
 */
function setup(options: { exposures: Exposure[]; status?: string }) {
  let exposures = [...options.exposures];
  const dataset = {
    assetId: 'ds',
    domain: 'sales',
    name: 'orders_by_region',
    inputs: ['orders'],
    asset: {
      sourceId: 'shared',
      governance: options.status ? { status: options.status } : null,
    },
  };
  const assets = [
    { id: 'orders', sourceId: 'shop', name: 'orders' },
    { id: 'ds', sourceId: 'shared', name: 'orders_by_region' },
  ];
  const prisma = {
    dataConnectionExposure: {
      findMany: jest.fn(
        async ({ where }: { where?: { OR?: Exposure[] } } = {}) =>
          where?.OR
            ? exposures.filter((e) =>
                where.OR!.some(
                  (o) => o.scopeType === e.scopeType && o.scopeId === e.scopeId,
                ),
              )
            : exposures,
      ),
      upsert: jest.fn(async ({ create }: { create: Exposure }) => {
        exposures.push(create);
      }),
      deleteMany: jest.fn(async ({ where }: { where: Exposure }) => {
        exposures = exposures.filter(
          (e) =>
            !(e.scopeType === where.scopeType && e.scopeId === where.scopeId),
        );
      }),
    },
    sharedDataset: {
      findMany: jest.fn(
        async ({ where }: { where?: { inputs?: { has: string } } } = {}) =>
          !where?.inputs || dataset.inputs.includes(where.inputs.has)
            ? [dataset]
            : [],
      ),
      findUnique: jest.fn(async ({ where }: { where: { assetId: string } }) =>
        where.assetId === 'ds' ? dataset : null,
      ),
    },
    asset: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { id: { in: string[] }; sourceId?: string };
        }) =>
          assets.filter(
            (a) =>
              where.id.in.includes(a.id) &&
              (!where.sourceId || a.sourceId === where.sourceId),
          ),
      ),
    },
    source: { findMany: jest.fn(async () => []) },
  };
  const service = new ConnectionExposureService(
    prisma as never,
    { current: () => ({ ref: 'user:quill' }) } as never,
    { record: jest.fn() } as never,
    {
      mayGovernScope: async ({ scopeId }: { scopeId: string }) => ({
        allowed: true,
        sourceId: assets.find((a) => a.id === scopeId)?.sourceId ?? scopeId,
        name: scopeId,
      }),
    } as never,
    {
      tables: async () => ({
        tables: [{ assetId: 'orders', sqlName: 'shop.public.orders' }],
      }),
    } as never,
    { canManage: async () => false, refuse: jest.fn() } as never,
  );
  return { service, prisma };
}

describe('ConnectionExposureService and shared datasets (DQ §5.12)', () => {
  const both: Exposure[] = [
    { scopeType: 'ASSET', scopeId: 'orders' },
    { scopeType: 'ASSET', scopeId: 'ds' },
  ];

  it('refuses closing a table an active dataset open to connections reads', async () => {
    const { service, prisma } = setup({ exposures: both, status: 'ACTIVE' });
    const error = await service
      .setExposure('asset', 'orders', false)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'DATASETS_READ_TABLE',
      message: expect.stringContaining('shared.sales.orders_by_region'),
    });
    expect(prisma.dataConnectionExposure.deleteMany).not.toHaveBeenCalled();
  });

  it('counts a dataset without a lifecycle as a draft', async () => {
    const { service } = setup({ exposures: both });
    await expect(service.setExposure('asset', 'orders', false)).rejects.toThrow(
      ConflictException,
    );
  });

  it('refuses closing the source the table is open through', async () => {
    const { service } = setup({
      exposures: [
        { scopeType: 'SOURCE', scopeId: 'shop' },
        { scopeType: 'SOURCE', scopeId: 'shared' },
      ],
      status: 'ACTIVE',
    });
    await expect(service.setExposure('source', 'shop', false)).rejects.toThrow(
      ConflictException,
    );
  });

  it('closes once the dataset is deprecated or retired', async () => {
    for (const status of ['DEPRECATED', 'RETIRED']) {
      const { service } = setup({ exposures: both, status });
      await expect(
        service.setExposure('asset', 'orders', false),
      ).resolves.toMatchObject({ open: false });
    }
  });

  it('closes when the dataset itself is not open to connections', async () => {
    const { service } = setup({
      exposures: [{ scopeType: 'ASSET', scopeId: 'orders' }],
      status: 'ACTIVE',
    });
    await expect(
      service.setExposure('asset', 'orders', false),
    ).resolves.toMatchObject({ open: false });
  });

  it('closes a source whose read table stays open on its own', async () => {
    const { service } = setup({
      exposures: [...both, { scopeType: 'SOURCE', scopeId: 'shop' }],
      status: 'ACTIVE',
    });
    await expect(
      service.setExposure('source', 'shop', false),
    ).resolves.toMatchObject({ open: false });
  });

  it('opens a dataset only once its tables are open', async () => {
    const closed = setup({ exposures: [], status: 'ACTIVE' });
    await expect(
      closed.service.setExposure('asset', 'ds', true),
    ).rejects.toMatchObject({
      response: {
        code: 'DATASET_INPUTS_CLOSED',
        message: expect.stringContaining('shop.public.orders'),
      },
    });
    const open = setup({
      exposures: [{ scopeType: 'SOURCE', scopeId: 'shop' }],
      status: 'ACTIVE',
    });
    await expect(
      open.service.setExposure('asset', 'ds', true),
    ).resolves.toMatchObject({ open: true });
  });
});
