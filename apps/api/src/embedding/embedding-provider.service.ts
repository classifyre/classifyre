import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { EmbeddingConfigService } from './embedding-config.service';

type PendingRequest = {
  resolve: (vectors: number[][]) => void;
  reject: (error: Error) => void;
};

// After this many consecutive spawn/exit failures, the Transformers.js worker
// is assumed to be unrecoverable for this process (e.g. missing worker file
// or native deps in a packaged build — see bundle-api.mjs) and we stop
// respawning it rather than looping forever every ~2s.
const MAX_CONSECUTIVE_WORKER_FAILURES = 3;

@Injectable()
export class EmbeddingProviderService implements OnApplicationShutdown {
  private readonly logger = new Logger(EmbeddingProviderService.name);
  private worker?: Worker;
  private shuttingDown = false;
  private sequence = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private consecutiveWorkerFailures = 0;
  private workerDisabled = false;

  constructor(private readonly config: EmbeddingConfigService) {}

  async embedMany(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const vectors =
      this.config.provider === 'openai-compatible'
        ? await this.embedRemote(texts)
        : await this.embedLocal(texts);
    const invalid = vectors.find(
      (vector) => vector.length !== this.config.dimensions,
    );
    if (invalid) {
      throw new Error(
        `Embedding model ${this.config.model} returned ${invalid.length} dimensions; EMBEDDING_DIMENSIONS is ${this.config.dimensions}`,
      );
    }
    if (!this.config.normalize) return vectors;
    return vectors.map((vector) => {
      const norm = Math.sqrt(
        vector.reduce((sum, value) => sum + value * value, 0),
      );
      if (!Number.isFinite(norm) || norm === 0) {
        throw new Error(
          `Embedding model ${this.config.model} returned a zero or invalid vector`,
        );
      }
      return vector.map((value) => value / norm);
    });
  }

  private async embedRemote(texts: string[]): Promise<number[][]> {
    const [{ createOpenAICompatible }, { embedMany }] = await Promise.all([
      import('@ai-sdk/openai-compatible'),
      import('ai'),
    ]);
    const provider = createOpenAICompatible({
      name: 'classifyreEmbedding',
      baseURL: this.config.baseUrl as string,
      apiKey: this.config.apiKey,
    });
    const result = await embedMany({
      model: provider.embeddingModel(this.config.model),
      values: texts,
      maxParallelCalls: this.config.maxParallelCalls,
      providerOptions: {
        classifyreEmbedding: { dimensions: this.config.dimensions },
      },
    });
    return result.embeddings;
  }

  private embedLocal(texts: string[]): Promise<number[][]> {
    if (this.workerDisabled) {
      return Promise.reject(
        new Error(
          'Local embedding provider is disabled for this session: the Transformers.js worker failed to start too many times. Restart the app to retry.',
        ),
      );
    }
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({
        id,
        texts,
        config: {
          model: this.config.model,
          revision: this.config.revision,
          pooling: this.config.pooling,
          normalize: this.config.normalize,
          dtype: this.config.dtype,
          device: this.config.device,
          cacheDir: this.config.cacheDir,
          localModelPath: this.config.localModelPath,
          allowRemoteModels: this.config.allowRemoteModels,
        },
      });
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const workerPath = path.join(__dirname, 'transformers-embedding.worker.js');
    const worker = new Worker(workerPath);
    // A crashed worker typically fires both 'error' and 'exit' for the same
    // underlying failure; guard so one crash only counts once.
    let failureRecorded = false;
    const recordFailure = () => {
      if (failureRecorded) return;
      failureRecorded = true;
      this.registerWorkerFailure();
    };
    worker.on(
      'message',
      (message: { id: number; vectors?: number[][]; error?: string }) => {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          this.consecutiveWorkerFailures = 0;
          pending.resolve(message.vectors ?? []);
        }
      },
    );
    worker.on('error', (error: unknown) => {
      const resolved =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Transformers.js worker failed: ${resolved.message}`);
      for (const pending of this.pending.values()) pending.reject(resolved);
      this.pending.clear();
      this.worker = undefined;
      recordFailure();
    });
    worker.on('exit', (code) => {
      if (code !== 0 && !this.shuttingDown) {
        this.logger.error(`Transformers.js worker exited with code ${code}`);
        recordFailure();
      }
      this.worker = undefined;
    });
    this.worker = worker;
    return worker;
  }

  private registerWorkerFailure(): void {
    this.consecutiveWorkerFailures += 1;
    if (
      this.workerDisabled ||
      this.consecutiveWorkerFailures < MAX_CONSECUTIVE_WORKER_FAILURES
    ) {
      return;
    }
    this.workerDisabled = true;
    this.logger.error(
      `Transformers.js worker failed ${this.consecutiveWorkerFailures} times; embedding provider disabled for this session`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.worker?.terminate();
  }
}
