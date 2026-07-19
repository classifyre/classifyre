import path from 'node:path';
import { resolveModelSource } from './transformers-embedding.worker';

const config = {
  model: 'Xenova/all-MiniLM-L6-v2',
  revision: 'abc123',
  pooling: 'mean',
  normalize: true,
  dtype: 'q8',
  device: 'cpu',
  cacheDir: '/cache',
  allowRemoteModels: false,
};

describe('resolveModelSource', () => {
  it('addresses a pinned FileCache revision directly for desktop offline mode', () => {
    expect(resolveModelSource(config)).toEqual({
      modelSource: path.resolve('/cache', 'Xenova/all-MiniLM-L6-v2', 'abc123'),
      revision: 'main',
    });
  });

  it('preserves Transformers.js model-root layout for mounted local models', () => {
    expect(
      resolveModelSource({ ...config, localModelPath: '/models' }),
    ).toEqual({
      modelSource: path.resolve('/models', 'Xenova/all-MiniLM-L6-v2'),
      revision: 'main',
    });
  });

  it('leaves remote model identifiers and revisions unchanged', () => {
    expect(resolveModelSource({ ...config, allowRemoteModels: true })).toEqual({
      modelSource: 'Xenova/all-MiniLM-L6-v2',
      revision: 'abc123',
    });
  });
});
