import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  infersOneAtATime,
  inSingles,
  pruneModelCache,
  resolveModelSource,
} from './transformers-embedding.worker';

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

/**
 * With 8-bit weights a text's vector depends on what else is in its batch, and
 * on a CPU a batch is slower than its rows one by one (see infersOneAtATime).
 * So a batch that arrives is embedded item by item.
 */
describe('one item per inference call', () => {
  it('is how a CPU is driven, and not a GPU', () => {
    expect(infersOneAtATime({ device: 'cpu' })).toBe(true);
    expect(infersOneAtATime({ device: 'wasm' })).toBe(true);
    expect(infersOneAtATime({ device: 'webgpu' })).toBe(false);
    expect(infersOneAtATime({ device: 'gpu' })).toBe(false);
  });

  it('hands the model one item at a time and keeps the answers in order', async () => {
    const seen: string[][] = [];
    const vectors = await inSingles(['a', 'bb', 'ccc'], (batch) => {
      seen.push(batch);
      return Promise.resolve(batch.map((text) => [text.length]));
    });

    expect(seen).toEqual([['a'], ['bb'], ['ccc']]);
    expect(vectors).toEqual([[1], [2], [3]]);
  });

  it('answers nothing for nothing without calling the model', async () => {
    const embed = jest.fn();

    expect(await inSingles([], embed)).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });
});

/**
 * Nothing ever left the model cache, and the cache is a volume with a limit:
 * trying one large model after another got the pod evicted. The cache now
 * makes room, oldest use first.
 */
describe('model cache budget', () => {
  let cacheDir: string;
  const megabyte = Buffer.alloc(1024 * 1024);

  /** A cached model of `mb` megabytes, last used `daysAgo` days ago. */
  function cached(model: string, mb: number, daysAgo: number): string {
    const dir = path.join(cacheDir, model);
    fs.mkdirSync(path.join(dir, 'onnx'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), '{}');
    for (let index = 0; index < mb; index++) {
      fs.writeFileSync(path.join(dir, 'onnx', `part-${index}.bin`), megabyte);
    }
    const when = new Date(Date.now() - daysAgo * 86_400_000);
    fs.writeFileSync(path.join(dir, '.last-used'), '');
    fs.utimesSync(path.join(dir, '.last-used'), when, when);
    return dir;
  }

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedding-cache-'));
  });
  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('deletes the model used longest ago to fit the one being loaded', () => {
    const old = cached('acme/old-model', 6, 30);
    const recent = cached('acme/recent-model', 6, 1);

    const removed = pruneModelCache({
      cacheDir,
      model: 'acme/new-model',
      budgetMb: 16,
      expectedMb: 6,
    });

    expect(removed).toEqual(['acme/old-model']);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });

  it('deletes nothing while everything fits', () => {
    cached('acme/old-model', 3, 30);

    expect(
      pruneModelCache({
        cacheDir,
        model: 'acme/new-model',
        budgetMb: 16,
        expectedMb: 6,
      }),
    ).toEqual([]);
  });

  it('never deletes the model it is making room for', () => {
    const own = cached('acme/big-model', 12, 90);
    cached('acme/other', 2, 1);

    const removed = pruneModelCache({
      cacheDir,
      model: 'acme/big-model',
      budgetMb: 8,
      expectedMb: 12,
    });

    expect(removed).toEqual(['acme/other']);
    expect(fs.existsSync(own)).toBe(true);
  });

  // A cached model that turns on an encoder fetches only that part.
  it('counts only what a cached model still has to fetch', () => {
    cached('acme/multimodal', 4, 0);
    cached('acme/other', 4, 5);

    expect(
      pruneModelCache({
        cacheDir,
        model: 'acme/multimodal',
        // 4 here + 4 of the other + the 2 still to come, and a little over.
        budgetMb: 11,
        expectedMb: 6,
      }),
    ).toEqual([]);
  });

  it('copes with a cache that is not there yet', () => {
    expect(
      pruneModelCache({
        cacheDir: path.join(cacheDir, 'missing'),
        model: 'acme/new-model',
        budgetMb: 16,
      }),
    ).toEqual([]);
  });
});
