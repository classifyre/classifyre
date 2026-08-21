import {
  Injectable,
  Logger,
  Optional,
  OnApplicationShutdown,
} from '@nestjs/common';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { EmbeddingConfigService } from './embedding-config.service';
import {
  resolvedFromEnv,
  type EmbeddingSettingsService,
  type ResolvedEmbeddingConfig,
} from './embedding-settings.service';

type PendingRequest = {
  resolve: (vectors: number[][]) => void;
  reject: (error: Error) => void;
};

// After this many consecutive spawn/exit failures, the Transformers.js worker
// is assumed to be unhealthy and we stop respawning it rather than looping
// forever every ~2s.
const MAX_CONSECUTIVE_WORKER_FAILURES = 3;

/**
 * How long the breaker stays open before letting one request probe the worker.
 *
 * The breaker was originally latched for the lifetime of the process, which
 * suits exactly one of the two failures that trip it:
 *
 *  - **Permanent** — a missing worker file or native dep in a packaged build
 *    (see bundle-api.mjs). Never recovers; respawning is a 2-second loop.
 *  - **Transient** — onnxruntime aborting natively under host memory pressure
 *    (`SIGTRAP` in `BFCArena::Extend`). Recovers on its own once the pressure
 *    eases. Observed on desktop: 24 such aborts over two days, in bursts, on a
 *    machine sitting at 5477 MB of 6144 MB swap.
 *
 * Latching for both meant one bad minute silently ended semantic embedding for
 * the rest of the session — no retry, no recovery, and nothing in the UI to
 * say so. Backing off instead serves both: transient pressure heals within a
 * cooldown or two, while a genuinely broken install retries every few minutes
 * rather than every two seconds, which is what the latch was really protecting
 * against.
 */
const BREAKER_BASE_COOLDOWN_MS = 60_000;
const BREAKER_MAX_COOLDOWN_MS = 15 * 60_000;

/** Cooldown after `trips` consecutive breaker trips, doubling to a ceiling. */
export function breakerCooldownMs(trips: number): number {
  const exponent = Math.max(0, trips - 1);
  // Shifting past 31 overflows; the ceiling clamps long before that anyway.
  const scaled =
    exponent > 30
      ? BREAKER_MAX_COOLDOWN_MS
      : BREAKER_BASE_COOLDOWN_MS * 2 ** exponent;
  return Math.min(scaled, BREAKER_MAX_COOLDOWN_MS);
}

@Injectable()
export class EmbeddingProviderService implements OnApplicationShutdown {
  private readonly logger = new Logger(EmbeddingProviderService.name);
  private worker?: ChildProcess;
  private shuttingDown = false;
  private sequence = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private consecutiveWorkerFailures = 0;
  /** Epoch ms the breaker reopens for a probe; undefined when closed. */
  private disabledUntil?: number;
  /** Consecutive trips, for the backoff. Reset by a successful embed. */
  private breakerTrips = 0;
  /** Injectable clock so the backoff can be tested without waiting minutes. */
  private now: () => number = () => Date.now();
  private requestErrorCount = 0;
  private lastRequestError?: string;
  private lastRequestErrorAt?: string;

  constructor(
    private readonly config: EmbeddingConfigService,
    // Optional and last: the unit tests construct this service positionally.
    @Optional() private readonly settings?: EmbeddingSettingsService,
  ) {}

  /**
   * Effective configuration, unless the caller passes its own.
   *
   * The worker is deliberately one process for the whole API, so when two
   * workspaces run different models it re-creates its pipeline as requests
   * alternate. That is a throughput cost, not a correctness one — each request
   * carries the configuration it must be answered with — and it is the reason
   * callers that already know their workspace's configuration pass it in.
   */
  private resolve(override?: ResolvedEmbeddingConfig): ResolvedEmbeddingConfig {
    return override ?? this.settings?.cached() ?? resolvedFromEnv(this.config);
  }

  /** True while the breaker is open and its cooldown has not yet elapsed. */
  private get workerDisabled(): boolean {
    return this.disabledUntil != null && this.now() < this.disabledUntil;
  }

  /** Provider-level failure state, surfaced via GET /embeddings/status. */
  status() {
    return {
      workerDisabled: this.workerDisabled,
      // When embedding resumes. Previously the answer was "never, restart the
      // app", which the status endpoint had no way to express.
      workerRetryAt:
        this.disabledUntil != null
          ? new Date(this.disabledUntil).toISOString()
          : null,
      requestErrorCount: this.requestErrorCount,
      lastRequestError: this.lastRequestError ?? null,
      lastRequestErrorAt: this.lastRequestErrorAt ?? null,
    };
  }

  async embedMany(
    texts: string[],
    override?: ResolvedEmbeddingConfig,
  ): Promise<number[][]> {
    if (!texts.length) return [];
    const cfg = this.resolve(override);
    const vectors =
      cfg.provider === 'openai-compatible'
        ? await this.embedRemote(texts, cfg)
        : await this.embedLocal(texts, cfg);
    const invalid = vectors.find((vector) => vector.length !== cfg.dimensions);
    if (invalid) {
      throw new Error(
        `Embedding model ${cfg.model} returned ${invalid.length} dimensions, but this workspace is configured for ${cfg.dimensions}`,
      );
    }
    if (!cfg.normalize) return vectors;
    return vectors.map((vector) => {
      const norm = Math.sqrt(
        vector.reduce((sum, value) => sum + value * value, 0),
      );
      if (!Number.isFinite(norm) || norm === 0) {
        throw new Error(
          `Embedding model ${cfg.model} returned a zero or invalid vector`,
        );
      }
      return vector.map((value) => value / norm);
    });
  }

