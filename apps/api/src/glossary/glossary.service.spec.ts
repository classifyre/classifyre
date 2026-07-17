import { GlossaryService } from './glossary.service';

describe('GlossaryService', () => {
  const prisma = {
    glossaryTerm: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
  const queue = { enqueue: jest.fn() };
  const embeddings = { configuredSpace: jest.fn() };
  const queryEmbedding = { embed: jest.fn() };

  const service = new GlossaryService(
    prisma as never,
    queue as never,
    embeddings as never,
    queryEmbedding as never,
  );

  const baseTerm = {
    id: 'term-1',
    term: 'Little St. James',
    aliases: ['LSJ'],
    entityType: 'LOCATION',
    notes: null,
    refType: null,
    refId: null,
    origin: 'OPERATOR',
    verifiedAt: new Date(),
    verifiedBy: 'operator',
    embedContentHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.glossaryTerm.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...baseTerm, ...data, id: 'new-id' }),
    );
    prisma.glossaryTerm.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...baseTerm, ...data }),
    );
  });

  it('operator upsert creates a verified term and enqueues its embedding', async () => {
    prisma.glossaryTerm.findFirst.mockResolvedValue(null);

    const result = await service.upsert({
      term: 'Little St. James',
      aliases: ['LSJ'],
      origin: 'OPERATOR',
      author: 'analyst-1',
    });

    expect(result.verified).toBe(true);
    expect(result.merged).toBe(false);
    expect(prisma.glossaryTerm.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          origin: 'OPERATOR',
          verifiedBy: 'analyst-1',
        }),
      }),
    );
    expect(queue.enqueue).toHaveBeenCalledWith([
      expect.objectContaining({ text: expect.stringContaining('LSJ') }),
    ]);
  });

  it('agent upsert of a new term stays unverified', async () => {
    prisma.glossaryTerm.findFirst.mockResolvedValue(null);

    const result = await service.upsert({
      term: 'shell company X',
      origin: 'AGENT',
      author: 'CASE',
    });

    expect(result.verified).toBe(false);
    expect(prisma.glossaryTerm.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ origin: 'AGENT', verifiedAt: null }),
      }),
    );
  });

  it('agent upsert never overwrites an operator term — aliases merge only', async () => {
    prisma.glossaryTerm.findFirst.mockResolvedValue({ ...baseTerm });

    const result = await service.upsert({
      term: 'little st. james',
      aliases: ['the island'],
      notes: 'agent rewrite attempt',
      origin: 'AGENT',
    });

    expect(result.merged).toBe(true);
    expect(prisma.glossaryTerm.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { aliases: ['LSJ', 'the island'] },
      }),
    );
    // Content fields must be untouched.
    const updateData = prisma.glossaryTerm.update.mock.calls[0][0].data;
    expect(updateData.notes).toBeUndefined();
    expect(updateData.origin).toBeUndefined();
  });

  it('lookup returns exact matches and skips semantic search when the embedder is unavailable', async () => {
    prisma.glossaryTerm.findMany.mockResolvedValue([{ ...baseTerm }]);
    queryEmbedding.embed.mockRejectedValue(new Error('disabled'));

    const hits = await service.lookup('Little St. James', 5);

    expect(hits).toHaveLength(1);
    expect(hits[0].matchType).toBe('exact');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
