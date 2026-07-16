import { BadRequestException } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';

describe('EmbeddingService', () => {
  const activeSpace = {
    id: 'space-1',
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
  const capability = { hasVector: jest.fn() };
  const analysis = { analyzeHashes: jest.fn() };
  const service = new EmbeddingService(
    prisma as never,
    capability as never,
    analysis as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    capability.hasVector.mockReturnValue(false);
    prisma.embeddingSpace.findUnique.mockResolvedValue(activeSpace);
    prisma.finding.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
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

  it('reanalyzes findings that reuse an already stored vector', async () => {
    const reusedHash = 'a'.repeat(64);
    prisma.contentEmbedding.findMany.mockResolvedValue([
      { contentHash: reusedHash },
    ]);
    prisma.finding.findMany.mockResolvedValue([
      { embedContentHash: reusedHash },
    ]);

    await service.missing(
      {
        model: activeSpace.model,
        revision: activeSpace.revision,
        dim: activeSpace.dim,
        pooling: activeSpace.pooling,
        normalized: activeSpace.normalized,
      },
      [reusedHash],
    );

    expect(analysis.analyzeHashes).toHaveBeenCalledWith(activeSpace.id, [
      reusedHash,
    ]);
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

  it('reports the exact-cosine fallback as an active capability', () => {
    expect(service.status()).toEqual({
      enabled: true,
      pgvector: false,
      searchStrategy: 'exact-cosine',
    });
  });
});
