import {
  Injectable,
  Logger,
  Optional,
  OnApplicationShutdown,
} from '@nestjs/common';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { EmbeddingConfigService } from './embedding-config.service';
import { planInferenceBatches, planRemoteCalls } from './embedding-batching';
import {
  MAX_MEDIA_BYTES,
  type EmbeddingMediaItem,
  type MediaModality,
} from './embedding-modality';
import { localModelProfile } from './embedding-local-models';
import { embedMediaRemote } from './embedding-media-remote';
import { probeMedia } from './embedding-media-probe';
import {
  resolvedFromEnv,
  // A value import, not `import type`: `emitDecoratorMetadata` writes
  // design:paramtypes from the imported binding, and a type-only import is
  // erased before that metadata is emitted. Nest then cannot resolve the
  // parameter and — because it is @Optional() — quietly injects undefined, so
  // every read here fell back to the deployment defaults and the workspace's
  // own embedding settings were ignored by everything but the settings page.
  EmbeddingSettingsService,
  type ResolvedEmbeddingConfig,
} from './embedding-settings.service';

/**
 * Which side of a search a text is on. Models trained with task prompts
 * (EmbeddingGemma, E5, Nomic) embed "what is stored" and "what is asked"
 * differently, and the caller is the only one who knows which it is sending.
 */
export type EmbeddingRole = 'document' | 'query';

/** The texts as the model must see them: its task prompt in front of each. */
export function withTaskPrompt(
  texts: string[],
  cfg: Pick<ResolvedEmbeddingConfig, 'documentPrefix' | 'queryPrefix'>,
  role: EmbeddingRole,
): string[] {
  const prefix = role === 'query' ? cfg.queryPrefix : cfg.documentPrefix;
  return prefix ? texts.map((text) => prefix + text) : texts;
}

/** Megabytes a listed model downloads with all its parts; undefined when it is not on the list. */
function expectedDownloadMb(model: string): number | undefined {
  const sizes = localModelProfile(model)?.downloadMb;
  if (!sizes) return undefined;
  return sizes.text + (sizes.image ?? 0) + (sizes.audio ?? 0);
}

/**
 * Media items handed to one local inference call.
 *
 * A picture is a few hundred tokens whatever its content, so unlike text the
 * cost of a batch is known in advance and small batches are simply the safe
 * side of it. A clip is 25 tokens a second and its features pad to the longest
 * clip present, so sound goes one at a time.
 */
const LOCAL_MEDIA_BATCH: Record<MediaModality, number> = {
  image: 2,
  audio: 1,
};

/** What the worker is asked to embed: a batch of text, or of one modality. */
type WorkerPayload =
  | { texts: string[] }
  | {
      media: Array<{ modality: MediaModality; mimeType: string; data: string }>;
    };

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

/**
 * How long one inference call may occupy the queue before it is abandoned.
 *
 * Serialising local inference is what makes the memory bound a ceiling rather
 * than a per-caller quota, but it also means one stuck call stops embedding
 * for the whole process instead of for one caller. The child dying is already
 * handled — 'exit' rejects everything in flight — but a child that hangs
 * without exiting emits nothing at all, and onnxruntime does hang under memory
 * pressure (the SIGTRAP-in-BFCArena aborts seen on desktop are the same
 * pressure, one step further along).
 *
 * Ten minutes is far longer than any bounded batch legitimately takes and
 * still well inside pg-boss's one-hour job expiry, so a wedged child surfaces
 * as a failed batch that retries rather than as embedding silently stopping
 * forever.
 */
const INFERENCE_TIMEOUT_MS = 10 * 60_000;

/** Cooldown after `trips` consecutive breaker trips, doubling to a ceiling. */
/**
 * Base URL an OpenAI-compatible embeddings client should be pointed at.
 *
 * The AI SDK appends `/embeddings` to whatever base it is given, so the URL a
 * user naturally copies out of a provider's own curl example — the complete
 * endpoint — becomes `/v1/embeddings/embeddings` and comes back as a bare 404.
 * That 404 is indistinguishable from a wrong model name in the UI, which is
 * exactly the wrong place to send someone whose credential is fine. Both forms
 * are accepted here and mean the same endpoint.
 */
