import fs from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { setPriority } from 'node:os';
import path from 'node:path';

type WorkerConfig = {
  model: string;
  revision: string;
  pooling: string;
  normalize: boolean;
  dtype: string;
  device: string;
  intraOpThreads?: number;
  cacheDir: string;
  localModelPath?: string;
  allowRemoteModels: boolean;
  /** How the model is loaded and called. Absent means a plain text encoder. */
  family?:
    | 'feature-extraction'
    | 'sentence-embedding'
    | 'embeddinggemma-2'
    | 'clip'
    | 'siglip'
    | 'clap';
  /** Width the workspace stores, for models that can be cut shorter. */
  dimensions?: number;
};

type WorkerMedia = {
  modality: 'image' | 'audio';
  mimeType: string;
  /** Base64, because the request crosses a process boundary as JSON. */
  data: string;
};

type WorkerRequest = {
  id: number;
  /** One of the two is set: a batch is text, or media of one modality. */
  texts?: string[];
  media?: WorkerMedia[];
  config: WorkerConfig;
};

/** A media encoder, loaded only when something needs it. */
type Encoder = 'vision' | 'audio';

type Loaded = {
  key: string;
  encoders: Set<Encoder>;
  embedTexts: (texts: string[], config: WorkerConfig) => Promise<number[][]>;
  embedMedia?: (
    media: WorkerMedia[],
    config: WorkerConfig,
  ) => Promise<number[][]>;
  dispose: () => Promise<void>;
};

// One model resident at a time. Two workspaces on different models alternate
// through this one child, and each model is hundreds of megabytes of native
// allocation the JS heap cannot see.
let loaded: Promise<Loaded> | undefined;
let loadedKey: string | undefined;
let loadedEncoders = new Set<Encoder>();

export function resolveModelSource(config: WorkerConfig): {
  modelSource: string;
  revision: string;
} {
  if (config.allowRemoteModels) {
    return { modelSource: config.model, revision: config.revision };
  }

  // EMBEDDING_LOCAL_MODEL_PATH is a Transformers.js model root, so models are
  // mounted at <root>/<model>/... without the FileCache revision directory.
  // The image's baked-in model uses cacheDir instead, whose pinned files live at
  // <cache>/<model>/<revision>/... and must be addressed directly to avoid the
  // Transformers.js 4.2 tokenizer discovery bug.
  const modelSource = config.localModelPath
    ? path.resolve(config.localModelPath, config.model)
    : path.resolve(config.cacheDir, config.model, config.revision);
  return { modelSource, revision: 'main' };
}

/**
 * Mono 16 kHz samples out of a WAV clip.
 *
 * The scan prepares audio as 16-bit PCM WAV at exactly this rate (see
 * MEDIA_COLLECTION), so this reads that one format rather than carrying a
 * general decoder into a process whose job is inference. Anything else is
 * refused by name instead of being embedded as noise.
 */
export function decodeWavMono16k(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('Audio clip is not a WAV file');
  }
  let format: { channels: number; rate: number; bits: number } | undefined;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (view.getUint16(body, true) !== 1) {
        throw new Error('Audio clip is not PCM');
      }
      format = {
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!format) throw new Error('WAV data came before its format');
      if (format.bits !== 16 || format.rate !== 16000 || format.channels < 1) {
        throw new Error(
          `Audio clip is ${format.rate} Hz, ${format.bits}-bit, ${format.channels} channel(s); expected 16000 Hz, 16-bit`,
        );
      }
      const end = Math.min(bytes.byteLength, body + size);
      const frames = Math.floor((end - body) / (2 * format.channels));
      const samples = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame++) {
        let sum = 0;
        for (let channel = 0; channel < format.channels; channel++) {
          sum += view.getInt16(
            body + (frame * format.channels + channel) * 2,
            true,
          );
        }
        samples[frame] = sum / format.channels / 32768;
      }
      return samples;
    }
    // Chunks are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }
  throw new Error('WAV file has no audio data');
}

/**
 * Cuts each vector to `dimensions` and restores unit length.
 *
 * Only meaningful for a model trained so that a prefix of its vector is
 * itself a usable vector (Matryoshka). The cut is what makes it shorter; the
 * re-normalisation is what keeps a dot product a cosine.
 */
