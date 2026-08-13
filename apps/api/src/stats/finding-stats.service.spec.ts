import { FindingStatsService } from './finding-stats.service';

describe('FindingStatsService', () => {
  const build = (executeRaw = jest.fn().mockResolvedValue(0)) => {
    const prisma = { $executeRaw: executeRaw, $queryRaw: jest.fn() };
    return {
      service: new FindingStatsService(prisma as never),
      executeRaw,
      prisma,
    };
  };

  describe('canServe', () => {
    it('serves an unfiltered request', () => {
      const { service } = build();
      expect(service.canServe(undefined)).toBe(true);
      expect(service.canServe({})).toBe(true);
    });

    it('serves filters confined to the rollup grain', () => {
      const { service } = build();
      expect(
        service.canServe({
          sourceId: ['a'],
          detectorType: ['PII'],
          severity: ['HIGH'],
          includeResolved: true,
        }),
      ).toBe(true);
    });

    it('refuses filters the grain cannot express', () => {
      const { service } = build();
      expect(service.canServe({ search: 'ssn' })).toBe(false);
      expect(service.canServe({ customDetectorKey: ['k'] })).toBe(false);
    });

    it('ignores empty and absent values rather than refusing', () => {
      const { service } = build();
      // The findings table always sends the full filter object with unset keys
      // as undefined/[]; treating those as unservable would push every default
      // page load onto the live count this exists to avoid.
      expect(
        service.canServe({ search: undefined, sourceId: [], severity: null }),
      ).toBe(true);
    });
  });

  describe('status filtering', () => {
    const captureSql = async (
      filters: Parameters<FindingStatsService['totalFor']>[0],
    ) => {
      const queryRaw = jest
        .fn()
        .mockResolvedValueOnce([
          {
            refreshed_at: new Date(),
            duration_ms: 1,
            total_findings: 5,
            is_built: true,
          },
        ])
        .mockResolvedValueOnce([{ total: 5n }]);
      const prisma = { $executeRaw: jest.fn(), $queryRaw: queryRaw };
      const service = new FindingStatsService(prisma as never);
      await service.totalFor(filters);
      const call = queryRaw.mock.calls[1]![0] as { strings?: string[] };
      return (call.strings ?? []).join('?');
    };

    it('excludes only the listed statuses when no explicit status is given', async () => {
      // The findings search defaults to "anything but RESOLVED", so
      // FALSE_POSITIVE and IGNORED must still be counted. Treating that as
      // status = 'OPEN' silently under-reported the total.
      const sql = await captureSql({ excludeStatuses: ['RESOLVED'] });
      expect(sql).toContain('NOT (status::text = ANY(');
      expect(sql).not.toContain("status = 'OPEN'");
    });

    it('honours an explicit status list over the exclusion', async () => {
      const sql = await captureSql({
        status: ['OPEN'],
        excludeStatuses: ['RESOLVED'],
      });
      expect(sql).toContain('status::text = ANY(');
      expect(sql).not.toContain('NOT (status::text');
    });

    it('constrains nothing when neither is given', async () => {
      const sql = await captureSql({});
      expect(sql).not.toContain('status');
    });
  });

  describe('markDaysDirty', () => {
    it('collapses many timestamps in a day to one row', async () => {
      const { service, executeRaw } = build();

      await service.markDaysDirty([
        new Date('2026-08-13T01:00:00Z'),
        new Date('2026-08-13T23:59:00Z'),
        new Date('2026-08-14T00:00:00Z'),
      ]);

      expect(executeRaw).toHaveBeenCalledTimes(1);
      const params = executeRaw.mock.calls[0]!.slice(1);
      expect(params[0]).toEqual(['2026-08-13', '2026-08-14']);
    });

    it('does not touch the database when there is nothing to mark', async () => {
      const { service, executeRaw } = build();

      await service.markDaysDirty([null, undefined]);

      expect(executeRaw).not.toHaveBeenCalled();
    });
  });
});
