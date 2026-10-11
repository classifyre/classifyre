import { EmbeddingController } from './embedding.controller';

describe('EmbeddingController', () => {
  it('returns the actual recalibration scheduling result', async () => {
    const queue = { scheduleRecalibration: jest.fn().mockResolvedValue(false) };
    const settings = { enabledNow: jest.fn().mockResolvedValue(true) };
    const controller = new EmbeddingController(
      {} as never,
      queue as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.recalibrate()).resolves.toEqual({
      scheduled: false,
    });
  });

  it('refuses recalibration, reindex and rebuild while embeddings are off', async () => {
    const queue = {
      scheduleRecalibration: jest.fn(),
      requestBackfill: jest.fn(),
    };
    const rebuilds = { start: jest.fn() };
    const settings = { enabledNow: jest.fn().mockResolvedValue(false) };
    const controller = new EmbeddingController(
      {} as never,
      queue as never,
      settings as never,
      {} as never,
      rebuilds as never,
      {} as never,
    );

    await expect(controller.recalibrate()).rejects.toThrow(/turned off/);
    await expect(controller.reindex()).rejects.toThrow(/turned off/);
    await expect(controller.rebuild()).rejects.toThrow(/turned off/);
    expect(queue.scheduleRecalibration).not.toHaveBeenCalled();
    expect(queue.requestBackfill).not.toHaveBeenCalled();
    expect(rebuilds.start).not.toHaveBeenCalled();
  });

  // "Turn off and delete" must leave the corpus empty; a pause keeps saving
  // the text the corpus is rebuilt from.
  it.each([
    [false, 0],
    [true, 1],
  ])(
    'stores scan chunks only while collecting (collects=%s)',
    async (collects, stored) => {
      const embeddings = {
        putChunks: jest.fn().mockResolvedValue({
          stored: 1,
          contents: [{ hash: 'h', text: 't' }],
        }),
      };
      const queue = { enqueue: jest.fn() };
      const settings = {
        collectsChunks: jest.fn().mockResolvedValue(collects),
        resolve: jest.fn().mockResolvedValue({ mediaModalities: [] }),
      };
      const controller = new EmbeddingController(
        embeddings as never,
        queue as never,
        settings as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const out = await controller.chunks('source-1', {
        assetHash: 'a',
        chunks: [],
      });

      expect(out.stored).toBe(stored);
      expect(embeddings.putChunks).toHaveBeenCalledTimes(stored);
      expect(queue.enqueue).toHaveBeenCalledTimes(stored);
    },
  );

  function controllerFor(cfg: Record<string, unknown>, collects = true) {
    const embeddings = {
      putChunks: jest.fn().mockResolvedValue({ stored: 0, contents: [] }),
      applyMediaChange: jest.fn().mockResolvedValue(undefined),
    };
    const settings = {
      collectsChunks: jest.fn().mockResolvedValue(collects),
      resolve: jest.fn().mockResolvedValue(cfg),
    };
    const controller = new EmbeddingController(
      embeddings as never,
      { enqueue: jest.fn() } as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { controller, embeddings, settings };
  }

  // The scan sends whatever it prepared; what is kept is what this workspace
  // embeds at the moment the request arrives.
  it('stores media only of the kinds the workspace embeds', async () => {
    const { controller, embeddings } = controllerFor({
      mediaModalities: ['image'],
    });
    const dto = { assetHash: 'a', chunks: [], media: [] };

    await controller.chunks('source-1', dto);

    expect(embeddings.putChunks).toHaveBeenCalledWith('source-1', dto, [
      'image',
    ]);
  });

  describe('collection plan', () => {
    it('asks a scan for pictures in the form they are stored in', async () => {
      const { controller } = controllerFor({
        enabled: true,
        mediaModalities: ['image'],
      });

      const plan = await controller.collection();

      expect(plan.chunks).toBe(true);
      expect(plan.media).toEqual([
        {
          modality: 'image',
          mimeType: 'image/jpeg',
          maxEdge: 768,
          quality: 85,
          maxItems: 1,
          cacheKey: 'EMBED_MEDIA::image',
          fingerprint: expect.stringMatching(/^[0-9a-f]{16}$/),
        },
      ]);
    });

    it('asks for no media on a text-only model', async () => {
      const { controller } = controllerFor({
        enabled: true,
        mediaModalities: [],
      });

      expect((await controller.collection()).media).toEqual([]);
    });

    // Text is kept through a pause so nothing needs rescanning. Media is not:
    // it would be megabytes stored for a model that is not running.
    it('asks for no media while embeddings are paused', async () => {
      const { controller } = controllerFor({
        enabled: false,
        mediaModalities: ['image', 'audio'],
      });

      const plan = await controller.collection();

      expect(plan.chunks).toBe(true);
      expect(plan.media).toEqual([]);
    });

    // A fingerprint of the whole plan would change for every picture the day
    // sound is turned on, and each of them would be read and sent again.
    it('keeps the record of one kind independent of the others', async () => {
      const images = await controllerFor({
        enabled: true,
        mediaModalities: ['image'],
      }).controller.collection();
      const both = await controllerFor({
        enabled: true,
        mediaModalities: ['image', 'audio'],
      }).controller.collection();

      expect(both.media[0].fingerprint).toBe(images.media[0].fingerprint);
      expect(both.media[1].fingerprint).not.toBe(images.media[0].fingerprint);
    });
  });
});
