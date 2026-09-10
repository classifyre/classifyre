import { CorrelationService } from './correlation.service';

/**
 * Tuning changes alter what every pair means, so an incremental recompute
 * must still rebuild the review index whole-corpus when the config is newer
 * than the index. Otherwise new weights would only ever reach the next
 * cycle's touched assets and the rest of the queue would silently keep the
 * old ones. These tests pin that decision matrix.
 */
describe('review index freshness', () => {
  function harness(
    cfgUpdatedAt: Date | null,
    indexMax: Date | null,
    queryFails = false,
  ) {
    const prisma = {
      correlationConfig: {
        findUnique: jest
          .fn()
          .mockResolvedValue(cfgUpdatedAt ? { updatedAt: cfgUpdatedAt } : null),
      },
      $queryRaw: jest.fn().mockImplementation(() => {
        if (queryFails) return Promise.reject(new Error('no such table'));
        return Promise.resolve([{ max: indexMax }]);
      }),
    };
    const service = Object.create(
      CorrelationService.prototype,
    ) as CorrelationService;
    Object.assign(service, { prisma });
    return service as unknown as {
      indexNeedsFullRefresh(): Promise<boolean>;
    };
  }

  it('forces full when the index table is missing (fresh namespace)', async () => {
    await expect(
      harness(new Date('2026-09-01'), null, true).indexNeedsFullRefresh(),
    ).resolves.toBe(true);
  });

  it('forces full when the index is empty', async () => {
    await expect(
      harness(new Date('2026-09-01'), null).indexNeedsFullRefresh(),
    ).resolves.toBe(true);
  });

  it('forces full when tuning changed after the last refresh', async () => {
    await expect(
      harness(
        new Date('2026-09-10T12:00:00Z'),
        new Date('2026-09-10T11:00:00Z'),
      ).indexNeedsFullRefresh(),
    ).resolves.toBe(true);
  });

  it('stays incremental when the index is newer than the tuning', async () => {
    await expect(
      harness(
        new Date('2026-09-10T11:00:00Z'),
        new Date('2026-09-10T12:00:00Z'),
      ).indexNeedsFullRefresh(),
    ).resolves.toBe(false);
  });

  it('stays incremental with default (unsaved) tuning over an existing index', async () => {
    await expect(
      harness(null, new Date('2026-09-10T12:00:00Z')).indexNeedsFullRefresh(),
    ).resolves.toBe(false);
  });
});
