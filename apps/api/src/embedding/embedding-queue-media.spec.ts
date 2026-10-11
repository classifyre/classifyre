import { EmbeddingQueueService } from './embedding-queue.service';

/**
 * Pictures and clips go through the same queue as text, by hash, and come out
 * as vectors in the same space. What differs is cost: a picture takes a model
 * seconds where a passage takes milliseconds, and its bytes are a hundred
 * times a passage's. So media travels in small jobs, is read from the database
 * a few items at a time, and is stored as it goes.
 */
describe('embedding queue: media', () => {
  function harness(
    options: {
      mediaModalities?: string[];
      /** hash -> modality of the media chunks that exist. */
      media?: Record<string, string>;
      now?: () => number;
    } = {},
  ) {
    const media = options.media ?? {};
    const inserted: any[] = [];
    const boss = {
      insert: jest.fn((_queue: string, jobs: any[]) => {
        inserted.push(...jobs);
        return Promise.resolve();
      }),
    };
    const runtime = {
      spaceId: 'space-1',
      queueName: 'semantic-embeddings-space-1',
      disposed: false,
      pendingWrites: 0,
      embedJobFailureCount: 0,
    };
    const stored: Array<{ contentHash: string; vector: number[] }> = [];
    const embeddings = {
      missingHashes: jest.fn((hashes: string[]) => Promise.resolve(hashes)),
      putVectors: jest.fn(
        (input: {
          items: Array<{ contentHash: string; vector: number[] }>;
        }) => {
          stored.push(...input.items);
          return Promise.resolve();
        },
      ),
    };
    const provider = {
      embedMany: jest.fn((texts: string[]) =>
        Promise.resolve(texts.map(() => [1, 0])),
      ),
      embedMedia: jest.fn((items: unknown[]) =>
        Promise.resolve(items.map(() => [0, 1])),
      ),
    };
    const dataReads: string[][] = [];
    const prisma = {
      assetChunk: {
        findMany: jest.fn(
          ({
            where,
            select,
          }: {
            where: { contentHash: { in: string[] } };
            select: Record<string, boolean>;
          }) => {
            const hashes = where.contentHash.in;
            if (select.data) {
              dataReads.push(hashes);
              return Promise.resolve(
                hashes
                  .filter((hash) => media[hash])
                  .map((hash) => ({
                    contentHash: hash,
                    modality: media[hash],
                    mimeType: 'image/jpeg',
                    data: Buffer.from(hash),
                  })),
              );
            }
            return Promise.resolve(
              hashes.map((hash) =>
                media[hash]
                  ? {
                      contentHash: hash,
                      text: '',
                      modality: media[hash],
                      mimeType: 'image/jpeg',
                    }
                  : {
                      contentHash: hash,
                      text: `text of ${hash}`,
                      modality: 'text',
                      mimeType: null,
                    },
              ),
            );
          },
        ),
      },
      finding: { findMany: jest.fn().mockResolvedValue([]) },
      glossaryTerm: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const cfg = {
      enabled: true,
      queueBatchSize: 64,
      retrySeconds: 30,
      mediaModalities: options.mediaModalities ?? ['image'],
    };

    const service = Object.create(EmbeddingQueueService.prototype) as {
      persist: (
        contents: { hash: string; text: string; media?: boolean }[],
      ) => Promise<void>;
      handle: (jobs: unknown[]) => Promise<void>;
    };
    Object.assign(service, {
      config: {},
      settings: {
        cached: () => cfg,
        enabledNow: () => Promise.resolve(true),
      },
      logger: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
      pgBoss: { getBossAsync: () => Promise.resolve(boss) },
      embeddings,
      provider,
      prisma,
      ensureRuntime: () => Promise.resolve(runtime),
      runtime: () => runtime,
      scheduleRecalibration: () => undefined,
    });
    return { service, inserted, stored, provider, dataReads, embeddings };
  }

  const job = (hashes: string[]) => ({ data: { spaceId: 'space-1', hashes } });
  const pictures = (count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`pic-${index}`, 'image']),
    );

  it('queues media in its own small jobs, apart from text', async () => {
    const h = harness();

    await h.service.persist([
      ...Array.from({ length: 20 }, (_, index) => ({
        hash: `text-${index}`,
        text: `passage ${index}`,
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        hash: `pic-${index}`,
        text: '',
        media: true,
      })),
    ]);

    const groups = h.inserted.map((entry) => entry.data.hashes as string[]);
    // 20 passages fit one job of 64; 20 pictures are 8 + 8 + 4.
    expect(groups.map((group) => group.length)).toEqual([20, 8, 8, 4]);
    expect(groups[0].every((hash) => hash.startsWith('text-'))).toBe(true);
    expect(
      groups
        .slice(1)
        .flat()
        .every((hash) => hash.startsWith('pic-')),
    ).toBe(true);
  });

  // Empty text is nothing to embed; a media chunk has empty text by design.
  it('does not mistake a media chunk for an empty passage', async () => {
    const h = harness();

    await h.service.persist([
      { hash: 'blank', text: '   ' },
      { hash: 'pic-0', text: '', media: true },
    ]);

    expect(h.inserted.flatMap((entry) => entry.data.hashes)).toEqual(['pic-0']);
  });

  it('embeds text and media of one fetch into the same space', async () => {
    const h = harness({ media: { 'pic-0': 'image' } });

    await h.service.handle([job(['text-0', 'pic-0'])]);

    expect(h.provider.embedMany).toHaveBeenCalledWith(
      ['text of text-0'],
      expect.anything(),
    );
    expect(h.provider.embedMedia).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          modality: 'image',
          mimeType: 'image/jpeg',
          data: Buffer.from('pic-0'),
        }),
      ],
      expect.anything(),
    );
    expect(h.stored).toEqual([
      { contentHash: 'text-0', vector: [1, 0] },
      { contentHash: 'pic-0', vector: [0, 1] },
    ]);
  });

  // A fetch can name hundreds of pictures. Loading them all to embed four
  // would hold the whole fetch's bytes in memory at once.
  it('reads media bytes a few at a time and stores each step', async () => {
    const h = harness({ media: pictures(10) });

    await h.service.handle([job(Object.keys(pictures(10)))]);

    expect(h.dataReads.map((read) => read.length)).toEqual([4, 4, 2]);
    expect(h.embeddings.putVectors).toHaveBeenCalledTimes(3);
    expect(h.stored).toHaveLength(10);
  });

  // Turning pictures off deletes their chunks; a job queued a moment earlier
  // must not put a vector back for one that is still being deleted.
  it('leaves alone media of a kind the workspace does not embed', async () => {
    const h = harness({
      mediaModalities: ['image'],
      media: { 'pic-0': 'image', 'clip-0': 'audio' },
    });

    await h.service.handle([job(['pic-0', 'clip-0'])]);

    expect(h.stored.map((item) => item.contentHash)).toEqual(['pic-0']);
  });

  it('embeds no media at all on a text-only workspace', async () => {
    const h = harness({ mediaModalities: [], media: { 'pic-0': 'image' } });

    await h.service.handle([job(['pic-0'])]);

    expect(h.provider.embedMedia).not.toHaveBeenCalled();
    expect(h.stored).toEqual([]);
  });

  // Every job of a fetch expires together an hour after it started, and a CPU
  // endpoint can take most of a minute for a picture. Past the budget the rest
  // is queued again and this call ends cleanly, keeping what it stored.
  it('hands back what it had no time for instead of running out the clock', async () => {
    const h = harness({ media: pictures(12) });
    const realNow = Date.now;
    let clock = realNow();
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    h.provider.embedMedia.mockImplementation((items: unknown[]) => {
      clock += 15 * 60_000; // each step of four takes a quarter of an hour
      return Promise.resolve(items.map(() => [0, 1]));
    });

    try {
      await h.service.handle([job(Object.keys(pictures(12)))]);
    } finally {
      jest.restoreAllMocks();
    }

    // Two steps fit inside twenty minutes' budget (the check is before a
    // step); the third is handed back.
    expect(h.stored).toHaveLength(8);
    const requeued = h.inserted.flatMap((entry) => entry.data.hashes);
    expect(requeued).toEqual(['pic-8', 'pic-9', 'pic-10', 'pic-11']);
  });

  // The job those hashes arrived in is still active while they are handed
  // back; with the same key the new job would be dropped as its duplicate.
  it('gives a handed-back job a key of its own', async () => {
    const first = harness();
    await first.service.persist([{ hash: 'pic-0', text: '', media: true }]);
    const second = harness();
    await (
      second.service as unknown as {
        persist: (c: unknown[], o: { requeue: boolean }) => Promise<void>;
      }
    ).persist([{ hash: 'pic-0', text: '', media: true }], { requeue: true });

    expect(second.inserted[0].singletonKey).not.toBe(
      first.inserted[0].singletonKey,
    );
    expect(second.inserted[0].data.hashes).toEqual(['pic-0']);
  });
});
