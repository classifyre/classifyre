import { Injectable } from '@nestjs/common';
import os from 'node:os';

export type EmbeddingProviderKind = 'transformers-js' | 'openai-compatible';

// onnxruntime defaults its intra-op pool to every visible core, which on a
// laptop starves the UI (and in a pod ignores the CPU limit — ORT reads host
// cores, not the cgroup quota). availableParallelism is cgroup-aware on
// Node 20+, so half of it (capped) is a polite default everywhere.
function defaultIntraOpThreads(): number {
  const available = os.availableParallelism?.() ?? os.cpus().length;
  return Math.max(1, Math.min(4, Math.floor(available / 2)));
}

function integerEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function booleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`${name} must be true or false`);
}

@Injectable()
export class EmbeddingConfigService {
  readonly enabled = booleanEnv('EMBEDDING_ENABLED', true);
  readonly provider = (process.env.EMBEDDING_PROVIDER ??
    'transformers-js') as EmbeddingProviderKind;
  readonly model = process.env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
  readonly revision =
    process.env.EMBEDDING_MODEL_REVISION ??
    '751bff37182d3f1213fa05d7196b954e230abad9';
  readonly dimensions = integerEnv('EMBEDDING_DIMENSIONS', 384, 1, 2000);
  readonly pooling = process.env.EMBEDDING_POOLING ?? 'mean';
  readonly normalize = booleanEnv('EMBEDDING_NORMALIZE', true);
  readonly batchSize = integerEnv('EMBEDDING_BATCH_SIZE', 32, 1, 256);
  readonly workerConcurrency = integerEnv(
    'EMBEDDING_WORKER_CONCURRENCY',
    1,
    1,
    32,
  );
  readonly retrySeconds = integerEnv('EMBEDDING_RETRY_SECONDS', 30, 1, 3600);
  readonly autoBackfill = booleanEnv('EMBEDDING_AUTO_BACKFILL', true);

  readonly intraOpThreads = integerEnv(
    'EMBEDDING_INTRA_OP_THREADS',
    defaultIntraOpThreads(),
    1,
    16,
  );

  readonly dtype = process.env.EMBEDDING_DTYPE ?? 'q8';
  readonly device = process.env.EMBEDDING_DEVICE ?? 'cpu';
  readonly cacheDir = process.env.EMBEDDING_CACHE_DIR ?? '.cache/transformers';
  readonly localModelPath = process.env.EMBEDDING_LOCAL_MODEL_PATH;
  readonly allowRemoteModels = booleanEnv(
    'EMBEDDING_ALLOW_REMOTE_MODELS',
    true,
  );

  readonly baseUrl = process.env.EMBEDDING_BASE_URL?.replace(/\/$/, '');
  readonly apiKey = process.env.EMBEDDING_API_KEY;
  readonly maxParallelCalls = integerEnv(
    'EMBEDDING_MAX_PARALLEL_CALLS',
    2,
    1,
    32,
  );

  readonly hnswM = integerEnv('EMBEDDING_HNSW_M', 16, 2, 100);
  readonly hnswEfConstruction = integerEnv(
    'EMBEDDING_HNSW_EF_CONSTRUCTION',
    64,
    4,
    2000,
  );
  readonly hnswEfSearch = integerEnv('EMBEDDING_HNSW_EF_SEARCH', 100, 1, 2000);

  constructor() {
    if (!this.enabled) return;
    if (
      this.provider !== 'transformers-js' &&
      this.provider !== 'openai-compatible'
    ) {
      throw new Error(
        'EMBEDDING_PROVIDER must be transformers-js or openai-compatible',
      );
    }
    if (this.provider === 'openai-compatible' && !this.baseUrl) {
      throw new Error(
        'EMBEDDING_BASE_URL is required when EMBEDDING_PROVIDER=openai-compatible',
      );
    }
  }

  space() {
    return {
      provider: this.provider,
      model: this.model,
      revision: this.revision,
      dim: this.dimensions,
      pooling: this.pooling,
      normalized: this.normalize,
    };
  }
}
