import { EmbeddingQueueService } from './embedding-queue.service';

describe('EmbeddingQueueService', () => {
  const boss = {
    createQueue: jest.fn(),
    work: jest.fn(),
    insert: jest.fn(),
    send: jest.fn(),
    getQueueStats: jest.fn(),
  };
  const prisma = {
    finding: { findMany: jest.fn(), update: jest.fn() },
    assetChunk: { findMany: jest.fn() },
    glossaryTerm: { findMany: jest.fn(), update: jest.fn() },
    embeddingSpace: { findUnique: jest.fn() },
  };
  const config = {
    enabled: true,
    batchSize: 32,
    workerConcurrency: 1,
    retrySeconds: 30,
    autoBackfill: false,
    provider: 'transformers-js',
    model: 'Xenova/all-MiniLM-L6-v2',
  };
  const provider = {
    embedMany: jest.fn(),
    status: jest.fn().mockReturnValue({
      workerDisabled: false,
      requestErrorCount: 0,
      lastRequestError: null,
      lastRequestErrorAt: null,
    }),
  };
  const embeddings = {
    configuredSpace: jest.fn(),
    missingHashes: jest.fn(),
    putVectors: jest.fn(),
    recalibrateSpace: jest.fn(),
  };
  const pgBoss = { getBossAsync: jest.fn(), work: jest.fn() };
  const capability = { ensureReady: jest.fn() };
  // Simple CLS stub: a single fixed namespace, synchronous run().
  const cls = {
    get: () => 'ns_test',
    set: () => undefined,
    run: (fn: () => unknown) => fn(),
  };

  const service = new EmbeddingQueueService(
    prisma as never,
    config as never,
    provider as never,
    embeddings as never,
    pgBoss as never,
    capability as never,
    cls as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    capability.ensureReady.mockResolvedValue(undefined);
    pgBoss.getBossAsync.mockResolvedValue(boss);
    // The worker registers handlers via PgBossService.work(); delegate to the
    // underlying boss.work mock so existing call-inspection assertions hold.
    pgBoss.work.mockImplementation((q, o, h) => boss.work(q, o, h));
    boss.createQueue.mockResolvedValue(undefined);
    boss.work.mockResolvedValue(undefined);
    boss.insert.mockResolvedValue([]);
    embeddings.configuredSpace.mockResolvedValue({
      id: '9c85727f-8b6f-4de0-aee6-08a96b57f79b',
    });
    prisma.finding.findMany.mockResolvedValue([]);
    prisma.assetChunk.findMany.mockResolvedValue([]);
    prisma.glossaryTerm.findMany.mockResolvedValue([]);
    embeddings.missingHashes.mockResolvedValue([]);
    embeddings.putVectors.mockResolvedValue({ created: 0, received: 0 });
    embeddings.recalibrateSpace.mockResolvedValue({ analyzed: 0 });
    boss.send.mockResolvedValue('job-id');
    prisma.embeddingSpace.findUnique.mockResolvedValue(null);
    boss.getQueueStats.mockResolvedValue({
      queuedCount: 0,
      activeCount: 0,
      deferredCount: 0,
      totalCount: 0,
    });
  });

  it('probes pgvector before registering the persistent distributed worker', async () => {
    await service.registerForNamespace();

    expect(capability.ensureReady).toHaveBeenCalledTimes(1);
    expect(boss.createQueue).toHaveBeenCalledWith(
      'semantic-embeddings-9c85727f-8b6f-4de0-aee6-08a96b57f79b',
      { policy: 'exclusive' },
    );
    expect(boss.work).toHaveBeenCalledWith(
      'semantic-embeddings-9c85727f-8b6f-4de0-aee6-08a96b57f79b',
      expect.objectContaining({
        batchSize: 32,
        localConcurrency: 1,
        groupConcurrency: 1,
      }),
      expect.any(Function),
    );
    expect(capability.ensureReady.mock.invocationCallOrder[0]).toBeLessThan(
      boss.createQueue.mock.invocationCallOrder[0],
    );
  });

  it('persists one deduplicated job per content hash', async () => {
    await service.registerForNamespace();
    service.enqueue([
      { hash: 'a'.repeat(64), text: '  repeated   text ' },
      { hash: 'a'.repeat(64), text: 'repeated text' },
    ]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(boss.insert).toHaveBeenCalledWith(
      'semantic-embeddings-9c85727f-8b6f-4de0-aee6-08a96b57f79b',
      [
        expect.objectContaining({
          data: {
            spaceId: '9c85727f-8b6f-4de0-aee6-08a96b57f79b',
            hash: 'a'.repeat(64),
            text: 'repeated text',
          },
          singletonKey: 'a'.repeat(64),
          group: { id: 'embedding-inference' },
        }),
      ],
    );
  });

  it('batches missing jobs through the provider and content-addressed store', async () => {
    await service.registerForNamespace();
    const handler = boss.work.mock.calls[0][2] as (
      jobs: Array<{
        data: { spaceId: string; hash: string; text: string };
      }>,
    ) => Promise<void>;
    embeddings.missingHashes.mockResolvedValue(['b'.repeat(64)]);
    provider.embedMany.mockResolvedValue([[1, 0, 0]]);

    await handler([
      {
        data: {
          spaceId: '9c85727f-8b6f-4de0-aee6-08a96b57f79b',
          hash: 'a'.repeat(64),
          text: 'already stored',
        },
      },
      {
        data: {
          spaceId: '9c85727f-8b6f-4de0-aee6-08a96b57f79b',
          hash: 'b'.repeat(64),
          text: 'needs embedding',
        },
      },
    ]);

    expect(provider.embedMany).toHaveBeenCalledWith(['needs embedding']);
    expect(embeddings.missingHashes).toHaveBeenCalledWith(
      ['a'.repeat(64), 'b'.repeat(64)],
      '9c85727f-8b6f-4de0-aee6-08a96b57f79b',
    );
    expect(embeddings.putVectors).toHaveBeenCalledWith({
      spaceId: '9c85727f-8b6f-4de0-aee6-08a96b57f79b',
      items: [{ contentHash: 'b'.repeat(64), vector: [1, 0, 0] }],
    });
  });

  it('ignores jobs from another model space', async () => {
    await service.registerForNamespace();
    const handler = boss.work.mock.calls[0][2] as (
      jobs: Array<{
        data: { spaceId: string; hash: string; text: string };
      }>,
    ) => Promise<void>;

    await handler([
      {
        data: {
          spaceId: '3e4e92c3-f845-4d89-9f51-d88f8654d307',
          hash: 'c'.repeat(64),
          text: 'wrong coordinate space',
        },
      },
    ]);

    expect(provider.embedMany).not.toHaveBeenCalled();
    expect(embeddings.putVectors).not.toHaveBeenCalled();
  });

  it('schedules a debounced recalibration after new vectors are stored', async () => {
    await service.registerForNamespace();
    const handler = boss.work.mock.calls[0][2] as (
      jobs: Array<{
        data: { spaceId: string; hash: string; text: string };
      }>,
    ) => Promise<void>;
    embeddings.missingHashes.mockResolvedValue(['b'.repeat(64)]);
    provider.embedMany.mockResolvedValue([[1, 0, 0]]);

    await handler([
      {
        data: {
          spaceId: '9c85727f-8b6f-4de0-aee6-08a96b57f79b',
          hash: 'b'.repeat(64),
          text: 'needs embedding',
        },
      },
    ]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(boss.send).toHaveBeenCalledWith(
      'semantic-recalibrate-9c85727f-8b6f-4de0-aee6-08a96b57f79b',
      { spaceId: '9c85727f-8b6f-4de0-aee6-08a96b57f79b' },
      expect.objectContaining({
        singletonKey: '9c85727f-8b6f-4de0-aee6-08a96b57f79b',
        startAfter: expect.any(Number),
      }),
    );
  });

  it('defers recalibration while inference jobs are still pending', async () => {
    await service.registerForNamespace();
    const recalibrate = boss.work.mock.calls[1][2] as () => Promise<void>;
    boss.getQueueStats.mockResolvedValue({
      queuedCount: 3,
      activeCount: 1,
      deferredCount: 0,
      totalCount: 4,
    });

    await recalibrate();

    expect(embeddings.recalibrateSpace).not.toHaveBeenCalled();
    expect(boss.send).toHaveBeenCalledWith(
      'semantic-recalibrate-9c85727f-8b6f-4de0-aee6-08a96b57f79b',
      expect.anything(),
      expect.anything(),
    );
    expect(boss.send.mock.calls.at(-1)?.[2]).not.toHaveProperty('singletonKey');
  });

  it('reports whether recalibration was actually scheduled', async () => {
    await service.registerForNamespace();
    expect(await service.scheduleRecalibration()).toBe(true);

    boss.send.mockResolvedValueOnce(null);
    expect(await service.scheduleRecalibration()).toBe(false);
  });

  it('reports an uninitialized queue as unscheduled', async () => {
    const uninitialized = new EmbeddingQueueService(
      prisma as never,
      config as never,
      provider as never,
      embeddings as never,
      pgBoss as never,
      capability as never,
      cls as never,
    );

    expect(await uninitialized.scheduleRecalibration()).toBe(false);
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('recalibrates the whole space once the inference queue drains', async () => {
    await service.registerForNamespace();
    const recalibrate = boss.work.mock.calls[1][2] as () => Promise<void>;

    await recalibrate();

    expect(embeddings.recalibrateSpace).toHaveBeenCalledWith(
      '9c85727f-8b6f-4de0-aee6-08a96b57f79b',
    );
    expect((await service.status()).lastRecalibratedAt).toBeDefined();
  });

  it('backfills existing glossary terms into the active embedding space', async () => {
    await service.registerForNamespace();
    prisma.glossaryTerm.findMany
      .mockResolvedValueOnce([
        {
          id: 'term-1',
          term: 'Jane Doe',
          aliases: ['J. Doe'],
          notes: 'Person of interest',
          embedContentHash: null,
        },
      ])
      .mockResolvedValueOnce([]);
    embeddings.missingHashes.mockImplementation((hashes) =>
      Promise.resolve(hashes),
    );

    service.requestBackfill();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(prisma.glossaryTerm.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'term-1' },
        data: { embedContentHash: expect.any(String) },
      }),
    );
    expect(boss.insert).toHaveBeenCalledWith(
      'semantic-embeddings-9c85727f-8b6f-4de0-aee6-08a96b57f79b',
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            text: 'Jane Doe J. Doe Person of interest',
          }),
        }),
      ]),
    );
  });
});
