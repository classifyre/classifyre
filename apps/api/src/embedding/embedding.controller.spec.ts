import { EmbeddingController } from './embedding.controller';

describe('EmbeddingController', () => {
  it('returns the actual recalibration scheduling result', async () => {
    const queue = { scheduleRecalibration: jest.fn().mockResolvedValue(false) };
    const controller = new EmbeddingController({} as never, queue as never);

    await expect(controller.recalibrate()).resolves.toEqual({
      scheduled: false,
    });
  });
});
