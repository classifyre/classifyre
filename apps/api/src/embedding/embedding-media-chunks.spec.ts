import {
  EmbeddingService,
  mergeBestScores,
  mergeByStanding,
} from './embedding.service';
import { mediaContentHash } from './embedding-modality';

/**
 * What a scan sends for one asset is stored as one reading of it: its text
 * passages and the media prepared from it, replaced together. The media kept
 * is only what the workspace embeds — everything else would be bytes waiting
 * for a setting that may never change.
 */
describe('media chunks', () => {
  function harness() {
    const created: any[] = [];
    const tx = {
      assetChunk: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn(({ data }: { data: any[] }) => {
          created.push(...data);
          return Promise.resolve({ count: data.length });
        }),
      },
    };
    const prisma = {
      asset: { findUnique: jest.fn().mockResolvedValue({ id: 'asset-1' }) },
      assetChunk: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
      $executeRaw: jest.fn().mockResolvedValue(2),
    };
    const service = Object.create(
      EmbeddingService.prototype,
    ) as EmbeddingService;
    Object.assign(service, { prisma });
    return { service, prisma, tx, created };
  }

  const picture = Buffer.from('a downscaled jpeg');
  const dto = (media: unknown[]) =>
    ({
      assetHash: 'asset-hash',
      chunks: [
        { ordinal: 0, page: 1, charOffset: 0, charLength: 5, text: 'hello' },
        { ordinal: 1, page: 1, charOffset: 5, charLength: 5, text: 'world' },
      ],
      media,
    }) as never;
  const image = {
    modality: 'image',
    mimeType: 'image/jpeg',
    data: picture.toString('base64'),
  };

  it('stores a picture next to the text, keyed by its bytes', async () => {
    const h = harness();

    const result = await h.service.putChunks('source-1', dto([image]), [
      'image',
    ]);

    const stored = h.created.find((row) => row.modality === 'image');
    expect(stored).toMatchObject({
      assetId: 'asset-1',
      sourceId: 'source-1',
      text: '',
      mimeType: 'image/jpeg',
      contentHash: mediaContentHash(picture),
    });
    expect(Buffer.from(stored.data).equals(picture)).toBe(true);
    expect(result.stored).toBe(3);
    expect(result.contents.at(-1)).toEqual({
      hash: mediaContentHash(picture),
      text: '',
      media: true,
    });
  });

  // (asset, ordinal) is unique, and the scan numbers media from zero.
  it('numbers media after the text so the two cannot collide', async () => {
    const h = harness();

    await h.service.putChunks('source-1', dto([image, image]), ['image']);

    expect(h.created.map((row) => row.ordinal)).toEqual([0, 1, 2, 3]);
  });

  it('keeps no media of a kind the workspace does not embed', async () => {
    const h = harness();
    const clip = { ...image, modality: 'audio', mimeType: 'audio/wav' };

    const result = await h.service.putChunks('source-1', dto([image, clip]), [
      'audio',
    ]);

    expect(h.created.filter((row) => row.modality === 'image')).toEqual([]);
    expect(h.created.filter((row) => row.modality === 'audio')).toHaveLength(1);
    expect(
      result.contents.filter((content) => 'media' in content),
    ).toHaveLength(1);
  });

  it('keeps no media at all unless told what the workspace embeds', async () => {
    const h = harness();

    const result = await h.service.putChunks('source-1', dto([image]));

    expect(h.created.every((row) => row.modality === undefined)).toBe(true);
    expect(result.stored).toBe(2);
  });

  it('drops what is empty, oversized or not a kind it knows', async () => {
    const h = harness();

    await h.service.putChunks(
      'source-1',
      dto([
        { ...image, data: '' },
        { ...image, data: Buffer.alloc(5 * 1024 * 1024).toString('base64') },
        { ...image, modality: 'hologram' },
      ]),
      ['image'],
    );

    expect(h.created).toHaveLength(2); // the two passages
  });

  it('replaces text and media of an asset together', async () => {
    const h = harness();

    await h.service.putChunks('source-1', dto([image]), ['image']);

    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.tx.assetChunk.deleteMany).toHaveBeenCalledWith({
      where: { assetId: 'asset-1' },
    });
  });

  describe('turning a modality off', () => {
    it('removes its vectors and its stored bytes', async () => {
      const h = harness();

      const dropped = await h.service.dropMedia(['image']);

      expect(dropped).toEqual({ chunks: 3, vectors: 2 });
      expect(h.prisma.assetChunk.deleteMany).toHaveBeenCalledWith({
        where: { modality: { in: ['image'] } },
      });
    });

    // The vectors are found through the chunks, so they have to go first.
    it('deletes the vectors before the chunks that name them', async () => {
      const h = harness();

      await h.service.dropMedia(['image']);

      const sql = h.prisma.$executeRaw.mock.calls.map((call) =>
        (call[0] as string[]).join('?'),
      );
      expect(sql.at(-1)).toMatch(/DELETE FROM content_embeddings/);
      expect(h.prisma.$executeRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
        h.prisma.assetChunk.deleteMany.mock.invocationCallOrder[0],
      );
    });

    // The scan cache skips an unchanged asset on the strength of a record
    // that its media was sent. Deleting the media and keeping the record
    // would mean pictures turned back on are never collected again.
    it('takes back the record that the media was sent', async () => {
      const h = harness();

      await h.service.dropMedia(['image', 'audio']);

      const forget = h.prisma.$executeRaw.mock.calls.filter((call) =>
        (call[0] as string[]).join('?').includes('UPDATE assets'),
      );
      expect(forget.map((call) => call[1])).toEqual([
        'EMBED_MEDIA::image',
        'EMBED_MEDIA::audio',
      ]);
    });

    it('never touches text', async () => {
      const h = harness();

      await h.service.dropMedia(['text'] as never);
      await h.service.dropMedia([]);

      expect(h.prisma.$executeRaw).not.toHaveBeenCalled();
      expect(h.prisma.assetChunk.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('a change in what is embedded', () => {
    function changes() {
      const h = harness();
      const sql = () =>
        h.prisma.$executeRaw.mock.calls.map((call) =>
          (call[0] as string[]).join('?'),
        );
      Object.assign(h.service, { logger: { warn: jest.fn() } });
      return { ...h, sql };
    }

    // A source that has covered everything discovers nothing more, so the
    // pictures it passed before the model could see would never be sent.
    it('sends scans back over their sources when a kind is added', async () => {
      const h = changes();

      await h.service.applyMediaChange([], ['image']);

      expect(h.sql().some((text) => /UPDATE sources/.test(text))).toBe(true);
      expect(h.prisma.assetChunk.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes what was stored when a kind is removed, and revisits nothing', async () => {
      const h = changes();

      await h.service.applyMediaChange(['image', 'audio'], ['image']);

      expect(h.prisma.assetChunk.deleteMany).toHaveBeenCalledWith({
        where: { modality: { in: ['audio'] } },
      });
      expect(h.sql().some((text) => /UPDATE sources/.test(text))).toBe(false);
    });

    it('does nothing when the answer did not change', async () => {
      const h = changes();

      await h.service.applyMediaChange(['image'], ['image']);
      await h.service.applyMediaChange([], []);

      expect(h.prisma.$executeRaw).not.toHaveBeenCalled();
      expect(h.prisma.assetChunk.deleteMany).not.toHaveBeenCalled();
    });

    // The setting is saved by the time this runs; failing the request over a
    // cleanup would report a change that happened as one that did not.
    it('never fails the change that caused it', async () => {
      const h = changes();
      h.prisma.$executeRaw.mockRejectedValue(new Error('lock timeout'));

      await expect(
        h.service.applyMediaChange(['image'], []),
      ).resolves.toBeUndefined();
    });
  });

  /**
   * A model puts a caption and its picture in one space, but further apart
   * than two unrelated sentences. Measured with Gemini Embedding 2: a
   * description scored 0.62 against the clip it described and 0.56 against a
   * sentence about something else. By raw score the clip never surfaced.
   */
  describe('text and media, each read against its own kind', () => {
    const text = { middle: 0.5, count: 512 };
    const sound = { middle: 0.51, count: 22 };
    const pictures = { middle: 0.25, count: 46 };

    it('puts the clip that stands out among clips above text that does not stand out among text', () => {
      const merged = mergeByStanding(
        [
          { id: 'invoice', score: 0.56 },
          { id: 'rota', score: 0.55 },
        ],
        text,
        [
          { id: 'dog', score: 0.62, ...sound },
          { id: 'rain', score: 0.5, ...sound },
        ],
        10,
      );

      expect(merged.map((row) => row.id)).toEqual([
        'dog',
        'invoice',
        'rota',
        'rain',
      ]);
    });

    // A picture model scores a caption against its own picture far lower
    // than against any sentence: 0.33 against 0.8 here. By raw score no
    // picture is ever seen.
    it('finds the picture a caption describes on a model that keeps pictures far from text', () => {
      const merged = mergeByStanding(
        [{ id: 'unrelated sentence', score: 0.55 }],
        text,
        [
          { id: 'described picture', score: 0.33, ...pictures },
          { id: 'another picture', score: 0.24, ...pictures },
        ],
        10,
      );

      expect(merged.map((row) => row.id)).toEqual([
        'described picture',
        'unrelated sentence',
        'another picture',
      ]);
    });

    it('still puts a passage that answers above a clip that merely leads its kind', () => {
      const merged = mergeByStanding(
        [{ id: 'report', score: 0.8 }],
        text,
        [{ id: 'clip', score: 0.55, ...sound }],
        10,
      );

      expect(merged.map((row) => row.id)).toEqual(['report', 'clip']);
    });

    it('leaves the cosine each row carries as it was', () => {
      const merged = mergeByStanding(
        [{ id: 'invoice', score: 0.56 }],
        text,
        [{ id: 'dog', score: 0.62, ...sound }],
        10,
      );

      // The clip is marked as one: hybrid search must not hold its lack of
      // words against it (fuseHybridRanks).
      expect(merged).toEqual([
        { id: 'dog', score: 0.62, media: true },
        { id: 'invoice', score: 0.56 },
      ]);
    });

    // Three photographs have no middle worth the name.
    it('reads a kind with too few items against the text', () => {
      const few = { middle: 0.3, count: 3 };
      const merged = mergeByStanding(
        [{ id: 'report', score: 0.6 }],
        text,
        [{ id: 'photo', score: 0.31, ...few }],
        10,
      );

      expect(merged.map((row) => row.id)).toEqual(['report', 'photo']);
    });

    it('falls back to the raw score when text has no background either', () => {
      const merged = mergeByStanding(
        [{ id: 'note', score: 0.4 }],
        null,
        [{ id: 'photo', score: 0.55, ...sound }],
        10,
      );

      expect(merged.map((row) => row.id)).toEqual(['photo', 'note']);
    });

    it('counts an asset found both ways once, where it stands higher', () => {
      const merged = mergeByStanding(
        [{ id: 'scan', score: 0.53 }],
        text,
        [{ id: 'scan', score: 0.6, ...sound }],
        10,
      );

      expect(merged).toEqual([{ id: 'scan', score: 0.6, media: true }]);
    });
  });

  describe('one ranking out of text and media', () => {
    it('ranks a picture among the text by the same score', () => {
      const merged = mergeBestScores(
        [
          { id: 'report', score: 0.71 },
          { id: 'note', score: 0.4 },
        ],
        [{ id: 'photo', score: 0.55 }],
        10,
      );

      expect(merged.map((row) => row.id)).toEqual(['report', 'photo', 'note']);
    });

    // A scanned page is found by its text and by its picture: one result.
    it('counts an asset found both ways once, at its better score', () => {
      const merged = mergeBestScores(
        [{ id: 'scan', score: 0.3 }],
        [{ id: 'scan', score: 0.62 }],
        10,
      );

      expect(merged).toEqual([{ id: 'scan', score: 0.62 }]);
    });

    it('returns no more than was asked for', () => {
      const merged = mergeBestScores(
        [
          { id: 'a', score: 0.9 },
          { id: 'b', score: 0.8 },
        ],
        [{ id: 'c', score: 0.85 }],
        2,
      );

      expect(merged.map((row) => row.id)).toEqual(['a', 'c']);
    });
  });
});
