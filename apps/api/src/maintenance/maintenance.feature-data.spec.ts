import { MaintenanceService } from './maintenance.service';
import { SCORED_EDGE_RELATION_TYPES } from './maintenance.datasets';
import { CORRELATION_RELATION_TYPES } from '../correlation/correlation.service';

/**
 * The two datasets owned by a feature switch, and the parts of them that do
 * not live in their own tables.
 *
 * Duplicates: the scored pairs sit in `edges` next to the asset lineage, which
 * only a rescan can rebuild. The incident that motivated this had 17 GB of
 * scored pairs there that the old cleanup could not see; the fix must remove
 * them and never touch lineage.
 *
 * Embeddings: vectors, rankings and chunks — plus the per-space HNSW index and
 * queues, and the importance score a row trigger copies onto every finding,
 * which TRUNCATE does not fire.
 */
describe('MaintenanceService — feature-owned data', () => {
  type Exec = { sql: string };

  const build = (over: {
    edgeRows?: number;
    /** relation_type frequencies as pg_stats reports them. */
    freqs?: Record<string, number>;
    /** Heap blocks of every table the walk reads. */
    blocks?: number;
    spaces?: string[];
    rewriteThrows?: boolean;
  }) => {
    const execs: Exec[] = [];
    const exec = (sql: string): number => {
      execs.push({ sql });
      if (over.rewriteThrows && sql.startsWith('LOCK TABLE')) {
        throw new Error('canceling statement due to lock timeout');
      }
      if (sql.startsWith('INSERT INTO "edges"')) return 1000;
      if (sql.startsWith('DELETE FROM "edges"')) return 700;
      if (sql.startsWith('UPDATE "findings"')) return 40;
      return 0;
    };
    const tableStats = [
      {
        table: 'edges',
        rows_estimate: BigInt(over.edgeRows ?? 10_000),
        size_bytes: 1_000_000n,
      },
      { table: 'assets', rows_estimate: 100n, size_bytes: 50_000n },
      {
        table: 'correlation_pair_signatures',
        rows_estimate: 9000n,
        size_bytes: 300_000n,
      },
    ];
    const prisma = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = strings.join(' ');
        if (sql.includes('pg_stats')) {
          const freqs = over.freqs ?? {};
          return [
            {
              vals: Object.keys(freqs),
              freqs: Object.values(freqs),
            },
          ];
        }
        if (sql.includes('pg_constraint')) return [{ n: 0n }];
        if (sql.includes('pg_class')) return tableStats;
        return [];
      }),
      $queryRawUnsafe: jest.fn((sql: string) => {
        if (sql.includes('pg_relation_size')) {
          return [{ blocks: BigInt(over.blocks ?? 0) }];
        }
        if (sql.includes('FROM "embedding_spaces"')) {
          return (over.spaces ?? []).map((id) => ({ id }));
        }
        if (sql.includes('COUNT(*)')) return [{ n: 0n }];
        return [];
      }),
      $executeRawUnsafe: jest.fn(exec),
      $executeRaw: jest.fn(() => 0),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({ $executeRawUnsafe: exec, $executeRaw: () => 0 }),
      ),
    };
    const cls = {
      get: jest.fn((k: string) => (k === 'schemaName' ? 'ns_test' : 'nid')),
    };
    const lock = {
      runExclusive: jest.fn(<T>(work: () => Promise<T>) => work()),
    };
    const embeddings = { clearForSchema: jest.fn() };
    const settings = { clearForSchema: jest.fn() };
    const queue = { stopForSchema: jest.fn(() => Promise.resolve()) };
    const deleteQueue = jest.fn(() => Promise.resolve());
    const pgBoss = {
      getBossAsync: jest.fn(() => Promise.resolve({ deleteQueue })),
    };
    const service = new MaintenanceService(
      prisma as never,
      cls as never,
      undefined,
      undefined,
      lock as never,
      embeddings as never,
      settings as never,
      queue as never,
      pgBoss as never,
    );
    return {
      service,
      execs,
      lock,
      embeddings,
      settings,
      queue,
      deleteQueue,
    };
  };

  const settle = async (service: MaintenanceService, runId: string) => {
    for (let i = 0; i < 500; i += 1) {
      const snapshot = service.cleanupProgress(runId);
      if (snapshot.status !== 'running') return snapshot;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error(`run ${runId} never finished`);
  };

  it('treats exactly the correlation edge types as scored', () => {
    expect([...SCORED_EDGE_RELATION_TYPES].sort()).toEqual(
      [...CORRELATION_RELATION_TYPES].sort(),
    );
  });

  describe('overview', () => {
    it('moves the scored share of edges from assets to duplicates', async () => {
      const { service } = build({
        freqs: { related: 0.6, likely_duplicate: 0.3, CONTAINS: 0.1 },
      });

      const out = await service.overview();
      const duplicates = out.datasets.find(
        (d) => d.cleanupKey === 'duplicates',
      );
      const assets = out.datasets.find((d) => d.key === 'assets');

      // 90% of 1,000,000 bytes of edges, plus the pair signatures.
      expect(duplicates?.sizeBytes).toBe(900_000 + 300_000);
      expect(duplicates?.tables).toContain('edges');
      // Assets keep the lineage tenth, plus their own table.
      expect(assets?.sizeBytes).toBe(100_000 + 50_000);
      expect(out.unlistedTables).not.toContain('edges');
    });
  });

  describe('duplicates cleanup', () => {
    it('rewrites edges keeping lineage when scored pairs dominate', async () => {
      const { service, execs, lock } = build({
        edgeRows: 10_000,
        freqs: { related: 0.8, likely_duplicate: 0.1, SAME_AS: 0.1 },
      });

      const run = service.startCleanup('duplicates');
      const final = await settle(service, run.runId);

      expect(final.status).toBe('done');
      expect(lock.runExclusive).toHaveBeenCalledTimes(1);
      const sql = execs.map((e) => e.sql);
      const copy = sql.find((q) => q.startsWith('CREATE TEMP TABLE'));
      expect(copy).toContain(
        `"relation_type" NOT IN ('related', 'likely_duplicate', 'identical_content')`,
      );
      expect(sql).toContain('TRUNCATE "edges"');
      expect(sql.some((q) => q.startsWith('INSERT INTO "edges" SELECT'))).toBe(
        true,
      );
      // Never a bare TRUNCATE of edges alongside the dataset's own tables.
      const datasetTruncate = sql.find(
        (q) => q.startsWith('TRUNCATE') && q.includes('correlation_'),
      );
      expect(datasetTruncate).not.toContain('"edges"');
      // 10,000 estimated rows, 1,000 kept.
      expect(
        final.result?.deleted[
          'edges (related, likely_duplicate, identical_content)'
        ],
      ).toBe(9000);
    });

    it('walks edges by block range when lineage dominates', async () => {
      const { service, execs } = build({
        edgeRows: 10_000,
        freqs: { related: 0.1, CONTAINS: 0.9 },
        blocks: 20_000,
      });

      const run = service.startCleanup('duplicates');
      const final = await settle(service, run.runId);

      expect(final.status).toBe('done');
      const deletes = execs
        .map((e) => e.sql)
        .filter((q) => q.startsWith('DELETE FROM "edges"'));
      // 20,000 blocks in 8,192-block steps: three statements.
      expect(deletes).toHaveLength(3);
      expect(deletes[0]).toContain(`ctid >= '(0,0)'::tid`);
      expect(deletes[2]).toContain(`ctid < '(24576,0)'::tid`);
      expect(deletes[0]).toContain(
        `"relation_type" IN ('related', 'likely_duplicate', 'identical_content')`,
      );
      expect(execs.some((e) => e.sql === 'TRUNCATE "edges"')).toBe(false);
      expect(
        final.result?.deleted[
          'edges (related, likely_duplicate, identical_content)'
        ],
      ).toBe(2100);
    });

    it('falls back to the walk when the rewrite cannot get its lock', async () => {
      const { service, execs } = build({
        edgeRows: 10_000,
        freqs: { related: 0.95, CONTAINS: 0.05 },
        blocks: 100,
        rewriteThrows: true,
      });

      const run = service.startCleanup('duplicates');
      const final = await settle(service, run.runId);

      expect(final.status).toBe('done');
      expect(execs.some((e) => e.sql.startsWith('DELETE FROM "edges"'))).toBe(
        true,
      );
    });
  });

  describe('embeddings cleanup', () => {
    const SPACE = '0f0e0d0c-0b0a-4908-8706-050403020100';

    it('drops each space index and queues, then resets importance scores', async () => {
      const { service, execs, deleteQueue, embeddings, settings, queue } =
        build({ spaces: [SPACE], blocks: 100 });

      const run = service.startCleanup('embeddings');
      const final = await settle(service, run.runId);

      expect(final.status).toBe('done');
      expect(queue.stopForSchema).toHaveBeenCalledWith('ns_test');
      const sql = execs.map((e) => e.sql);
      expect(sql).toContain(
        'DROP INDEX IF EXISTS "content_embeddings_0f0e0d0c0b0a49088706050403020100_hnsw"',
      );
      expect(deleteQueue).toHaveBeenCalledWith(`semantic-embeddings-${SPACE}`);
      expect(deleteQueue).toHaveBeenCalledWith(`semantic-recalibrate-${SPACE}`);
      const truncate = sql.find((q) => q.startsWith('TRUNCATE'));
      for (const table of [
        'content_embeddings',
        'finding_evidence_analyses',
        'asset_chunks',
        'embedding_spaces',
      ]) {
        expect(truncate).toContain(`"${table}"`);
      }
      // TRUNCATE skipped the row trigger, so the scores are reset by walk.
      const reset = sql.find((q) => q.startsWith('UPDATE "findings"'));
      expect(reset).toContain('"importance_score" = 0');
      expect(reset).toContain('"importance_score" <> 0');
      expect(
        final.result?.deleted['findings.importance_score (reset to 0)'],
      ).toBe(40);
      expect(embeddings.clearForSchema).toHaveBeenCalledWith('ns_test');
      expect(settings.clearForSchema).toHaveBeenCalledWith('ns_test');
    });
  });

  it('reports the running cleanup for a dataset, and only its own', async () => {
    const { service } = build({ blocks: 0 });
    const run = service.startCleanup('duplicates');

    expect(service.runningCleanup('duplicates')?.runId).toBe(run.runId);
    expect(service.runningCleanup('embeddings')).toBeNull();
    // The internal schema tag never reaches a caller.
    expect(service.cleanupProgress(run.runId)).not.toHaveProperty('schema');
    await settle(service, run.runId);
    expect(service.runningCleanup('duplicates')).toBeNull();
  });
});
