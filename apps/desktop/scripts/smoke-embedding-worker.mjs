// Executes the STAGED transformers-embedding.worker.js exactly the way the
// packaged app does — forked as a child process (mirroring
// EmbeddingProviderService), allowRemoteModels=false against the pre-baked
// model cache — and fails the build if a single embed request cannot be
// served.
//
// Why: the worker bundle inlines @huggingface/transformers and depends on the
// staged onnxruntime/sharp node_modules plus the resources/models cache being
// laid out precisely. A regression in any of those produced a build (v0.4.57)
// where every embedding attempt failed at runtime with zero log lines while
// /embeddings/status reported healthy. Static checks can't catch that; only
// actually running the worker can.
//
// Usage: node smoke-embedding-worker.mjs <worker.js path> <model cache dir>
import { fork } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const [workerPath, cacheDir] = process.argv.slice(2);
if (!workerPath || !cacheDir) {
  console.error(
    'usage: node smoke-embedding-worker.mjs <worker.js> <model-cache-dir>',
  );
  process.exit(2);
}

const TIMEOUT_MS = 180_000;

const config = {
  // Must mirror EmbeddingConfigService defaults (embedding-config.service.ts)
  // and the packaged-app env set by process-manager.ts.
  model: process.env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
  revision:
    process.env.EMBEDDING_MODEL_REVISION ??
    '751bff37182d3f1213fa05d7196b954e230abad9',
  pooling: 'mean',
  normalize: true,
  dtype: process.env.EMBEDDING_DTYPE ?? 'q8',
  device: 'cpu',
  cacheDir: path.resolve(cacheDir),
  allowRemoteModels: false,
};

const worker = fork(path.resolve(workerPath));
let terminating = false;
const timer = setTimeout(() => {
  console.error(`Embedding worker smoke test timed out after ${TIMEOUT_MS}ms`);
  process.exit(1);
}, TIMEOUT_MS);

worker.on('message', (message) => {
  clearTimeout(timer);
  if (message.error) {
    console.error(`Embedding worker smoke test FAILED: ${message.error}`);
    process.exit(1);
  }
  const vector = message.vectors?.[0];
  if (!Array.isArray(vector) || vector.length === 0) {
    console.error(
      `Embedding worker smoke test FAILED: no vector returned (got ${JSON.stringify(message).slice(0, 200)})`,
    );
    process.exit(1);
  }
  console.log(
    `Embedding worker smoke test passed (${vector.length}-dim vector from staged worker).`,
  );
  terminating = true;
  worker.kill();
  process.exit(0);
});
worker.on('error', (error) => {
  clearTimeout(timer);
  console.error(`Embedding worker smoke test FAILED (worker error): ${error}`);
  process.exit(1);
});
worker.on('exit', (code, signal) => {
  if (!terminating && (code !== 0 || signal)) {
    clearTimeout(timer);
    console.error(
      `Embedding worker smoke test FAILED: worker exited with code ${code}${signal ? ` (signal ${signal})` : ''}`,
    );
    process.exit(1);
  }
});

worker.send({
  id: 1,
  texts: ['classifyre staged embedding smoke test'],
  config,
});