export function truncateVectors(
  vectors: number[][],
  dimensions?: number,
): number[][] {
  return vectors.map((vector) => {
    if (!dimensions || dimensions >= vector.length) return vector;
    const cut = vector.slice(0, dimensions);
    const norm = Math.sqrt(cut.reduce((sum, value) => sum + value * value, 0));
    return norm > 0 ? cut.map((value) => value / norm) : cut;
  });
}

function prepareEnvironment(
  env: {
    cacheDir: string | null;
    allowRemoteModels: boolean;
    localModelPath: string;
  },
  config: WorkerConfig,
): void {
  // Create it here rather than trusting the library to: transformers.js
  // mkdirs lazily, relative to the process cwd, and reports the failure as a
  // bare EACCES with no mention of which directory it wanted or why. Failing
  // here instead names the path.
  try {
    fs.mkdirSync(config.cacheDir, { recursive: true });
  } catch (error) {
    throw new Error(
      `Embedding model cache directory ${config.cacheDir} is not writable ` +
        `(${error instanceof Error ? error.message : String(error)}). Set ` +
        'EMBEDDING_CACHE_DIR to a writable path.',
    );
  }
  env.cacheDir = config.cacheDir;
  env.allowRemoteModels = config.allowRemoteModels;
  if (config.localModelPath) env.localModelPath = config.localModelPath;
}

// Bound inference so it can't starve the host: onnxruntime otherwise threads
// across every core, and its BFC arena hoards allocations until an allocation
// failure aborts the process (observed on desktop as SIGTRAP in
// BFCArena::Extend). Without the arena, tensors go through plain malloc and
// memory returns to the OS between batches.
function sessionOptions(config: WorkerConfig) {
  return {
    intraOpNumThreads: config.intraOpThreads ?? 1,
    interOpNumThreads: 1,
    enableCpuMemArena: false,
  };
}

async function loadFeatureExtraction(
  config: WorkerConfig,
  key: string,
): Promise<Loaded> {
  const { env, pipeline } = await import('@huggingface/transformers');
  prepareEnvironment(env, config);

  // Transformers.js 4.2 discovers pipeline components without forwarding
  // the requested revision. In an offline build that makes it look
  // for tokenizer metadata at <cache>/<model>/ instead of the pinned
  // <cache>/<model>/<revision>/ directory, so it constructs a pipeline with
  // tokenizer=null even though the tokenizer files are present. Point the
  // offline pipeline directly at the cached revision to bypass discovery.
  const offline = !config.allowRemoteModels;
  const { modelSource, revision } = resolveModelSource(config);
  const extractor: any = await pipeline('feature-extraction', modelSource, {
    revision,
    dtype: config.dtype as any,
    device: config.device as any,
    local_files_only: offline,
    session_options: sessionOptions(config),
  } as any);
  return {
    key,
    encoders: new Set(),
    embedTexts: async (texts, request) => {
      const tensor = await extractor(texts, {
        pooling: request.pooling,
        normalize: request.normalize,
      });
      return tensor.tolist();
    },
    dispose: async () => {
      await extractor?.dispose?.();
    },
  };
}

/**
 * EmbeddingGemma 2: one text model, with a vision and an audio encoder that
 * turn media into tokens for it. Whatever goes in, the same 768 numbers come
 * out, which is the whole point — a question typed in words lands next to the
 * picture it describes.
 *
 * The encoders are separate files (195 MB and 340 MB at q8) and are loaded
 * only when asked for. A process that only ever embeds questions — the API,
 * as opposed to the worker — never pays for them.
 */
