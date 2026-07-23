import { EmbeddingCapabilityService } from './embedding-capability.service';

describe('EmbeddingCapabilityService', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new EmbeddingCapabilityService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails startup with an actionable error when pgvector is missing', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { version: null, columnType: null, columnIsVector: null },
    ]);

    await expect(service.ensureReady()).rejects.toThrow(
      'Classifyre cannot start because the PostgreSQL pgvector extension is not installed',
    );
    await expect(service.ensureReady()).rejects.toThrow(
      'CREATE EXTENSION vector WITH SCHEMA public',
    );
  });

  it('fails startup when the vector schema migration is missing', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { version: '0.8.2', columnType: null, columnIsVector: null },
    ]);

    await expect(service.ensureReady()).rejects.toThrow(
      'content_embeddings.vec is missing or has the wrong type',
    );
  });

  it('accepts a schema-qualified pgvector column type', async () => {
    prisma.$queryRaw.mockResolvedValue([
      {
        version: '0.8.2',
        columnType: 'public.vector',
        columnIsVector: true,
      },
    ]);

    await service.ensureReady();

    expect(service.hasVector()).toBe(true);
    expect(service.version()).toBe('0.8.2');
  });
});
