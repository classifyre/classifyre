import { DetectorType } from '@prisma/client';
import { CorrelationService } from './correlation.service';

/**
 * The value index has two readers (G5 R9): duplicate detection, which scores
 * pairs over it, and entities, whose mentions are a join against it. These pin
 * the split between writing the index and scoring it, and what goes into the
 * index at all.
 */
describe('the value index as a shared service', () => {
  const build = (switches: { duplicates: boolean; entities: boolean }) => {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      asset: {
        findUnique: jest.fn().mockResolvedValue({ id: 'a1', sourceId: 's1' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'a1' }]),
        count: jest.fn().mockResolvedValue(1),
      },
      finding: { findMany: jest.fn().mockResolvedValue([]) },
      assetCorrelationValue: {
        deleteMany: jest.fn(),
        createMany: jest.fn(({ data }: { data: typeof created }) => {
          created.push(...data);
          return Promise.resolve({ count: data.length });
        }),
      },
      assetSignature: { upsert: jest.fn() },
      correlationConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      edge: { findMany: jest.fn(), deleteMany: jest.fn() },
      $transaction: jest.fn((cb: unknown) =>
        typeof cb === 'function'
          ? (cb as (tx: unknown) => unknown)({
              assetCorrelationValue: prisma.assetCorrelationValue,
              assetSignature: prisma.assetSignature,
            })
          : Promise.resolve([]),
      ),
      $executeRaw: jest.fn(),
      // The only raw read on this path: the code detectors of the workspace.
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: 'code-1', key: 'checksum' }]),
    };
    const reviewIndex = { refresh: jest.fn().mockResolvedValue(undefined) };
    const service = new CorrelationService(
      prisma as never,
      { runExclusive: (fn: () => Promise<unknown>) => fn() } as never,
      {} as never,
      reviewIndex as never,
      undefined,
      {
        isEnabled: () => Promise.resolve(switches.duplicates),
        assertEnabled: () =>
          switches.duplicates
            ? Promise.resolve()
            : Promise.reject(new Error('duplicates off')),
      } as never,
      { isEnabled: () => Promise.resolve(switches.entities) } as never,
    );
    return { service, prisma, reviewIndex, created };
  };

  const finding = (over: Record<string, unknown>) => ({
    id: 'f1',
    findingType: 'regex:vat',
    matchedContent: 'ATU12345678',
    detectorType: DetectorType.CUSTOM,
    customDetectorId: null,
    customDetectorKey: null,
    ...over,
  });

  describe('index-only passes', () => {
    it('index while only entities are on, and score nothing', async () => {
      const { service, prisma, reviewIndex, created } = build({
        duplicates: false,
        entities: true,
      });
      prisma.finding.findMany.mockResolvedValueOnce([
        finding({
          findingType: 'EMAIL_ADDRESS',
          matchedContent: 'A@b.example',
        }),
      ]);

      const summary = await service.indexValuesForRunner('run-1');

      expect(summary).toEqual({ assetsProcessed: 1, valuesIndexed: 1 });
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        label: 'email_address',
        normalizedValue: 'a@b.example',
      });
      // No pairs, no clusters, no review queue: that is duplicate detection.
      expect(reviewIndex.refresh).not.toHaveBeenCalled();
      expect(prisma.edge.findMany).not.toHaveBeenCalled();
    });

    it('index nothing when neither reader is on', async () => {
      const { service, prisma } = build({ duplicates: false, entities: false });

      const summary = await service.indexValuesForRunner('run-1');

      expect(summary).toEqual({ assetsProcessed: 0, valuesIndexed: 0 });
      expect(prisma.assetCorrelationValue.deleteMany).not.toHaveBeenCalled();
      expect(await service.valueIndexWanted()).toBe(false);
    });

    it('are wanted while duplicate detection alone is on', async () => {
      const { service } = build({ duplicates: true, entities: false });
      expect(await service.valueIndexWanted()).toBe(true);
    });
  });

  // Only a code detector's matched text is a verdict rather than a value
  // (contract C2). Testing "has a custom detector id" instead kept every
  // regex, GLiNER and classifier finding out of the index.
  describe('what a custom detector contributes', () => {
    it('indexes a regex detector by its matched text', async () => {
      const { service, prisma, created } = build({
        duplicates: false,
        entities: true,
      });
      prisma.finding.findMany.mockResolvedValueOnce([
        finding({ customDetectorId: 'regex-1', customDetectorKey: 'names' }),
      ]);

      await service.indexValuesForAssets(['a1']);

      expect(created).toEqual([
        expect.objectContaining({
          label: 'regex_vat',
          normalizedValue: 'atu12345678',
          customDetectorKey: 'names',
        }),
      ]);
    });

    it('indexes a code detector only through its declared value', async () => {
      const { service, prisma, created } = build({
        duplicates: false,
        entities: true,
      });
      prisma.finding.findMany
        // The asset's open findings: one of the code detector, by id.
        .mockResolvedValueOnce([
          finding({
            id: 'f-code',
            findingType: 'total_mismatch',
            matchedContent: 'total 523 != 520',
            customDetectorId: 'code-1',
            customDetectorKey: 'renamed-since',
          }),
        ])
        // Its metadata, read by id.
        .mockResolvedValueOnce([
          {
            id: 'f-code',
            findingType: 'total_mismatch',
            detectorType: DetectorType.CUSTOM,
            customDetectorKey: 'renamed-since',
            metadata: { normalized_value: 'INV-2026-041' },
          },
        ]);

      await service.indexValuesForAssets(['a1']);

      expect(created.map((row) => row.normalizedValue)).toEqual([
        'inv-2026-041',
      ]);
    });
  });
});