async function loadEmbeddingGemma2(
  config: WorkerConfig,
  key: string,
  encoders: Set<Encoder>,
): Promise<Loaded> {
  const { env, AutoConfig, AutoModel, AutoProcessor, RawImage } =
    await import('@huggingface/transformers');
  prepareEnvironment(env, config);

  const offline = !config.allowRemoteModels;
  const { modelSource, revision } = resolveModelSource(config);
  const source = { revision, local_files_only: offline };
  const modelConfig: any = await AutoConfig.from_pretrained(
    modelSource,
    source,
  );
  if (!encoders.has('vision')) modelConfig.vision_config = null;
  if (!encoders.has('audio')) modelConfig.audio_config = null;

  const processor: any = await AutoProcessor.from_pretrained(
    modelSource,
    source,
  );
  const model: any = await AutoModel.from_pretrained(modelSource, {
    ...source,
    config: modelConfig,
    dtype: config.dtype as any,
    device: config.device as any,
    session_options: sessionOptions(config),
  });

  const run = async (inputs: unknown, request: WorkerConfig) => {
    const output = await model(inputs);
    // Mean-pooled and unit length already: the model does both itself.
    return truncateVectors(
      output.sentence_embedding.tolist() as number[][],
      request.dimensions,
    );
  };

  return {
    key,
    encoders,
    embedTexts: async (texts, request) =>
      run(
        await processor(texts, null, null, null, { truncation: true }),
        request,
      ),
    embedMedia: async (media, request) => {
      const bytes = media.map((item) => Buffer.from(item.data, 'base64'));
      if (media[0]?.modality === 'audio') {
        // A flat list of clips is one sample per clip.
        const clips = bytes.map((buffer) => decodeWavMono16k(buffer));
        return run(await processor(null, null, clips), request);
      }
      const images = await Promise.all(
        bytes.map((buffer, index) =>
          RawImage.fromBlob(
            new Blob([new Uint8Array(buffer)], { type: media[index].mimeType }),
          ),
        ),
      );
      // One list per picture: a flat list would be read as ONE sample holding
      // every picture, and come back as a single vector.
      return run(
        await processor(
          null,
          images.map((image) => [image]),
        ),
        request,
      );
    },
    dispose: async () => {
      await model?.dispose?.();
    },
  };
}

/**
 * A text model that pools for itself: the graph ends in the finished sentence
 * vector (`sentence_embedding`, or `pooler_output` where the export names it
 * that). EmbeddingGemma has two dense layers after its pooling and Harrier
 * takes its last token; pooling their token states here would give a vector
 * of the right width from the wrong place.
 */
async function loadSentenceEmbedding(
  config: WorkerConfig,
  key: string,
): Promise<Loaded> {
  const { env, AutoModel, AutoTokenizer } =
    await import('@huggingface/transformers');
  prepareEnvironment(env, config);

  const offline = !config.allowRemoteModels;
  const { modelSource, revision } = resolveModelSource(config);
  const source = { revision, local_files_only: offline };
  const tokenizer: any = await AutoTokenizer.from_pretrained(
    modelSource,
    source,
  );
  const model: any = await AutoModel.from_pretrained(modelSource, {
    ...source,
    dtype: config.dtype as any,
    device: config.device as any,
    session_options: sessionOptions(config),
  });
  return {
    key,
    encoders: new Set(),
    embedTexts: async (texts, request) => {
      const output = await model(
        await tokenizer(texts, { padding: true, truncation: true }),
      );
      const pooled = output.sentence_embedding ?? output.pooler_output;
      if (!pooled) {
        throw new Error(
          `Embedding model ${request.model} returned no sentence vector (neither sentence_embedding nor pooler_output)`,
        );
      }
      return truncateVectors(pooled.tolist() as number[][], request.dimensions);
    },
    dispose: async () => {
      await model?.dispose?.();
    },
  };
}

/**
 * 16 kHz samples at 48 kHz, by drawing a straight line between neighbours.
 *
 * Scans store sound at 16 kHz (see MEDIA_COLLECTION) and CLAP listens at 48.
 * Nothing above 8 kHz comes back by doing this — the stored clip never had
 * it — but the model hears the right pitch and the right length, which
 * handing it 16 kHz samples labelled as 48 would not give.
 */
export function upsampleTo48k(samples: Float32Array): Float32Array {
  const out = new Float32Array(samples.length * 3);
  for (let index = 0; index < samples.length; index++) {
    const here = samples[index];
    const next = samples[Math.min(index + 1, samples.length - 1)];
    out[index * 3] = here;
    out[index * 3 + 1] = here + (next - here) / 3;
    out[index * 3 + 2] = here + ((next - here) * 2) / 3;
  }
  return out;
}

