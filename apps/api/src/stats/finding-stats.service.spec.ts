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

  describe('refresh keeps every rollup table in step', () => {
    // `$executeRaw` is called as a tagged template, so its first argument is
    // the TemplateStringsArray itself; `$queryRaw(Prisma.sql`…`)` instead
    // passes a Sql object with `.strings`. Handle both.
    const sqlOfCall = (call: unknown[]): string => {
      const first = call[0];
      if (Array.isArray(first)) return first.join(' ');
      return ((first as { strings?: string[] })?.strings ?? []).join(' ');
    };
    const sqlOf = (calls: unknown[][]) => calls.map(sqlOfCall).join('\n');

    const TABLES = [
      'finding_stats_daily',
      'finding_stats_asset_daily',
      'finding_stats_first_daily',
      'finding_stats_first_asset_daily',
    ];

    it('rebuilds all four tables on a full rebuild', async () => {
      const executeRaw = jest.fn().mockResolvedValue(0);
      const queryRaw = jest.fn().mockResolvedValue([{ total: 1n }]);
      const service = new FindingStatsService({
        $executeRaw: executeRaw,
        $queryRaw: queryRaw,
      } as never);

      await service.rebuildAll();

      const sql = sqlOf(executeRaw.mock.calls);
      for (const table of TABLES) {
        expect(sql).toContain(`DELETE FROM ${table}`);
        expect(sql).toContain(`INSERT INTO ${table}`);
      }
    });

    it('recomputes all four tables for a dirty day', async () => {
      const executeRaw = jest.fn().mockResolvedValue(0);
      const queryRaw = jest
        .fn()
        .mockResolvedValueOnce([{ day: new Date('2026-08-13T00:00:00Z') }])
        .mockResolvedValue([{ total: 1n }]);
      const service = new FindingStatsService({
        $executeRaw: executeRaw,
        $queryRaw: queryRaw,
      } as never);

      await service.refreshDirtyDays();

      const sql = sqlOf(executeRaw.mock.calls);
      for (const table of TABLES) {
        expect(sql).toContain(`DELETE FROM ${table} WHERE day`);
        expect(sql).toContain(`INSERT INTO ${table}`);
      }
    });

    it('bounds every incremental scan by a range, never a cast on the column', async () => {
      const executeRaw = jest.fn().mockResolvedValue(0);
      const queryRaw = jest
        .fn()
        .mockResolvedValueOnce([{ day: new Date('2026-08-13T00:00:00Z') }])
        .mockResolvedValue([{ total: 1n }]);
      const service = new FindingStatsService({
        $executeRaw: executeRaw,
        $queryRaw: queryRaw,
      } as never);

      await service.refreshDirtyDays();

      // `WHERE detected_at::date = ANY(...)` is unsargable and seq-scans the
      // whole findings table — measured at 50 s where the range form took
      // 793 ms. Guard the shape, not just the result.
      const inserts = executeRaw.mock.calls
        .map(sqlOfCall)
        .filter((sql) => sql.includes('FROM findings'));
      expect(inserts.length).toBeGreaterThan(0);
      for (const sql of inserts) {
        expect(sql).not.toMatch(/detected_at::date\s*=\s*ANY/);
        expect(sql).toMatch(/detected_at >=/);
      }
    });

    it('skips findings with no first detection date', async () => {
      const executeRaw = jest.fn().mockResolvedValue(0);
      const queryRaw = jest.fn().mockResolvedValue([{ total: 1n }]);
      const service = new FindingStatsService({
        $executeRaw: executeRaw,
        $queryRaw: queryRaw,
      } as never);

      await service.rebuildAll();

      // first_detected_at is nullable and the live charts query drops those
      // rows; including them here would invent timeline entries.
      const firstInserts = executeRaw.mock.calls
        .map(sqlOfCall)
        .filter((sql) => sql.includes('INSERT INTO finding_stats_first'));
      expect(firstInserts).toHaveLength(2);
      for (const sql of firstInserts) {
        expect(sql).toContain('first_detected_at IS NOT NULL');
      }
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
