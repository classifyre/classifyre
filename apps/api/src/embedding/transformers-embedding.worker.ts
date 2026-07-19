import { parentPort } from 'node:worker_threads';
import path from 'node:path';

type WorkerRequest = {
  id: number;
  texts: string[];
  config: {
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
  };
};

let extractorPromise: Promise<any> | undefined;
let extractorKey: string | undefined;

export function resolveModelSource(config: WorkerRequest['config']): {
  modelSource: string;
  revision: string;
} {
  if (config.allowRemoteModels) {
    return { modelSource: config.model, revision: config.revision };
  }

  // EMBEDDING_LOCAL_MODEL_PATH is a Transformers.js model root, so models are
  // mounted at <root>/<model>/... without the FileCache revision directory.
  // The desktop preload uses cacheDir instead, whose pinned files live at
  // <cache>/<model>/<revision>/... and must be addressed directly to avoid the
  // Transformers.js 4.2 tokenizer discovery bug.
  const modelSource = config.localModelPath
    ? path.resolve(config.localModelPath, config.model)
    : path.resolve(config.cacheDir, config.model, config.revision);
  return { modelSource, revision: 'main' };
}

async function extractorFor(config: WorkerRequest['config']) {
  const key = JSON.stringify(config);
  if (extractorPromise && extractorKey === key) return extractorPromise;
  extractorKey = key;
  extractorPromise = (async () => {
    const { env, pipeline } = await import('@huggingface/transformers');
    env.cacheDir = config.cacheDir;
    env.allowRemoteModels = config.allowRemoteModels;
    if (config.localModelPath) env.localModelPath = config.localModelPath;

    // Transformers.js 4.2 discovers pipeline components without forwarding
    // the requested revision. In an offline desktop build that makes it look
    // for tokenizer metadata at <cache>/<model>/ instead of the pinned
    // <cache>/<model>/<revision>/ directory, so it constructs a pipeline with
    // tokenizer=null even though the tokenizer files are present. Point the
    // offline pipeline directly at the cached revision to bypass discovery.
    const offline = !config.allowRemoteModels;
    const { modelSource, revision } = resolveModelSource(config);
    return pipeline('feature-extraction', modelSource, {
      revision,
      dtype: config.dtype as any,
      device: config.device as any,
      local_files_only: offline,
      // Bound inference so it can't starve the host: onnxruntime otherwise
      // threads across every core, and its BFC arena hoards allocations until
      // an allocation failure aborts the process (observed on desktop as
      // SIGTRAP in BFCArena::Extend). Without the arena, tensors go through
      // plain malloc and memory returns to the OS between batches.
      session_options: {
        intraOpNumThreads: config.intraOpThreads ?? 1,
        interOpNumThreads: 1,
        enableCpuMemArena: false,
      },
    } as any);
  })();
  return extractorPromise;
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
    const extractor = await extractorFor(request.config);
    const tensor = await extractor(request.texts, {
      pooling: request.config.pooling,
      normalize: request.config.normalize,
    });
    send({ id: request.id, vectors: tensor.tolist() });
  } catch (error) {
    send({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const onMessage = (request: WorkerRequest) => {
  void handleRequest(request);
};
if (parentPort) {
  parentPort.on('message', onMessage);
} else {
  // Forked child: deprioritize so inference yields to the UI and API under
  // load (maps to BELOW_NORMAL on Windows). Embedding is background work.
  try {
    const { setPriority } = require('node:os') as typeof import('node:os');
    setPriority(10);
  } catch {
    // priority is best-effort (may be denied in sandboxes)
  }
  process.on('message', onMessage);
}
