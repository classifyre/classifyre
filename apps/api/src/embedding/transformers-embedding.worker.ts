import { parentPort } from 'node:worker_threads';

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
    cacheDir: string;
    localModelPath?: string;
    allowRemoteModels: boolean;
  };
};

let extractorPromise: Promise<any> | undefined;
let extractorKey: string | undefined;

async function extractorFor(config: WorkerRequest['config']) {
  const key = JSON.stringify(config);
  if (extractorPromise && extractorKey === key) return extractorPromise;
  extractorKey = key;
  extractorPromise = (async () => {
    const { env, pipeline } = await import('@huggingface/transformers');
    env.cacheDir = config.cacheDir;
    env.allowRemoteModels = config.allowRemoteModels;
    if (config.localModelPath) env.localModelPath = config.localModelPath;
    return pipeline('feature-extraction', config.model, {
      revision: config.revision,
      dtype: config.dtype as any,
      device: config.device as any,
    });
  })();
  return extractorPromise;
}

async function handleRequest(request: WorkerRequest): Promise<void> {
  try {
    const extractor = await extractorFor(request.config);
    const tensor = await extractor(request.texts, {
      pooling: request.config.pooling,
      normalize: request.config.normalize,
    });
    parentPort?.postMessage({ id: request.id, vectors: tensor.tolist() });
  } catch (error) {
    parentPort?.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

parentPort?.on('message', (request: WorkerRequest) => {
  void handleRequest(request);
});
