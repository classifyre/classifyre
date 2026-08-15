import { EmbeddingQueueService } from './embedding-queue.service';

/**
 * Chunks are queued in groups, not one job per chunk.
 *
 * pg-boss orders its fetch by `priority DESC, created_on, id`, which its
 * `(name, start_after)` index cannot satisfy, so every fetch sorts the whole
 * due backlog to take a handful of rows. Measured on a desktop install holding
 * 1.1M queued chunks: one fetch of 8 jobs scanned 1,123,734 index entries and
 * took 9.9 seconds, reading 211 MB of buffers. Fetch cost grows with backlog
 * depth, so a queue that falls behind gets slower, never faster — the observed
 * drain rate was 64 jobs/hour against millions pending, and jobs were being
 * deleted unprocessed when they aged past their 24h retention.
 *
 * Grouping divides the row count without changing the work: the same chunks
 * are embedded, by the same provider, in the same inference batches.
 */
describe('embedding queue batching', () => {
  function harness(queueBatchSize = 4) {
    const inserted: Array<{ queue: string; jobs: any[] }> = [];
    const boss = {
      insert: jest.fn((queue: string, jobs: any[]) => {
        inserted.push({ queue, jobs });
        return Promise.resolve();
      }),
    };
    const runtime = {
      spaceId: 'space-1',
      queueName: 'semantic-embeddings-space-1',
      disposed: false,
      pendingWrites: 0,
    };
    const embeddings = {
      // Nothing embedded yet: every hash is missing.
      missingHashes: jest.fn((hashes: string[]) => Promise.resolve(hashes)),
      putVectors: jest.fn().mockResolvedValue(undefined),
    };
    const provider = {
      embedMany: jest.fn((texts: string[]) =>
        Promise.resolve(texts.map(() => [0.1, 0.2])),
      ),
    };

    // `persist` and `handle` are private; reach them through a structural
    // type rather than widening the class's API for a test.
    const service = Object.create(EmbeddingQueueService.prototype) as {
      persist: (contents: { hash: string; text: string }[]) => Promise<void>;
      handle: (jobs: unknown[]) => Promise<void>;
    };
    Object.assign(service, {
      config: { queueBatchSize, retrySeconds: 30 },
      pgBoss: { getBossAsync: () => Promise.resolve(boss) },
      embeddings,
      provider,
      ensureRuntime: () => Promise.resolve(runtime),
      runtime: () => runtime,
      scheduleRecalibration: () => undefined,
    });
    return { service, boss, inserted, embeddings, provider };
  }

  const chunks = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      hash: `hash-${i}`,
      text: `chunk text ${i}`,
    }));

  it('packs many chunks into one job instead of one job each', async () => {
    const h = harness(4);

    await h.service.persist(chunks(10));

    const jobs = h.inserted.flatMap((i) => i.jobs);
    expect(jobs).toHaveLength(3); // 4 + 4 + 2, not 10
    expect(jobs[0].data.items).toHaveLength(4);
    expect(jobs[2].data.items).toHaveLength(2);
    // Every chunk still queued exactly once.
    const queued = jobs.flatMap((j: any) =>
      j.data.items.map((i: any) => i.hash),
    );
    expect(new Set(queued).size).toBe(10);
  });

  it('gives each group a stable, content-derived singleton key', async () => {
    // The queue policy is `exclusive`, so a null singleton_key would let only
    // one job exist at a time; a random one would break idempotency.
    const a = harness(4);
    await a.service.persist(chunks(8));
    const b = harness(4);
    await b.service.persist(chunks(8));

    const keysA = a.inserted.flatMap((i) => i.jobs.map((j) => j.singletonKey));
    const keysB = b.inserted.flatMap((i) => i.jobs.map((j) => j.singletonKey));

    expect(keysA.every((k) => typeof k === 'string' && k.length > 0)).toBe(
      true,
    );
    expect(new Set(keysA).size).toBe(keysA.length); // unique per group
    expect(keysA).toEqual(keysB); // and stable across runs
  });

  it('embeds a batched job end to end', async () => {
    const h = harness(4);

    await h.service.handle([
      { data: { spaceId: 'space-1', items: chunks(3) } },
    ]);

    expect(h.provider.embedMany).toHaveBeenCalledWith([
      'chunk text 0',
      'chunk text 1',
      'chunk text 2',
    ]);
    expect(h.embeddings.putVectors).toHaveBeenCalledTimes(1);
  });

  it('still drains single-chunk jobs left in the queue by older versions', async () => {
    // Millions of these are queued on live installs; discarding them would
    // silently leave those chunks unembedded.
    const h = harness(4);

    await h.service.handle([
      { data: { spaceId: 'space-1', hash: 'legacy-1', text: 'old shape' } },
      { data: { spaceId: 'space-1', items: chunks(2) } },
    ]);

    expect(h.provider.embedMany).toHaveBeenCalledWith([
      'old shape',
      'chunk text 0',
      'chunk text 1',
    ]);
  });

  it('does not embed the same chunk twice within one fetch', async () => {
    const h = harness(4);

    await h.service.handle([
      { data: { spaceId: 'space-1', items: chunks(2) } },
      { data: { spaceId: 'space-1', items: chunks(2) } },
    ]);

    expect(h.provider.embedMany).toHaveBeenCalledWith([
      'chunk text 0',
      'chunk text 1',
    ]);
  });

  it('skips chunks that already have vectors', async () => {
    const h = harness(4);
    h.embeddings.missingHashes.mockResolvedValueOnce(['hash-1']);

    await h.service.handle([
      { data: { spaceId: 'space-1', items: chunks(3) } },
    ]);

    expect(h.provider.embedMany).toHaveBeenCalledWith(['chunk text 1']);
  });

  it('ignores jobs belonging to another space', async () => {
    const h = harness(4);

    await h.service.handle([
      { data: { spaceId: 'someone-else', items: chunks(3) } },
    ]);

    expect(h.provider.embedMany).not.toHaveBeenCalled();
  });
});
