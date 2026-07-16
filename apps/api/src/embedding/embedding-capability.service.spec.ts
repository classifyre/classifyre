import { EmbeddingCapabilityService } from './embedding-capability.service';

describe('EmbeddingCapabilityService', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new EmbeddingCapabilityService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails startup with an actionable error when pgvector is missing', async () => {
    prisma.$queryRaw.mockResolvedValue([{ version: null, columnType: null }]);

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      'Classifyre cannot start because the PostgreSQL pgvector extension is not installed',
    );
    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      'CREATE EXTENSION vector WITH SCHEMA public',
    );
  });

  it('fails startup when the vector schema migration is missing', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { version: '0.8.2', columnType: null },
    ]);

    await expect(service.onApplicationBootstrap()).rejects.toThrow(
      'content_embeddings.vec is missing or has the wrong type',
    );
  });

  it('records the installed pgvector version after a successful probe', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { version: '0.8.2', columnType: 'vector' },
    ]);

    await service.onApplicationBootstrap();

    expect(service.hasVector()).toBe(true);
    expect(service.version()).toBe('0.8.2');
  });
});
