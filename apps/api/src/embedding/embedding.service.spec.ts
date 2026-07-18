import { BadRequestException } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';

describe('EmbeddingService', () => {
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

  const prisma = {
    embeddingSpace: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    contentEmbedding: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
    },
    findingEvidenceAnalysis: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    finding: { findUnique: jest.fn(), findMany: jest.fn() },
    asset: { findUnique: jest.fn() },
    assetChunk: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const capability = {
    ensureReady: jest.fn(),
    hasVector: jest.fn(),
    version: jest.fn(),
  };
  const analysis = {
    analyzeHashes: jest.fn(),
    valueRecurrenceSnapshot: jest.fn(),
  };
  let service: EmbeddingService;

  beforeEach(() => {
    jest.clearAllMocks();
    capability.ensureReady.mockResolvedValue(undefined);
    capability.hasVector.mockReturnValue(false);
    capability.version.mockReturnValue('0.8.2');
    prisma.embeddingSpace.findUnique.mockResolvedValue(activeSpace);
    prisma.embeddingSpace.findUniqueOrThrow.mockResolvedValue(activeSpace);
    prisma.findingEvidenceAnalysis.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.finding.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
    analysis.valueRecurrenceSnapshot.mockResolvedValue(new Map());
    service = new EmbeddingService(
      prisma as never,
      capability as never,
      analysis as never,
    );
  });

  it('serializes configured-space activation before reading the space', async () => {
    await service.configuredSpace();

    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.embeddingSpace.findUnique.mock.invocationCallOrder[0],
    );
  });

  it('returns only unknown hashes from content-address negotiation', async () => {
    prisma.contentEmbedding.findMany.mockResolvedValue([
      { contentHash: 'a'.repeat(64) },
    ]);

    const result = await service.missing(
      {
        model: activeSpace.model,
        revision: activeSpace.revision,
        dim: activeSpace.dim,
        pooling: activeSpace.pooling,
        normalized: activeSpace.normalized,
      },
      ['a'.repeat(64), 'b'.repeat(64), 'b'.repeat(64)],
    );

    expect(result).toEqual({
      spaceId: activeSpace.id,
      missing: ['b'.repeat(64)],
    });
  });

  it('does not request a vector that is already content-addressed', async () => {
    const reusedHash = 'a'.repeat(64);
    prisma.contentEmbedding.findMany.mockResolvedValue([
      { contentHash: reusedHash },
    ]);
    const result = await service.missing(
      {
        model: activeSpace.model,
        revision: activeSpace.revision,
        dim: activeSpace.dim,
        pooling: activeSpace.pooling,
        normalized: activeSpace.normalized,
      },
      [reusedHash],
    );

    expect(result.missing).toEqual([]);
    expect(analysis.analyzeHashes).not.toHaveBeenCalled();
  });

  it('rejects a vector from the wrong coordinate space dimension', async () => {
    await expect(
      service.putVectors({
        spaceId: activeSpace.id,
        items: [{ contentHash: 'a'.repeat(64), vector: [1, 0] }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.contentEmbedding.createMany).not.toHaveBeenCalled();
  });

  it('rejects unnormalised vectors when the space requires normalisation', async () => {
    await expect(
      service.putVectors({
        spaceId: activeSpace.id,
        items: [{ contentHash: 'a'.repeat(64), vector: [1, 1, 1] }],
      }),
    ).rejects.toThrow('is not normalized');
  });

  it('reports mandatory pgvector and the configured provider', () => {
    expect(service.status()).toEqual({
      enabled: true,
      pgvector: true,
      pgvectorVersion: '0.8.2',
      searchStrategy: 'per-space-hnsw',
      provider: 'transformers-js',
      model: 'Xenova/all-MiniLM-L6-v2',
      dimensions: 384,
      spaceId: undefined,
    });
  });

  it('reuses one recurrence snapshot across every recalibration batch', async () => {
    const first = Array.from({ length: 500 }, (_, index) => ({
      id: `finding-${String(index).padStart(3, '0')}`,
      embedContentHash: `hash-${index}`,
    }));
    const second = [{ id: 'finding-500', embedContentHash: 'hash-500' }];
    prisma.finding.findMany
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce([]);
    const snapshot = new Map([['shared value', { assets: 2, sources: 1 }]]);
    analysis.valueRecurrenceSnapshot.mockResolvedValue(snapshot);
    prisma.embeddingSpace.update.mockResolvedValue(activeSpace);

    await service.recalibrateSpace(activeSpace.id);

    expect(analysis.valueRecurrenceSnapshot).toHaveBeenCalledTimes(1);
    expect(analysis.analyzeHashes).toHaveBeenCalledTimes(2);
    expect(analysis.analyzeHashes).toHaveBeenNthCalledWith(
      1,
      activeSpace.id,
      expect.any(Array),
      snapshot,
    );
    expect(analysis.analyzeHashes).toHaveBeenNthCalledWith(
      2,
      activeSpace.id,
      ['hash-500'],
      snapshot,
    );
  });
});