/** Tokens SigLIP's text encoder was trained on; it pads every text to that. */
const SIGLIP_TEXT_TOKENS = 64;

/**
 * CLIP, SigLIP and CLAP: one encoder for text and another for pictures (or
 * sound), trained against each other so a caption and what it describes get
 * vectors that point the same way.
 *
 * The media encoder is a separate file and is loaded only when asked for, as
 * with EmbeddingGemma 2: the API embeds questions and never needs it.
 *
 * Their text encoders read a caption, not a document: 77 tokens for CLIP, 64
 * for SigLIP. A longer passage is cut there.
 */
async function loadDualEncoder(
  config: WorkerConfig,
  key: string,
  kind: 'clip' | 'siglip' | 'clap',
  encoders: Set<Encoder>,
): Promise<Loaded> {
  const transformers: any = await import('@huggingface/transformers');
  const { env, AutoProcessor, AutoTokenizer, RawImage } = transformers;
  prepareEnvironment(env, config);

  const offline = !config.allowRemoteModels;
  const { modelSource, revision } = resolveModelSource(config);
  const source = { revision, local_files_only: offline };
  const modelOptions = {
    ...source,
    dtype: config.dtype as any,
    device: config.device as any,
    session_options: sessionOptions(config),
  };
  const classes = {
    clip: ['CLIPTextModelWithProjection', 'CLIPVisionModelWithProjection'],
    siglip: ['SiglipTextModel', 'SiglipVisionModel'],
    clap: ['ClapTextModelWithProjection', 'ClapAudioModelWithProjection'],
  }[kind];

  const tokenizer: any = await AutoTokenizer.from_pretrained(
    modelSource,
    source,
  );
  const textModel: any = await transformers[classes[0]].from_pretrained(
    modelSource,
    modelOptions,
  );
  let processor: any;
  let mediaModel: any;
  if (encoders.size) {
    processor = await AutoProcessor.from_pretrained(modelSource, source);
    mediaModel = await transformers[classes[1]].from_pretrained(
      modelSource,
      modelOptions,
    );
  }

  const vectors = (output: any, request: WorkerConfig): number[][] => {
    const pooled =
      output.text_embeds ??
      output.image_embeds ??
      output.audio_embeds ??
      output.pooler_output;
    return truncateVectors(pooled.tolist() as number[][], request.dimensions);
  };

  return {
    key,
    encoders,
    embedTexts: async (texts, request) =>
      vectors(
        await textModel(
          await tokenizer(
            texts,
            kind === 'siglip'
              ? {
                  padding: 'max_length',
                  max_length: SIGLIP_TEXT_TOKENS,
                  truncation: true,
                }
              : { padding: true, truncation: true },
          ),
        ),
        request,
      ),
    embedMedia: async (media, request) => {
      if (!mediaModel) {
        throw new Error(
          `Embedding model ${request.model} was loaded without its media encoder`,
        );
      }
      const bytes = media.map((item) => Buffer.from(item.data, 'base64'));
      if (kind === 'clap') {
        // One clip a call: the feature extractor takes a single waveform.
        const out: number[][] = [];
        for (const buffer of bytes) {
          const clip = upsampleTo48k(decodeWavMono16k(buffer));
          out.push(...vectors(await mediaModel(await processor(clip)), request));
        }
        return out;
      }
      const images = await Promise.all(
        bytes.map((buffer, index) =>
          RawImage.fromBlob(
            new Blob([new Uint8Array(buffer)], { type: media[index].mimeType }),
          ),
        ),
      );
      return vectors(await mediaModel(await processor(images)), request);
    },
    dispose: async () => {
      await textModel?.dispose?.();
      await mediaModel?.dispose?.();
    },
  };
}

/** Families whose media encoders are separate and loaded on demand. */
const FAMILIES_WITH_ENCODERS = new Set([
  'embeddinggemma-2',
  'clip',
  'siglip',
  'clap',
]);

