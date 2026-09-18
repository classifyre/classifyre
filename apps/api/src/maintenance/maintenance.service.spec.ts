import { NotFoundException } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';

describe('MaintenanceService', () => {
  const tableStatsRows = [
    { table: 'runners', rows_estimate: 3n, size_bytes: 1000n },
    { table: 'runner_assets', rows_estimate: 10n, size_bytes: 2000n },
    { table: 'findings', rows_estimate: 50n, size_bytes: 9000n },
    { table: 'agent_runs', rows_estimate: 2n, size_bytes: 500n },
  ];

  const build = (
    over: {
      pauseThrows?: boolean;
      runners?: Array<{ id: string; sourceId: string }>;
      liveRunners?: number;
      execSequence?: number[];
      externalRefs?: boolean;
      truncateThrows?: boolean;
    } = {},
  ) => {
    let execCalls = 0;
    const execUnsafe = jest.fn((sql: string): number => {
      if (over.truncateThrows && String(sql).startsWith('TRUNCATE')) {
        throw new Error('canceling statement due to lock timeout');
      }
      execCalls += 1;
      return over.execSequence?.[execCalls - 1] ?? 2;
    });
    const prisma = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = strings.join(' ');
        if (sql.includes('pg_constraint'))
          return [{ n: over.externalRefs ? 1n : 0n }];
        if (sql.includes('pg_class')) return tableStatsRows;
        if (sql.includes('FROM runners')) {
          if (sql.includes('PENDING'))
            return [{ n: BigInt(over.liveRunners ?? 0) }];
          return over.runners ?? [];
        }
        if (sql.includes('COUNT(*)')) return [{ n: 0n }];
        return [];
      }),
      $queryRawUnsafe: jest.fn((sql: string) => {
        if (sql.includes('pg_class')) return [];
        if (sql.includes('PENDING'))
          return [{ n: BigInt(over.liveRunners ?? 0) }];
        if (sql.includes('FROM runners')) return over.runners ?? [];
        if (sql.includes('COUNT(*)')) return [{ n: 0n }];
        return [];
      }),
      $executeRawUnsafe: execUnsafe,
      $executeRaw: jest.fn((): number => 0),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({ $executeRawUnsafe: execUnsafe, $executeRaw: () => 0 }),
      ),
    };
    const cls = {
      get: jest.fn((k: string) => (k === 'schemaName' ? 'ns_test' : 'nid')),
    };
    const pause = {
      assertNotPaused: jest.fn(() => {
        if (over.pauseThrows) throw new Error('paused');
      }),
    };
    const runnerLogs = { deleteRunnerLogs: jest.fn(() => undefined) };
    const service = new MaintenanceService(
      prisma as never,
      cls as never,
      pause as never,
      runnerLogs as never,
    );
    return { service, prisma, pause, runnerLogs };
  };

  describe('overview', () => {
    it('groups tables into protected and cleanable datasets', async () => {
      const { service } = build();
      const out = await service.overview();
      const byKey = new Map(
        out.datasets.map((d) => [d.cleanupKey ?? d.tables[0], d]),
      );
      expect(byKey.get('findings')?.cleanable).toBe(false);
      expect(byKey.get('findings')?.cleanupKey).toBeNull();
      expect(byKey.get('findings')?.rowsEstimate).toBe(50);
      expect(byKey.get('scans')?.cleanable).toBe(true);
      expect(byKey.get('scans')?.rowsEstimate).toBe(13);
      expect(out.schemaSizeBytes).toBe(12500);
    });
  });

  describe('cleanup runs', () => {
    // startCleanup forks the wipe; settle pumps the microtask queue until
    // the polled run leaves `running` (all prisma calls are mocked).
    const settle = async (
      service: MaintenanceService,
      runId: string,
      tries = 200,
    ) => {
      for (let i = 0; i < tries; i += 1) {
        const snapshot = service.cleanupProgress(runId);
        if (snapshot.status !== 'running') return snapshot;
        await new Promise((resolve) => setImmediate(resolve));
      }
      throw new Error(`run ${runId} never finished`);
    };

    it('rejects unknown keys (protected datasets have no key)', () => {
      const { service } = build();
      expect(() => service.startCleanup('findings')).toThrow(NotFoundException);
      expect(() => service.startCleanup('nope')).toThrow(NotFoundException);
    });

    it('is allowed while paused (frozen writers cannot race the wipe)', async () => {
      const { service } = build({ pauseThrows: true });
      const started = service.startCleanup('scans');
      const final = await settle(service, started.runId);
      expect(final.status).toBe('done');
      expect(final.result?.key).toBe('scans');
    });

    it('starts immediately and reports progress to done', async () => {
      const { service, prisma } = build();
      const started = service.startCleanup('stats');
      expect(started.status).toBe('running');
      expect(started.runId).toMatch(/^[0-9a-f-]{36}$/);
      // The 202 answer is already out while the wipe still runs.
      expect(service.cleanupProgress(started.runId).status).toBe('running');
      const final = await settle(service, started.runId);
      expect(final.status).toBe('done');
      expect(final.result?.key).toBe('stats');
      expect(final.result?.deleted['finding_stats_daily']).toBe(0);
      expect(final.tablesDone).toBe(final.tablesTotal);
      expect(final.currentTable).toBeNull();
      // The closing pass reclaims DELETE bloat and refreshes estimates.
      const vacuum = prisma.$executeRawUnsafe.mock.calls.filter(
        (call: unknown[]) => String(call[0]).startsWith('VACUUM'),
      );
      expect(vacuum.length).toBeGreaterThan(0);
    });

    it('reports 404 for unknown run ids', () => {
      const { service } = build();
      expect(() => service.cleanupProgress('nope')).toThrow(NotFoundException);
    });

    it('deletes only terminal scans, nulls asset pointers, removes logs', async () => {
      // UPDATE null-out, one runner_assets chunk (2 < CHUNK stops the
      // loop), then the runners delete.
      const {
        service: scansService,
        prisma,
        runnerLogs,
      } = build({
        runners: [{ id: 'r1', sourceId: 's1' }],
        liveRunners: 2,
        execSequence: [0, 2, 1],
      });
      const started = scansService.startCleanup('scans');
      const final = await settle(scansService, started.runId);
      const out = final.result;
      expect(final.status).toBe('done');
      expect(out?.deleted['runners']).toBe(1);
      expect(out?.skipped['runners (pending/running)']).toBe(2);
      expect(runnerLogs.deleteRunnerLogs).toHaveBeenCalledWith('s1', 'r1');
      const updateCall = prisma.$executeRawUnsafe.mock.calls.find(
        (call: unknown[]) => String(call[0]).includes('UPDATE assets'),
      );
      expect(updateCall).toBeDefined();
      // Raw SQL must use physical snake_case columns, never Prisma names.
      expect(String((updateCall as unknown[])[0])).toContain('"runner_id"');
      const selectCall = prisma.$queryRawUnsafe.mock.calls.find(
        (call: unknown[]) => String(call[0]).includes('FROM runners'),
      );
      expect(String((selectCall as unknown[])[0])).toContain('"source_id"');
    });

    it('truncates the embeddings dataset when nothing references it', async () => {
      const { service, prisma } = build();
      const started = service.startCleanup('embeddings');
      const final = await settle(service, started.runId);
      expect(final.status).toBe('done');
      expect(prisma.$transaction).toHaveBeenCalled();
      const truncateCall = prisma.$executeRawUnsafe.mock.calls.find(
        (call: unknown[]) => String(call[0]).startsWith('TRUNCATE'),
      );
      expect(truncateCall).toBeDefined();
      expect(String((truncateCall as unknown[])?.[0])).toContain(
        'content_embeddings',
      );
      // No row-by-row drain on the TRUNCATE path.
      const deletes = prisma.$executeRawUnsafe.mock.calls.filter(
        (call: unknown[]) =>
          String(call[0]).startsWith('DELETE FROM "content_embeddings"'),
      );
      expect(deletes).toHaveLength(0);
    });

    it('falls back to chunked DELETE when TRUNCATE is locked out', async () => {
      const { service, prisma } = build({ truncateThrows: true });
      const started = service.startCleanup('embeddings');
      const final = await settle(service, started.runId);
      // The run still converges instead of failing.
      expect(final.status).toBe('done');
      const deletes = prisma.$executeRawUnsafe.mock.calls.filter(
        (call: unknown[]) =>
          String(call[0]).startsWith('DELETE FROM "content_embeddings"'),
      );
      expect(deletes.length).toBeGreaterThan(0);
      expect(final.processed).toBeGreaterThan(0);
    });

    it('skips TRUNCATE when an outside table references the dataset', async () => {
      const { service, prisma } = build({ externalRefs: true });
      const started = service.startCleanup('embeddings');
      const final = await settle(service, started.runId);
      expect(final.status).toBe('done');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      const deletes = prisma.$executeRawUnsafe.mock.calls.filter(
        (call: unknown[]) => String(call[0]).startsWith('DELETE FROM'),
      );
      expect(deletes.length).toBeGreaterThan(0);
    });

    it('overview reports live scans for the pause-first hint', async () => {
      const { service } = build({ liveRunners: 2 });
      const out = await service.overview();
      expect(out.activeJobs).toBe(2);
    });

    it('rejects malformed identifiers', () => {
      const { service } = build();
      const priv = service as never as {
        assertIdent: (v: string) => string;
        assertQualified: (v: string) => string;
      };
      expect(() => priv.assertIdent('x; DROP TABLE findings; --')).toThrow(
        NotFoundException,
      );
      expect(() => priv.assertQualified('a.b.c')).toThrow(NotFoundException);
      expect(priv.assertQualified('ns_test.runners')).toBe(
        '"ns_test"."runners"',
      );
    });
  });
});
