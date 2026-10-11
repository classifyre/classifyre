import type { MediaModality } from './embedding-modality';

/**
 * How the local worker has to load and call a model.
 *
 *  - `feature-extraction` — a text encoder behind Transformers.js's pipeline of
 *    that name, pooled here (see {@link LocalEmbeddingModel.pooling}).
 *  - `sentence-embedding` — a text model that does its own pooling and hands
 *    back the finished sentence vector (EmbeddingGemma, Harrier, Voyage nano).
 *    Pooling its token states here instead would skip the layers after them.
 *  - `embeddinggemma-2` — one text model with a vision and an audio encoder in
 *    front of it, called through its own processor. Text, pictures and sound
 *    come out in the same 768 numbers.
 *  - `clip`, `siglip` — two separate encoders, one for text and one for
 *    pictures, trained so that a caption and its picture point the same way.
 *  - `clap` — the same idea for text and sound.
 */
export type LocalModelFamily =
  | 'feature-extraction'
  | 'sentence-embedding'
  | 'embeddinggemma-2'
  | 'clip'
  | 'siglip'
  | 'clap';

/** How token states become one vector, for the `feature-extraction` family. */
export type LocalModelPooling = 'mean' | 'cls' | 'last_token' | 'none';

/** A model the built-in (Transformers.js) provider is known to run. */
export interface LocalEmbeddingModel {
  /** Hugging Face repository that holds the ONNX files. */
  id: string;
  label: string;
  dimensions: number;
  pooling: LocalModelPooling;
  family: LocalModelFamily;
  /** What it embeds besides text. Empty for a text-only model. */
  mediaModalities: readonly MediaModality[];
  /** Task prompts the model was trained with. Absent: text goes in as it is. */
  documentPrefix?: string;
  queryPrefix?: string;
  /**
   * Other names people know the model by that this runtime cannot load: the
   * author's own repository holds PyTorch weights, and only the ONNX
   * conversion runs here. Typing one of these selects the entry.
   */
  aliases?: readonly string[];
  /**
   * Megabytes fetched on first use at the default (q8) precision, per part:
   * the text model, and each encoder a workspace turns on. Stated only where
   * the size is worth knowing before choosing.
   */
  downloadMb?: { text: number; image?: number; audio?: number };
}

/**
 * The one-sentence task that instruction-tuned models (Qwen3, Harrier) expect
 * in front of a question, as their model cards write it. Stored passages get
 * nothing.
 */
const WEB_SEARCH_INSTRUCTION =
  'Instruct: Given a web search query, retrieve relevant passages that answer the query';

const EMBEDDINGGEMMA_2: LocalEmbeddingModel = {
  id: 'onnx-community/embeddinggemma-2-ONNX',
  label: 'EmbeddingGemma 2 — text, pictures and sound in one space',
  dimensions: 768,
  pooling: 'mean',
  family: 'embeddinggemma-2',
  mediaModalities: ['image', 'audio'],
  documentPrefix: 'title: none | text: ',
  queryPrefix: 'task: search result | query: ',
  aliases: ['google/embeddinggemma-2'],
  downloadMb: { text: 314, image: 195, audio: 340 },
};

/**
 * The curated list the settings page offers.
 *
 * The dimension is not a preference — it is a property of the model, and
 * getting it wrong fails every batch at the provider's dimension check rather
 * than producing bad vectors. The text-only entries carry no task prompts on
 * purpose: workspaces already hold vectors made without them, and a prompt
 * added here would put new text somewhere else than the old.
 */
