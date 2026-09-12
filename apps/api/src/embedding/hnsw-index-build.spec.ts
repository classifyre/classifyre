import { EmbeddingService } from './embedding.service';

/**
 * Building the per-space HNSW index must never block startup, and must never
 * fight another build.
 *
 * Both rules were learned the hard way. Building one of these was measured at
 * roughly twenty minutes for 879k vectors, and it used to be awaited inside
 * `registerForNamespace` — so a namespace needing its index stalled its own
 * startup and every namespace queued behind it.
 *
 * Detaching it then exposed the second rule. `CREATE INDEX CONCURRENTLY`
 * leaves an *invalid* index row for the whole of its run, so a second process
 * reading "invalid" and deciding to tidy up issued `DROP INDEX CONCURRENTLY`
 * against an index still being built. The two wait on each other forever.
 * Observed live: eight such statements stacked across restarts, none
 * progressing, and they took the pg-boss maintenance sweep down with them.
 */
describe('HNSW index build', () => {
  function harness(
    rows: {
      building?: Array<{ pid: number }>;
      existing?: Array<{ valid: boolean }>;
    } = {},
  ) {
    const executed: string[] = [];
    const queries: string[] = [];
    let queryCall = 0;
    const prisma = {
      $queryRaw: jest.fn(() => {
        // Call order inside buildHnswIndex: in-flight probe, then pg_index.
        queryCall += 1;
        queries.push(queryCall === 1 ? 'building' : 'existing');
        return Promise.resolve(
          queryCall === 1 ? (rows.building ?? []) : (rows.existing ?? []),
        );
      }),
      $executeRawUnsafe: jest.fn((sql: string) => {
        executed.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve(0);
      }),
    };
    const service = Object.create(EmbeddingService.prototype) as {
      buildHnswIndex: (
        schema: string,
        indexName: string,
        spaceId: string,
        dim: number,
        cast: { type: string; ops: string; indexed: boolean },
      ) => Promise<void>;
      ensureHnswIndex: (spaceId: string, dim: number) => void;
    };
    Object.assign(service, {
      prisma,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      hnswBuilds: new Set<string>(),
      cls: { get: () => 'ns_test' },
      settings: undefined,
      config: {},
    });
    return { service, prisma, executed };
  }

  const cast = {
    type: 'halfvec',
    ops: 'public.halfvec_cosine_ops',
    indexed: true,
  };
  const build = (h: ReturnType<typeof harness>) =>
    h.service.buildHnswIndex('ns_test', 'idx_hnsw', 'space-1', 384, cast);

  it('stands down when another process is already building it', async () => {
    // The in-process guard cannot see the other pod. Postgres can.
    const h = harness({ building: [{ pid: 4242 }] });

    await build(h);

    expect(h.executed).toEqual([]);
  });

  it('does nothing when a valid index is already there', async () => {
    const h = harness({ existing: [{ valid: true }] });

    await build(h);

    expect(h.executed).toEqual([]);
  });

  it('builds concurrently when there is no index', async () => {
    const h = harness();

    await build(h);

    expect(h.executed).toHaveLength(1);
    expect(h.executed[0]).toContain('CREATE INDEX CONCURRENTLY');
    expect(h.executed[0]).toContain('halfvec_cosine_ops');
  });

  it('clears an abandoned invalid index with a plain DROP, never CONCURRENTLY', async () => {
    // This is the deadlock. DROP INDEX CONCURRENTLY waits for the build it is
    // trying to replace; the build waits for the drop's transaction. An
    // invalid index serves no query, so there is no reader to be gentle with.
    const h = harness({ existing: [{ valid: false }] });

    await build(h);

    expect(h.executed[0]).toContain('DROP INDEX IF EXISTS');
    expect(h.executed[0]).not.toContain('CONCURRENTLY');
    expect(h.executed[1]).toContain('CREATE INDEX CONCURRENTLY');
  });

  it('returns immediately rather than awaiting the build', () => {
    // ensureHnswIndex is void, not a promise: nothing on the startup path can
    // accidentally await twenty minutes of index construction.
    const h = harness();

    const result = h.service.ensureHnswIndex(
      '9c85727f-8b6f-4de0-aee6-08a96b57f79b',
      384,
    );

    expect(result).toBeUndefined();
  });
});
