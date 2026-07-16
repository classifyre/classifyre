import { env, pipeline } from '@huggingface/transformers';

const model = process.env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
const revision =
  process.env.EMBEDDING_MODEL_REVISION ??
  '751bff37182d3f1213fa05d7196b954e230abad9';

async function main() {
  env.cacheDir = process.env.EMBEDDING_CACHE_DIR ?? '.cache/transformers';
  const extractor = await pipeline('feature-extraction', model, {
    revision,
    dtype: 'q8',
    device: 'cpu',
  });
  await extractor(['classifyre embedding cache warmup'], {
    pooling: 'mean',
    normalize: true,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
