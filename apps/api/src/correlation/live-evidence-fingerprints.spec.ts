import { FindingStatus } from '@prisma/client';
import { CorrelationService } from './correlation.service';
import type { PrismaService } from '../prisma.service';

/**
 * A fingerprint asserts that an asset CURRENTLY carries a value.
 *
 * It was built from every finding on the asset regardless of status, and only
 * rebuilt for assets a run had touched — so when a detector left a source
 * config and its findings resolved, their values kept correlating assets
 * forever. On the live instance that left 36,641 of 49,497 correlation values
 * (74%) belonging to assets with no open finding at all, and 681,434 edges
 * resting on them: the "correlations against findings that don't exist" an
 * operator was looking at in the UI.
 */
describe('correlation fingerprints follow live evidence', () => {
  const prisma = {
    asset: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    finding: { findMany: jest.fn() },
    assetCorrelationValue: { deleteMany: jest.fn(), createMany: jest.fn() },
    assetSignature: { upsert: jest.fn() },
    correlationConfig: { findUnique: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const service = new CorrelationService(
    prisma as unknown as PrismaService,
    {} as never,
    { runExclusive: (fn: () => Promise<unknown>) => fn() } as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.asset.findUnique.mockResolvedValue({ id: 'a1', sourceId: 's1' });
    prisma.finding.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation((cb: any) =>
      typeof cb === 'function'
        ? cb({
            assetCorrelationValue: prisma.assetCorrelationValue,
            assetSignature: prisma.assetSignature,
          })
        : Promise.resolve([]),
    );
  });

  it('indexes only OPEN findings', async () => {
    // rebuildAssetValues is private and reached through the single-asset entry
    // point; the assertion is on the query it issues.
    await service.recomputeForAsset('a1').catch(() => undefined);

    expect(prisma.finding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assetId: 'a1',
          status: FindingStatus.OPEN,
        }),
      }),
    );
  });
});
