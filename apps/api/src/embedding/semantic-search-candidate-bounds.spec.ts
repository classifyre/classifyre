import { EmbeddingService } from './embedding.service';

/**
 * The HNSW scan must be bounded by the ORDER BY ... LIMIT, not by a filter
 * above it.
 *
 * `hnsw.iterative_scan = strict_order` keeps pulling more of the graph until
 * LIMIT rows *survive* whatever sits above the vector search. Put a join or a
 * WHERE up there and a top-K lookup silently becomes a near-full traversal —
 * silently, because the results are correct. Only the latency moves, which is
 * why this is asserted on query shape rather than on returned rows.
 *
 * Measured on firmenbuch-test-2 (40,518 vectors, of which only 2,003 belong to
 * an asset chunk): the join-inside form made the index scan read 19,733 rows
 * and return 929, in 107 seconds. Moving the join out read exactly 1,000 rows
 * and took 15. End to end the search endpoint went from 16-30s to ~8s.
 *
 * It degrades as the corpus grows: every finding or glossary embedding added
 * to the space dilutes it further, so the scan reaches deeper each time.
 */
describe('semantic search candidate bounds', () => {
  const activeSpace = {
    id: '9c85727f-8b6f-4de0-aee6-08a96b57f79b',
    provider: 'transformers-js',
    model: 'sentence-transformers/all-MiniLM-L6-v2',
    revision: 'revision-1',
    dim: 3,
    pooling: 'mean',
    normalized: true,
    isActive: true,
    createdAt: new Date(),
  };

  function harness() {
    const queries: string[] = [];
    const values: unknown[] = [];
    const prisma = {
      embeddingSpace: {
        findUnique: jest.fn().mockResolvedValue(activeSpace),
        findUniqueOrThrow: jest.fn().mockResolvedValue(activeSpace),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn(
        (sql: { strings?: string[]; sql?: string; values?: unknown[] }) => {
          queries.push(sql.sql ?? (sql.strings ?? []).join('?'));
          values.push(...(sql.values ?? []));
          return Promise.resolve([]);
        },
      ),
    };
    const capability = {
      ensureReady: jest.fn().mockResolvedValue(undefined),
      hasVector: jest.fn().mockReturnValue(true),
      version: jest.fn().mockReturnValue('0.8.5'),
    };
    const service = new EmbeddingService(
      prisma as never,
      capability as never,
      { valueRecurrenceSnapshot: jest.fn() } as never,
    );
    return { service, queries, values };
  }

  it('does not join asset_chunks inside the ordered vector search', async () => {
    const h = harness();
    await h.service.semanticAssetIds([0.1, 0.2, 0.3], 200);

    const sql = h.queries.join('\n');
    // The vector search is a plain scan of one table; the join comes after.
    const nearest = sql.slice(
      sql.indexOf('WITH nearest'),
      sql.indexOf('SELECT ac.asset_id'),
    );
    expect(nearest).toContain('FROM content_embeddings');
    expect(nearest).toContain('LIMIT');
    expect(nearest).not.toContain('JOIN');
    expect(nearest).not.toContain('asset_chunks');
    // And the join really is still performed, just above the bound.
    expect(sql).toContain('JOIN asset_chunks');
  });

  it('does not filter findings inside the ordered vector search', async () => {
    const h = harness();
    await h.service.semanticFindingIds([0.1, 0.2, 0.3], 50, ['source-1']);

    const sql = h.queries.join('\n');
    const nearest = sql.slice(
      sql.indexOf('WITH nearest'),
      sql.indexOf('SELECT f.id'),
    );
    expect(nearest).toContain('FROM content_embeddings');
    expect(nearest).not.toContain('JOIN');
    expect(nearest).not.toContain('findings');
    // source_id / status filtering is what made strict_order expand; it must
    // sit above the candidate bound.
    expect(nearest).not.toContain('source_id');
    expect(sql).toContain('JOIN findings');
  });

  it('over-fetches candidates so filtering still fills the page', async () => {
    // Survivors of a fixed candidate set can be fewer than the caller asked
    // for; 5x absorbs that without unbounding the scan.
    const h = harness();
    await h.service.semanticAssetIds([0.1, 0.2, 0.3], 200);

    // The candidate bound and the caller's page size both reach SQL as bound
    // parameters, so the numbers are what to assert on — not the LIMIT text.
    expect(h.values).toContain(1000);
    expect(h.values).toContain(200);
  });

  it('keeps a floor under the candidate bound for small pages', async () => {
    // A page of 5 must not narrow the vector search to 25 rows: recall, not
    // latency, is the binding constraint down there.
    const h = harness();
    await h.service.semanticAssetIds([0.1, 0.2, 0.3], 5);

    expect(h.values).toContain(200);
  });
});