export function normalizeEmbeddingBaseUrl(url?: string): string | undefined {
  const trimmed = url?.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;
  const stripped = trimmed.replace(/\/embeddings$/i, '');
  // A base of exactly "https://host/embeddings" would otherwise strip down to
  // an origin the provider does not serve; keep whichever form is non-empty.
  return stripped || trimmed;
}

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
  /** Tail of the local-inference queue; see {@link serialize}. */
  private inferenceQueue: Promise<void> = Promise.resolve();
  private requestErrorCount = 0;
  /**
   * Native aborts of the forked inference child, cumulative for this process.
   *
   * Separate from `requestErrorCount`, which counts requests the child
   * answered with an error while staying alive. A native abort leaves no trace
   * inside the product at all — the child dies, the batch fails, pg-boss
   * retries — so on desktop the only evidence was a macOS crash report,
   * which reads like the app crashed when the fork is what stopped it from
   * doing so. Counting it here is what makes the containment visible.
   */
  private workerCrashCount = 0;
  private lastWorkerCrashAt?: string;
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
      workerCrashCount: this.workerCrashCount,
      lastWorkerCrashAt: this.lastWorkerCrashAt ?? null,
      consecutiveWorkerFailures: this.consecutiveWorkerFailures,
      breakerTrips: this.breakerTrips,
    };
  }

  /**
   * Proves a provider can actually embed, for the "test connection" button.
   *
   * The generic AI-provider test sends a chat completion, which an embeddings
   * endpoint answers with a 404 or a model-not-found — so a perfectly working
   * embedding credential tested as broken. This asks the endpoint the only
   * question it can answer, and checks the one thing that silently breaks
   * later: whether the vector that comes back is the width the workspace is
   * configured for.
   */
  async testConnection(
    cfg: ResolvedEmbeddingConfig,
    options: { declaredDimensions?: number | null } = {},
  ): Promise<{
    dimensions: number;
    expectedDimensions: number | null;
    durationMs: number;
    /** Media kinds the endpoint was sent, and embedded into the same width. */
    media: MediaModality[];
  }> {
    const startedAt = Date.now();
    const probe = 'Classifyre embedding connection test.';
    // A width the operator never stated must not be asked for: providers that
    // honour `dimensions` (OpenAI does) truncate to it and hand back a vector
    // that matches the guess, so the probe passes while proving nothing about
    // the model's real width.
    const declared = options.declaredDimensions ?? null;
    const vectors =
      cfg.provider === 'openai-compatible'
        ? await this.embedRemote([probe], cfg, {
            sendDimensions: declared != null,
          })
        : await this.embedLocal([probe], cfg);
    const vector = vectors[0];
    if (!vector?.length) {
      throw new Error('The provider returned no vector for the probe text.');
    }
    // A model that says it takes pictures is sent one. Text answering proves
    // nothing about the vision encoder being loaded, or about the request
    // shape chosen for it, and both fail on the first scanned picture
    // otherwise — after the workspace has been rebuilt for this model.
    for (const modality of cfg.mediaModalities) {
      const [mediaVector] = await this.embedMediaRaw(
        [probeMedia(modality)],
        cfg,
        { sendDimensions: declared != null },
      );
      if (mediaVector?.length !== vector.length) {
        throw new Error(
          `The provider embedded the test ${modality} into ${mediaVector?.length ?? 0} dimensions and the test text into ${vector.length}; ` +
            'they have to be the same model in the same vector space.',
        );
      }
    }
    return {
      dimensions: vector.length,
      expectedDimensions: declared,
      durationMs: Date.now() - startedAt,
      media: [...cfg.mediaModalities],
    };
  }

  async embedMany(
    texts: string[],
    override?: ResolvedEmbeddingConfig,
    // Everything that is stored is a document. Only a search says otherwise.
    role: EmbeddingRole = 'document',
  ): Promise<number[][]> {
    if (!texts.length) return [];
    const cfg = this.resolve(override);
    const inputs = withTaskPrompt(texts, cfg, role);
    const startedAt = Date.now();
    const vectors =
      cfg.provider === 'openai-compatible'
        ? await this.embedRemote(inputs, cfg)
        : await this.embedLocal(inputs, cfg);
    this.logEmbedded(
      `${texts.length} ${role} text(s), ${inputs.reduce((sum, text) => sum + text.length, 0)} chars`,
      startedAt,
      cfg,
    );
    return this.checked(vectors, cfg);
  }

  /**
   * One line per inference call, at debug level: what was embedded, how long
   * it took, with which model. It is the only place the speed of a model on
   * this machine can be read from; a local call's time includes its wait
   * behind whatever else the one worker was doing.
   */
  private logEmbedded(
    what: string,
    startedAt: number,
    cfg: ResolvedEmbeddingConfig,
  ): void {
    this.logger.debug(
      `Embedded ${what} in ${Date.now() - startedAt} ms with ${cfg.model}`,
    );
  }

  /**
   * Pictures and clips as vectors in the workspace's space, in input order.
   *
   * No task prompt: a prompt is words, and a model trained with prompts puts
   * them in front of text only. Whether the model can take the modality at all
   * is the caller's to have checked against `cfg.mediaModalities` — this
   * refuses rather than guesses when it cannot.
   */
  async embedMedia(
    items: EmbeddingMediaItem[],
    override?: ResolvedEmbeddingConfig,
  ): Promise<number[][]> {
    if (!items.length) return [];
    const cfg = this.resolve(override);
    const startedAt = Date.now();
    const vectors = await this.embedMediaRaw(items, cfg);
    for (const modality of new Set(items.map((item) => item.modality))) {
      this.logEmbedded(
        `${items.filter((item) => item.modality === modality).length} ${modality} item(s)`,
        startedAt,
        cfg,
      );
    }
    return this.checked(vectors, cfg);
  }

  /** Media vectors exactly as the model returned them. */
  private async embedMediaRaw(
    items: EmbeddingMediaItem[],
    cfg: ResolvedEmbeddingConfig,
    options: { sendDimensions?: boolean } = {},
  ): Promise<number[][]> {
    const unsupported = items.find(
      (item) => !cfg.supportedMedia.includes(item.modality),
    );
    if (unsupported) {
      throw new Error(
        `Embedding model ${cfg.model} does not embed ${unsupported.modality} content`,
      );
    }
    const oversized = items.find(
      (item) => item.data.byteLength > MAX_MEDIA_BYTES,
    );
    if (oversized) {
      throw new Error(
        `A ${oversized.modality} item of ${oversized.data.byteLength} bytes exceeds the ${MAX_MEDIA_BYTES}-byte limit`,
      );
    }
    if (cfg.provider !== 'openai-compatible') {
      return this.embedLocalMedia(items, cfg);
    }
    const baseUrl = normalizeEmbeddingBaseUrl(cfg.baseUrl);
    if (!baseUrl || !cfg.mediaFormat) {
      throw new Error(
        'This workspace embeds media through a remote provider, but the provider has no endpoint or no media request format set.',
      );
    }
    return embedMediaRemote(
      cfg.mediaFormat,
      {
        baseUrl,
        apiKey: cfg.apiKey || undefined,
        model: cfg.model,
        dimensions:
          options.sendDimensions === false ? undefined : cfg.dimensions,
      },
      items,
      { parallel: cfg.maxParallelCalls },
    );
  }

  /** The dimension check and normalisation every stored vector goes through. */
  private checked(
    vectors: number[][],
    cfg: ResolvedEmbeddingConfig,
  ): number[][] {
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
    options: { sendDimensions?: boolean } = {},
  ): Promise<number[][]> {
    const baseURL = normalizeEmbeddingBaseUrl(cfg.baseUrl);
    if (!baseURL) {
      throw new Error(
        'This workspace is set to a remote embedding provider but no endpoint is bound. ' +
          'Pick an AI provider under Settings -> Embeddings, or switch back to the local model.',
      );
    }
    const [{ createOpenAICompatible }, { embedMany }] = await Promise.all([
      import('@ai-sdk/openai-compatible'),
      import('ai'),
    ]);
    const provider = createOpenAICompatible({
      name: 'classifyreEmbedding',
      baseURL,
      // Empty for a self-hosted endpoint that takes no key: send no
      // Authorization header rather than "Bearer " with nothing after it.
      apiKey: cfg.apiKey || undefined,
    });
    const model = provider.embeddingModel(cfg.model);
    const providerOptions: Record<string, { dimensions: number }> =
      options.sendDimensions === false
        ? {}
        : { classifyreEmbedding: { dimensions: cfg.dimensions } };
    // One request per group of at most 96 texts, `maxParallelCalls` at a time:
    // the SDK would otherwise send a whole queue fetch in one request, which
    // Gemini refuses above 100 (see MAX_REMOTE_EMBEDDINGS_PER_CALL).
    const groups = planRemoteCalls(texts);
    const vectors: number[][][] = new Array(groups.length);
    let next = 0;
    try {
      await Promise.all(
        Array.from(
          {
            length: Math.max(
              1,
              Math.min(cfg.maxParallelCalls || 1, groups.length),
            ),
          },
          async () => {
            while (next < groups.length) {
              const index = next++;
              const result = await embedMany({
                model,
                values: groups[index],
                maxParallelCalls: 1,
                providerOptions,
              });
              vectors[index] = result.embeddings;
            }
          },
        ),
      );
      return vectors.flat();
    } catch (error) {
      // The SDK's message is the bare status ("Not Found"), which reads as a
      // wrong model name however the request was actually malformed. Say what
      // was asked of whom.
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message} (POST ${baseURL}/embeddings, model "${cfg.model}")`,
        { cause: error },
      );
    }
  }

  private embedLocal(
    texts: string[],
    // Defaulted rather than required: the breaker tests drive this directly to
    // exercise spawn failures, and a configuration is never the thing they are
    // varying.
    cfg: ResolvedEmbeddingConfig = this.resolve(),
  ): Promise<number[][]> {
    try {
      this.assertWorkerAvailable();
    } catch (error) {
      return Promise.reject(error as Error);
    }
    // Bounded, then serialised. Both are needed: the bound caps what ONE
    // inference call may allocate, the queue stops N callers from each
    // allocating that much at the same time in the one child process.
    const batches = planInferenceBatches(texts, {
      maxRows: cfg.batchSize,
      maxPaddedChars: this.config.maxBatchChars,
    });
    return this.serialize(async () => {
      const vectors: number[][] = [];
      for (const batch of batches) {
        vectors.push(...(await this.sendBatch({ texts: batch }, cfg)));
      }
      return vectors;
    });
  }

  /**
   * Refuses while the breaker is open, and turns the first request after its
   * cooldown into the probe.
   */
  private assertWorkerAvailable(): void {
    if (this.workerDisabled) {
      const seconds = Math.ceil((this.disabledUntil! - this.now()) / 1000);
      throw new Error(
        `Local embedding provider is paused: the Transformers.js worker failed ${MAX_CONSECUTIVE_WORKER_FAILURES} times in a row. Retrying in ${seconds}s.`,
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
  }

  /**
   * Media through the local worker: grouped by modality (a batch is one kind
   * of content), bounded per call, and queued behind everything else the one
   * child is doing.
   */
  private embedLocalMedia(
    items: EmbeddingMediaItem[],
    cfg: ResolvedEmbeddingConfig,
  ): Promise<number[][]> {
    this.assertWorkerAvailable();
    return this.serialize(async () => {
      const vectors: number[][] = new Array<number[]>(items.length);
      const indexes = items.map((_, index) => index);
      for (const modality of new Set(items.map((item) => item.modality))) {
        const group = indexes.filter(
          (index) => items[index].modality === modality,
        );
        const size = LOCAL_MEDIA_BATCH[modality];
        for (let offset = 0; offset < group.length; offset += size) {
          const batch = group.slice(offset, offset + size);
          const answered = await this.sendBatch(
            {
              media: batch.map((index) => ({
                modality,
                mimeType: items[index].mimeType,
                data: items[index].data.toString('base64'),
              })),
            },
            cfg,
          );
          batch.forEach((index, position) => {
            vectors[index] = answered[position];
          });
        }
      }
      return vectors;
    });
  }

  /**
   * Run local inference one call at a time, process-wide.
   *
   * There is a single forked child for the whole process, and it answers
   * messages concurrently — every message it receives starts its own
   * `extractor()` call, so two callers mean two simultaneous onnxruntime
   * `Run()`s and twice the native peak. The callers are genuinely concurrent:
   * every namespace registers its own embedding queue and up to
   * MAX_CONCURRENT_NAMESPACE_JOBS of them hold a worker slot at once, with
   * interactive query embedding arriving on top of that.
   *
   * Serialising here is what makes the ceiling a ceiling rather than a
   * per-caller quota. It costs nothing in throughput: the child cannot
   * actually run two batches in parallel any faster than two in sequence,
   * since both contend for the same intra-op thread pool.
   */
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.inferenceQueue.then(operation, operation);
    // Chained off the settled result so one failure does not poison the queue
    // for every request behind it.
    this.inferenceQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private sendBatch(
    payload: WorkerPayload,
    cfg: ResolvedEmbeddingConfig,
  ): Promise<number[][]> {
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    const size =
      'texts' in payload
        ? `${payload.texts.length} texts`
        : `${payload.media.length} ${payload.media[0]?.modality ?? 'media'} item(s)`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(
          new Error(
            `Embedding worker did not answer batch ${id} (${size}) within ${INFERENCE_TIMEOUT_MS / 60_000} minutes`,
          ),
        );
      }, INFERENCE_TIMEOUT_MS);
      // Never hold the process open for a timer that only guards a background
      // batch; shutdown must not wait ten minutes for it.
      timer.unref?.();
      const settle =
        <T>(handler: (value: T) => void) =>
        (value: T) => {
          clearTimeout(timer);
          handler(value);
        };
      this.pending.set(id, {
        resolve: settle(resolve),
        reject: settle(reject),
      });
      worker.send({
        id,
        ...payload,
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
          family: cfg.localFamily,
          dimensions: cfg.dimensions,
          cacheMaxMb: this.config.cacheMaxMb,
          expectedMb: expectedDownloadMb(cfg.model),
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
    this.workerCrashCount += 1;
    this.lastWorkerCrashAt = new Date(this.now()).toISOString();
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