  private async embedRemote(
    texts: string[],
    cfg: ResolvedEmbeddingConfig = this.resolve(),
  ): Promise<number[][]> {
    const [{ createOpenAICompatible }, { embedMany }] = await Promise.all([
      import('@ai-sdk/openai-compatible'),
      import('ai'),
    ]);
    const provider = createOpenAICompatible({
      name: 'classifyreEmbedding',
      baseURL: cfg.baseUrl as string,
      apiKey: cfg.apiKey,
    });
    const result = await embedMany({
      model: provider.embeddingModel(cfg.model),
      values: texts,
      maxParallelCalls: cfg.maxParallelCalls,
      providerOptions: {
        classifyreEmbedding: { dimensions: cfg.dimensions },
      },
    });
    return result.embeddings;
  }

  private embedLocal(
    texts: string[],
    // Defaulted rather than required: the breaker tests drive this directly to
    // exercise spawn failures, and a configuration is never the thing they are
    // varying.
    cfg: ResolvedEmbeddingConfig = this.resolve(),
  ): Promise<number[][]> {
    if (this.workerDisabled) {
      const seconds = Math.ceil((this.disabledUntil! - this.now()) / 1000);
      return Promise.reject(
        new Error(
          `Local embedding provider is paused: the Transformers.js worker failed ${MAX_CONSECUTIVE_WORKER_FAILURES} times in a row. Retrying in ${seconds}s.`,
        ),
      );
    }
    if (this.disabledUntil != null) {
      // Cooldown elapsed: this request is the probe. Carry the failure count so
      // one more failure re-trips immediately rather than spending a fresh
      // budget of spawns on every cooldown.
      this.disabledUntil = undefined;
      this.consecutiveWorkerFailures = MAX_CONSECUTIVE_WORKER_FAILURES - 1;
      this.logger.log(
        'Cooldown elapsed; probing the Transformers.js worker again',
      );
    }
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.send({
        id,
        texts,
        config: {
          model: cfg.model,
          revision: cfg.revision,
          pooling: cfg.pooling,
          normalize: cfg.normalize,
          dtype: cfg.dtype,
          device: cfg.device,
          intraOpThreads: cfg.intraOpThreads,
          cacheDir: cfg.cacheDir,
          localModelPath: cfg.localModelPath,
          allowRemoteModels: cfg.allowRemoteModels,
        },
      });
    });
  }

  private ensureWorker(): ChildProcess {
    if (this.worker) return this.worker;
    const workerPath = path.join(__dirname, 'transformers-embedding.worker.js');
    // A forked child process, not a worker_thread: onnxruntime inference can
    // abort the whole process natively (allocation failure under memory
    // pressure trips SIGTRAP inside BFCArena), and in a thread that took the
    // entire API down. In a child process it only kills the child; the batch
    // fails, pg-boss retries, and the API keeps serving.
    const worker = fork(workerPath);
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
          // Every embed request failing here is invisible otherwise (the
          // worker survives, so 'error'/'exit' never fire). Log the first
          // failure at full volume, then throttle — a broken model cache
          // fails every request and would otherwise flood the log.
          this.requestErrorCount += 1;
          this.lastRequestError = message.error;
          this.lastRequestErrorAt = new Date().toISOString();
          if (
            this.requestErrorCount === 1 ||
            this.requestErrorCount % 100 === 0
          ) {
            this.logger.error(
              `Embedding request failed (${this.requestErrorCount} total): ${message.error}`,
            );
          }
          pending.reject(new Error(message.error));
        } else {
          // A completed batch is the only proof the worker is healthy, so it
          // is what clears the backoff — not merely surviving a spawn.
          this.consecutiveWorkerFailures = 0;
          if (this.breakerTrips > 0) {
            this.logger.log(
              `Transformers.js worker recovered after ${this.breakerTrips} trip(s); embedding resumed`,
            );
          }
          this.breakerTrips = 0;
          this.disabledUntil = undefined;
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
    worker.on('exit', (code, signal) => {
      if ((code !== 0 || signal) && !this.shuttingDown) {
        this.logger.error(
          `Transformers.js worker exited with code ${code}${signal ? ` (signal ${signal})` : ''}`,
        );
        recordFailure();
      }
      // A native crash fires 'exit' without 'error'; requests still in flight
      // would otherwise hang forever.
      const exitError = new Error(
        `Embedding worker exited (code ${code}${signal ? `, signal ${signal}` : ''}) before responding`,
      );
      for (const pending of this.pending.values()) pending.reject(exitError);
      this.pending.clear();
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
    this.breakerTrips += 1;
    const cooldown = breakerCooldownMs(this.breakerTrips);
    this.disabledUntil = this.now() + cooldown;
    this.logger.error(
      `Transformers.js worker failed ${this.consecutiveWorkerFailures} times; pausing embedding for ${Math.round(cooldown / 1000)}s (trip ${this.breakerTrips})`,
    );
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true;
    this.worker?.kill();
  }
}
