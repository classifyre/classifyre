import { createHash } from 'node:crypto';

/**
 * What a model can turn into a vector.
 *
 * Text is always one of them: every search is typed, so a model that cannot
 * embed text cannot be searched at all. The others are optional, and only a
 * model that puts them in the SAME coordinate system as its text is of use —
 * a picture embedded by one model cannot be found by a question embedded by
 * another.
 */
export const EMBEDDING_MODALITIES = ['text', 'image', 'audio'] as const;
export type EmbeddingModality = (typeof EMBEDDING_MODALITIES)[number];

/** Everything that is not text: content stored as bytes rather than as words. */
export const MEDIA_MODALITIES = ['image', 'audio'] as const;
export type MediaModality = (typeof MEDIA_MODALITIES)[number];

export function isMediaModality(value: unknown): value is MediaModality {
  return (MEDIA_MODALITIES as readonly unknown[]).includes(value);
}

/**
 * Keeps the media modalities out of anything, in canonical order and without
 * repeats. Used wherever a list arrives from outside (a provider row, a
 * request body): an unknown word is dropped rather than stored, because a
 * modality nothing can produce would only ever be a promise the scan cannot
 * keep.
 */
export function normalizeMediaModalities(value: unknown): MediaModality[] {
  const given = Array.isArray(value) ? value.map(String) : [];
  return MEDIA_MODALITIES.filter((modality) => given.includes(modality));
}

/**
 * How an endpoint wants a picture or a sound handed to it.
 *
 * Text embedding has one request shape everybody copied from OpenAI. Media
 * has none: each server invented its own, so the shape has to be named. These
 * are the ones this product speaks.
 *
 *  - `llama-cpp` — llama.cpp's server with a multimodal projector loaded:
 *    each `input` element of `/v1/embeddings` is `{ content: [part] }` with an
 *    `image_url` or `input_audio` part.
 *  - `gemini` — Google's Gemini API, `models/<model>:batchEmbedContents` with
 *    `inline_data` parts.
 *  - `openrouter` — OpenRouter's `/embeddings`: the same `{ content: [part] }`
 *    inputs as llama.cpp, except that a clip travels as a `data:` URL where
 *    llama.cpp wants bare base64.
 */
export const EMBEDDING_MEDIA_FORMATS = [
  'llama-cpp',
  'gemini',
  'openrouter',
] as const;
export type EmbeddingMediaFormat = (typeof EMBEDDING_MEDIA_FORMATS)[number];

export function isEmbeddingMediaFormat(
  value: unknown,
): value is EmbeddingMediaFormat {
  return (EMBEDDING_MEDIA_FORMATS as readonly unknown[]).includes(value);
}

/** What each wire format can carry, so a provider cannot promise more. */
export const MEDIA_FORMAT_MODALITIES: Record<
  EmbeddingMediaFormat,
  readonly MediaModality[]
> = {
  'llama-cpp': ['image', 'audio'],
  gemini: ['image', 'audio'],
  openrouter: ['image', 'audio'],
};

/** One picture or clip on its way to a model. */
export interface EmbeddingMediaItem {
  modality: MediaModality;
  mimeType: string;
  data: Buffer;
}

/**
 * How scans prepare media before sending it, per modality.
 *
 * Decided here and handed to the scan, rather than hard-coded in the CLI,
 * because the stored copy is what a rebuild re-embeds from: it has to be
 * something every supported model can read, and small enough to keep. A
 * picture is re-encoded as JPEG with its longest edge capped (vision encoders
 * work at a few hundred pixels a side, so more is only storage); audio is
 * decoded to mono 16 kHz WAV, which is what speech and sound encoders are
 * trained on, and cut into clips.
 *
 * Clips of ten seconds, twelve of them: the first two minutes, as before
 * with four of thirty. Ten seconds is all CLAP hears at once (it cut a longer
 * clip to a random ten seconds of it), and short enough that a sound under
 * somebody's voice gets a clip, and a vector, nearly to itself: in a clip that
 * is mostly speech the vector says speech, and a smoke alarm on a voicemail
 * was not found by its sound until the clips were this short.
 */
export const MEDIA_COLLECTION = {
  image: { mimeType: 'image/jpeg', maxEdge: 768, quality: 85, maxItems: 1 },
  audio: {
    mimeType: 'audio/wav',
    sampleRate: 16_000,
    clipSeconds: 10,
    maxItems: 12,
  },
} as const;

/**
 * Key under which a scan records, in an asset's scan-cache state, that its
 * media of this kind was sent. Named here and handed to the scan with the
 * collection plan, because the API is what has to take the record back when
 * the media is deleted — otherwise turning pictures off and on again would
 * find every picture marked as already sent, and send none.
 */
export function mediaScanCacheKey(modality: MediaModality): string {
  return `EMBED_MEDIA::${modality}`;
}

/** Largest stored media item. A clip of 10 s at 16 kHz is about 320 KB. */
export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;

/**
 * Identity of a media item: the hash of its bytes.
 *
 * The same role `embeddingContentHash` plays for text, and the same width, so
 * a vector is keyed the same way whatever it was taken over. Identical bytes
 * in two places are embedded once.
 */
export function mediaContentHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Changes whenever the way ONE kind of media is prepared changes, so the scan
 * cache can tell an asset whose media was collected under these rules from one
 * that still needs collecting.
 *
 * Per kind on purpose. A fingerprint of everything collected would change for
 * every picture the day sound is turned on, and each of them would be read and
 * sent again for a change that has nothing to do with pictures.
 */
export function mediaCollectionFingerprint(modality: MediaModality): string {
  return createHash('sha256')
    .update(JSON.stringify([modality, MEDIA_COLLECTION[modality]]))
    .digest('hex')
    .slice(0, 16);
}
