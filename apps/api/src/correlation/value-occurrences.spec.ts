import { FindingStatus } from '@prisma/client';
import type { PrismaService } from '../prisma.service';
import { CorrelationService } from './correlation.service';
import { normalizeValue, valueHash } from './value-normalizer';

describe('correlation value occurrences', () => {
  const prisma = {
    assetCorrelationValue: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    assetClusterMember: { findMany: jest.fn() },
    finding: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new CorrelationService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
    { refresh: async () => undefined } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.assetClusterMember.findMany.mockResolvedValue([]);
    prisma.assetCorrelationValue.updateMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
  });

  it('returns the concrete finding for every indexed asset occurrence', async () => {
    prisma.assetCorrelationValue.findMany.mockResolvedValue([
      {
        assetId: 'asset-1',
        findingId: 'finding-uuid-1',
        label: 'email',
        detectorType: 'EMAIL',
        customDetectorKey: null,
        normalizedValue: 'shared@example.com',
        asset: {
          id: 'asset-1',
          name: 'mail.eml',
          externalUrl: '',
          assetType: 'EMAIL',
          sourceType: 'EMAIL',
          sourceId: 'source-1',
          source: { name: 'Mailbox A' },
        },
      },
    ]);

    const result = await service.getValueOccurrences({ valueHash: 'hash-1' });

    expect(result.assets[0]?.findingId).toBe('finding-uuid-1');
    expect(prisma.finding.findMany).not.toHaveBeenCalled();
  });

  it('lazily resolves and persists finding ids for pre-migration index rows', async () => {
    const normalized = normalizeValue('EMAIL', 'Shared@Example.com')!;
    const hash = valueHash('EMAIL', normalized);
    prisma.assetCorrelationValue.findMany.mockResolvedValue([
      {
        assetId: 'asset-1',
        findingId: null,
        label: 'email',
        detectorType: 'EMAIL',
        customDetectorKey: null,
        normalizedValue: normalized,
        asset: {
          id: 'asset-1',
          name: 'mail.eml',
          externalUrl: '',
          assetType: 'EMAIL',
          sourceType: 'EMAIL',
          sourceId: 'source-1',
          source: { name: 'Mailbox A' },
        },
      },
    ]);
    prisma.finding.findMany.mockResolvedValue([
      {
        id: 'finding-uuid-1',
        assetId: 'asset-1',
        findingType: 'EMAIL',
        matchedContent: 'Shared@Example.com',
      },
    ]);

    const result = await service.getValueOccurrences({ valueHash: hash });

    expect(prisma.finding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: FindingStatus.OPEN }),
      }),
    );
    expect(prisma.assetCorrelationValue.updateMany).toHaveBeenCalledWith({
      where: { assetId: 'asset-1', valueHash: hash, findingId: null },
      data: { findingId: 'finding-uuid-1' },
    });
    expect(result.assets[0]?.findingId).toBe('finding-uuid-1');
  });
});
