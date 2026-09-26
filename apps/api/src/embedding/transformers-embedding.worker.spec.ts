import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
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

describe('forked worker lifetime', () => {
  let child: ChildProcess | undefined;
  let tempDir: string | undefined;

  afterEach(() => {
    child?.kill('SIGKILL');
    child = undefined;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('exits once its parent is gone, even while its event loop is held open', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'embedding-worker-'));
    // Without something holding the loop, plain Node exits on its own when the
    // channel closes and this would pass with or without the fix. The interval
    // stands in for what kept the real orphans alive: the file watcher bun
    // --watch runs in a child that inherited `--watch` through fork's execArgv.
    const holdOpen = path.join(tempDir, 'hold-open.cjs');
    fs.writeFileSync(holdOpen, 'setInterval(() => {}, 1 << 30);\n');

    child = fork(path.join(__dirname, 'transformers-embedding.worker.ts'), [], {
      execArgv: [
        '-r',
        require.resolve('ts-node/register/transpile-only'),
        '-r',
        holdOpen,
      ],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    await once(child, 'spawn');
    const exited = once(child, 'exit');

    // What the child sees when the dev reload re-execs its parent, or when the
    // parent is killed without running onApplicationShutdown.
    child.disconnect();

    const outcome = await Promise.race([
      exited.then(([code, signal]) => ({ code, signal })),
      new Promise((resolve) =>
        setTimeout(() => resolve('still running'), 15_000).unref(),
      ),
    ]);
    expect(outcome).toEqual({ code: 0, signal: null });
  }, 30_000);
});
