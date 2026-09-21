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
});