export const LOCAL_EMBEDDING_MODELS: readonly LocalEmbeddingModel[] = [
  textModel(
    'Xenova/all-MiniLM-L6-v2',
    384,
    'all-MiniLM-L6-v2 — fastest, general purpose',
  ),
  textModel(
    'Xenova/all-MiniLM-L12-v2',
    384,
    'all-MiniLM-L12-v2 — slower, a little sharper',
  ),
  textModel(
    'Xenova/bge-small-en-v1.5',
    384,
    'bge-small-en-v1.5 — strong English retrieval',
  ),
  textModel(
    'Xenova/bge-base-en-v1.5',
    768,
    'bge-base-en-v1.5 — best English quality, heaviest',
  ),
  textModel('Xenova/gte-small', 384, 'gte-small — balanced retrieval'),
  textModel(
    'Xenova/multilingual-e5-small',
    384,
    'multilingual-e5-small — non-English corpora',
  ),
  {
    ...textModel(
      'onnx-community/granite-embedding-small-english-r2-ONNX',
      384,
      'granite-embedding-small-english-r2 — English, long passages, very small',
    ),
    pooling: 'cls',
    aliases: ['ibm-granite/granite-embedding-small-english-r2'],
    downloadMb: { text: 52 },
  },
  {
    ...textModel(
      'onnx-community/granite-embedding-97m-multilingual-r2-ONNX',
      384,
      'granite-embedding-97m-multilingual-r2 — many languages, as fast as MiniLM',
    ),
    pooling: 'cls',
    aliases: ['ibm-granite/granite-embedding-97m-multilingual-r2'],
    downloadMb: { text: 98 },
  },
  {
    ...textModel(
      'onnx-community/embeddinggemma-300m-ONNX',
      768,
      'EmbeddingGemma 300m — many languages, text only',
    ),
    family: 'sentence-embedding',
    documentPrefix: 'title: none | text: ',
    queryPrefix: 'task: search result | query: ',
    aliases: ['google/embeddinggemma-300m'],
    downloadMb: { text: 309 },
  },
  {
    ...textModel(
      'onnx-community/harrier-oss-v1-270m-ONNX',
      640,
      'Harrier 270m — many languages, long passages',
    ),
    family: 'sentence-embedding',
    queryPrefix: `${WEB_SEARCH_INSTRUCTION}\nQuery: `,
    aliases: ['microsoft/harrier-oss-v1-270m'],
    downloadMb: { text: 344 },
  },
  {
    ...textModel(
      'onnx-community/voyage-4-nano-ONNX',
      1024,
      'Voyage 4 nano — many languages, long passages',
    ),
    family: 'sentence-embedding',
    documentPrefix: 'Represent the document for retrieval: ',
    queryPrefix: 'Represent the query for retrieving supporting documents: ',
    aliases: ['voyageai/voyage-4-nano'],
    downloadMb: { text: 422 },
  },
  {
    ...textModel(
      'onnx-community/bge-m3-ONNX',
      1024,
      'bge-m3 — many languages, heavy',
    ),
    pooling: 'cls',
    aliases: ['BAAI/bge-m3'],
    downloadMb: { text: 568 },
  },
  {
    ...textModel(
      'onnx-community/Qwen3-Embedding-0.6B-ONNX',
      1024,
      'Qwen3 Embedding 0.6B — many languages, heaviest',
    ),
    pooling: 'last_token',
    queryPrefix: `${WEB_SEARCH_INSTRUCTION}\nQuery:`,
    aliases: ['Qwen/Qwen3-Embedding-0.6B'],
    downloadMb: { text: 614 },
  },
  EMBEDDINGGEMMA_2,
  {
    ...textModel(
      'onnx-community/siglip2-base-patch16-224-ONNX',
      768,
      'SigLIP 2 base — pictures by description, short text only',
    ),
    family: 'siglip',
    mediaModalities: ['image'],
    aliases: ['google/siglip2-base-patch16-224'],
    downloadMb: { text: 283, image: 95 },
  },
  {
    ...textModel(
      'Xenova/clip-vit-base-patch32',
      512,
      'CLIP ViT-B/32 — pictures by description, English, short text only',
    ),
    family: 'clip',
    mediaModalities: ['image'],
    aliases: ['openai/clip-vit-base-patch32'],
    downloadMb: { text: 65, image: 89 },
  },
  {
    ...textModel(
      'Xenova/larger_clap_general',
      512,
      'CLAP — sounds by description, English, short text only',
    ),
    family: 'clap',
    mediaModalities: ['audio'],
    aliases: ['laion/larger_clap_general'],
    downloadMb: { text: 127, audio: 78 },
  },
];

function textModel(
  id: string,
  dimensions: number,
  label: string,
): LocalEmbeddingModel {
  return {
    id,
    label,
    dimensions,
    pooling: 'mean',
    family: 'feature-extraction',
    mediaModalities: [],
  };
}

/**
 * The repository this runtime loads for a model name, which is the name
 * itself unless it is a known alias. `google/embeddinggemma-2` has no ONNX
 * files; the same weights converted live in `onnx-community`.
 */
export function canonicalLocalModelId(model: string): string {
  // Tolerant of nothing at all: a half-built configuration (a unit test, a
  // settings row mid-migration) reaches here with no model named.
  const wanted = String(model ?? '').trim();
  const lower = wanted.toLowerCase();
  const entry = LOCAL_EMBEDDING_MODELS.find((candidate) =>
    candidate.aliases?.some((alias) => alias.toLowerCase() === lower),
  );
  return entry?.id ?? wanted;
}

/**
 * What is known about a local model.
 *
 * A model that is not on the list is treated as a plain text encoder, with
 * one exception: any other copy of EmbeddingGemma 2 (a mirror, a pinned fork)
 * is the same architecture and is loaded the same way.
 */
export function localModelProfile(model: string): LocalEmbeddingModel | null {
  const id = canonicalLocalModelId(model);
  const listed = LOCAL_EMBEDDING_MODELS.find(
    (candidate) => candidate.id.toLowerCase() === id.toLowerCase(),
  );
  if (listed) return listed;
  if (/embeddinggemma-2/i.test(id)) return { ...EMBEDDINGGEMMA_2, id };
  return null;
}