/** The encoders a batch cannot be embedded without. */
function encodersFor(request: WorkerRequest): Encoder[] {
  const modality = request.media?.[0]?.modality;
  if (modality === 'image') return ['vision'];
  if (modality === 'audio') return ['audio'];
  return [];
}

async function modelFor(request: WorkerRequest): Promise<Loaded> {
  const { config } = request;
  const family = config.family ?? 'feature-extraction';
  // `dimensions` and `normalize` shape the answer, not the loaded model, so
  // they stay out of the key: changing them must not reload the weights.
  const key = JSON.stringify({
    ...config,
    family,
    dimensions: undefined,
    normalize: undefined,
    pooling: undefined,
  });
  const needed = FAMILIES_WITH_ENCODERS.has(family) ? encodersFor(request) : [];
  if (
    loaded &&
    loadedKey === key &&
    needed.every((encoder) => loadedEncoders.has(encoder))
  ) {
    return loaded;
  }

  // Same model with one more encoder keeps the ones it has: a worker that
  // embeds text, then its first picture, reloads once and then stays put
  // rather than swapping back and forth between the two.
  const encoders = new Set<Encoder>(
    loadedKey === key ? [...loadedEncoders, ...needed] : needed,
  );
  // The pipeline being replaced here is replaced repeatedly when workspaces
  // alternate. Dropping the reference does not free it: the weights and the
  // onnxruntime session are native allocations the JS heap cannot see, so V8
  // feels no pressure and may never collect the wrapper that owns them. Every
  // switch would leak a whole resident model.
  const previous = loaded;
  if (previous) {
    await previous.then((model) => model.dispose()).catch(() => undefined);
  }
  loadedKey = key;
  loadedEncoders = encoders;
  loaded =
    family === 'embeddinggemma-2'
      ? loadEmbeddingGemma2(config, key, encoders)
      : family === 'clip' || family === 'siglip' || family === 'clap'
        ? loadDualEncoder(config, key, family, encoders)
        : family === 'sentence-embedding'
          ? loadSentenceEmbedding(config, key)
          : loadFeatureExtraction(config, key);
  // A failed load must not be remembered as the loaded model: the next
  // request would await the same rejection forever instead of trying again.
  loaded.catch(() => {
    if (loadedKey === key) {
      loaded = undefined;
      loadedKey = undefined;
      loadedEncoders = new Set();
    }
  });
  return loaded;
}

// In production this file runs as a forked child process so a native
// onnxruntime crash (e.g. allocation abort under memory pressure) kills only
// this process, never the API — see EmbeddingProviderService. worker_threads
// is still supported for the build smoke test (smoke-embedding-worker.mjs).
function send(message: unknown): void {
  if (parentPort) parentPort.postMessage(message);
  else process.send?.(message);
}

async function handleRequest(request: WorkerRequest): Promise<void> {
  try {
    const model = await modelFor(request);
    let vectors: number[][];
    if (request.media?.length) {
      if (!model.embedMedia) {
        throw new Error(
          `Embedding model ${request.config.model} embeds text only; it cannot take ${request.media[0].modality} input`,
        );
      }
      vectors = await model.embedMedia(request.media, request.config);
    } else {
      vectors = await model.embedTexts(request.texts ?? [], request.config);
    }
    send({ id: request.id, vectors });
  } catch (error) {
    send({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// One inference at a time, whatever arrives. The parent already serialises
// (EmbeddingProviderService.serialize), so this is defence in depth for the
// paths that bypass it — the build smoke test, and any future caller that
// forks this worker directly. Concurrent `Run()` calls are what turn a bounded
// per-batch footprint back into an unbounded one.
let inflight: Promise<void> = Promise.resolve();
const onMessage = (request: WorkerRequest) => {
  inflight = inflight.then(
    () => handleRequest(request),
    () => handleRequest(request),
  );
};
if (parentPort) {
  parentPort.on('message', onMessage);
} else {
  // Forked child: deprioritize so inference yields to the UI and API under
  // load (maps to BELOW_NORMAL on Windows). Embedding is background work.
  try {
    setPriority(10);
  } catch {
    // priority is best-effort (may be denied in sandboxes)
  }
  process.on('message', onMessage);
}
