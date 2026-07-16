import { EmbeddingQueueService } from './embedding-queue.service';

describe('EmbeddingQueueService', () => {
  const boss = {
    createQueue: jest.fn(),
    work: jest.fn(),
    insert: jest.fn(),
  };
  const prisma = {
    finding: { findMany: jest.fn(), update: jest.fn() },
    assetChunk: { findMany: jest.fn() },
  };
  const config = {
    enabled: true,
    batchSize: 32,
    workerConcurrency: 1,
    retrySeconds: 30,
    provider: 'transformers-js',
    model: 'Xenova/all-MiniLM-L6-v2',
  };
  const provider = { embedMany: jest.fn() };
  const embeddings = {
    missingHashes: jest.fn(),
    putVectors: jest.fn(),
  };
  const pgBoss = { getBossAsync: jest.fn() };
  const capability = { ensureReady: jest.fn() };

  const service = new EmbeddingQueueService(
    prisma as never,
    config as never,
    provider as never,
    embeddings as never,
    pgBoss as never,
    capability as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    capability.ensureReady.mockResolvedValue(undefined);
    pgBoss.getBossAsync.mockResolvedValue(boss);
    boss.createQueue.mockResolvedValue(undefined);
    boss.work.mockResolvedValue(undefined);
    boss.insert.mockResolvedValue([]);
    prisma.finding.findMany.mockResolvedValue([]);
    prisma.assetChunk.findMany.mockResolvedValue([]);
    embeddings.missingHashes.mockResolvedValue([]);
    embeddings.putVectors.mockResolvedValue({ created: 0, received: 0 });
  });

  it('probes pgvector before registering the persistent distributed worker', async () => {
    await service.onApplicationBootstrap();

    expect(capability.ensureReady).toHaveBeenCalledTimes(1);
    expect(boss.createQueue).toHaveBeenCalledWith('semantic-embeddings', {
      policy: 'exclusive',
    });
    expect(boss.work).toHaveBeenCalledWith(
      'semantic-embeddings',
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
    service.enqueue([
      { hash: 'a'.repeat(64), text: '  repeated   text ' },
      { hash: 'a'.repeat(64), text: 'repeated text' },
    ]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(boss.insert).toHaveBeenCalledWith('semantic-embeddings', [
      expect.objectContaining({
        data: { hash: 'a'.repeat(64), text: 'repeated text' },
        singletonKey: 'a'.repeat(64),
        group: { id: 'embedding-inference' },
      }),
    ]);
  });

  it('batches missing jobs through the provider and content-addressed store', async () => {
    await service.onApplicationBootstrap();
    const handler = boss.work.mock.calls[0][2] as (
      jobs: Array<{ data: { hash: string; text: string } }>,
    ) => Promise<void>;
    embeddings.missingHashes.mockResolvedValue(['b'.repeat(64)]);
    provider.embedMany.mockResolvedValue([[1, 0, 0]]);

    await handler([
      { data: { hash: 'a'.repeat(64), text: 'already stored' } },
      { data: { hash: 'b'.repeat(64), text: 'needs embedding' } },
    ]);

    expect(provider.embedMany).toHaveBeenCalledWith(['needs embedding']);
    expect(embeddings.putVectors).toHaveBeenCalledWith([
      { contentHash: 'b'.repeat(64), vector: [1, 0, 0] },
    ]);
  });
});
