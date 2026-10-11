import type {
  EmbeddingMediaFormat,
  EmbeddingMediaItem,
} from './embedding-modality';

/** Where a media request goes, and for which model. */
export interface RemoteMediaTarget {
  /** Normalised base URL of the provider (no trailing `/embeddings`). */
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Width asked of an endpoint that can cut its vectors; omitted otherwise. */
  dimensions?: number;
}

export interface RemoteMediaRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Items one request may carry.
 *
 * llama.cpp runs every input through the same slots whatever the batch, and a
 * picture takes it seconds on a CPU: one per request keeps each call inside
 * the timeout and makes a failure cost one picture rather than a batch.
 * Gemini answers a batch in one round trip, and its limits are per item.
 * OpenRouter passes a batch on to whichever provider serves the model.
 */
export const REMOTE_MEDIA_BATCH: Record<EmbeddingMediaFormat, number> = {
  'llama-cpp': 1,
  gemini: 4,
  openrouter: 4,
};

/**
 * Google's own API root for a provider whose base URL is the OpenAI
 * compatibility layer (`…/v1beta/openai`). That layer takes text only; media
 * goes to the native `embedContent` methods one level up.
 */
function geminiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/openai$/i, '');
}

export function buildMediaRequest(
  format: EmbeddingMediaFormat,
  target: RemoteMediaTarget,
  items: readonly EmbeddingMediaItem[],
): RemoteMediaRequest {
  const base64 = (item: EmbeddingMediaItem) => item.data.toString('base64');

  if (format === 'gemini') {
    const model = target.model.replace(/^models\//, '');
    return {
      url: `${geminiRoot(target.baseUrl)}/models/${model}:batchEmbedContents`,
      headers: {
        'content-type': 'application/json',
        ...(target.apiKey ? { 'x-goog-api-key': target.apiKey } : {}),
      },
      body: {
        // One request per item: several parts in ONE content would be
        // averaged into a single vector, and each item needs its own.
        requests: items.map((item) => ({
          model: `models/${model}`,
          content: {
            parts: [
              { inline_data: { mime_type: item.mimeType, data: base64(item) } },
            ],
          },
          ...(target.dimensions
            ? { output_dimensionality: target.dimensions }
            : {}),
        })),
      },
    };
  }

  return {
    url: `${target.baseUrl}/embeddings`,
    headers: {
      'content-type': 'application/json',
      ...(target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {}),
    },
    body: {
      model: target.model,
      input: items.map((item) => ({
        content: [
          item.modality === 'audio'
            ? {
                type: 'input_audio',
                input_audio: {
                  // llama.cpp takes the bytes bare; OpenRouter refuses
                  // anything that is not a data URL.
                  data:
                    format === 'openrouter'
                      ? `data:${item.mimeType};base64,${base64(item)}`
                      : base64(item),
                  format: 'wav',
                },
              }
            : {
                type: 'image_url',
                image_url: {
                  url: `data:${item.mimeType};base64,${base64(item)}`,
                },
              },
        ],
      })),
    },
  };
}

function isVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'number')
  );
}

/** The vectors out of a response, in the order the items were sent. */
export function parseMediaResponse(
  format: EmbeddingMediaFormat,
  payload: unknown,
  expected: number,
): number[][] {
  const body = (payload ?? {}) as Record<string, unknown>;
  let vectors: unknown[];
  if (format === 'gemini') {
    const embeddings = Array.isArray(body.embeddings) ? body.embeddings : [];
    vectors = embeddings.map(
      (entry) => (entry as { values?: unknown } | null)?.values,
    );
  } else {
    const data = Array.isArray(body.data) ? [...body.data] : [];
    // The index is what ties an answer to its input; a server is free to
    // answer out of order.
    data.sort(
      (left, right) =>
        Number((left as { index?: number })?.index ?? 0) -
        Number((right as { index?: number })?.index ?? 0),
    );
    vectors = data.map(
      (entry) => (entry as { embedding?: unknown } | null)?.embedding,
    );
  }
  if (vectors.length !== expected || !vectors.every(isVector)) {
    throw new Error(
      `The provider returned ${vectors.filter(isVector).length} vector(s) for ${expected} media item(s)`,
    );
  }
  return vectors;
}

/** How long one media request may take: a CPU endpoint needs minutes. */
const REMOTE_MEDIA_TIMEOUT_MS = 10 * 60_000;

/**
 * Embeds media through a remote endpoint, in the order given.
 *
 * `parallel` bounds how many requests are in flight, the same knob the text
 * path uses (maxParallelCalls): a hosted API tolerates a few at once, a single
 * CPU pod gains nothing from more than its slots.
 */
export async function embedMediaRemote(
  format: EmbeddingMediaFormat,
  target: RemoteMediaTarget,
  items: readonly EmbeddingMediaItem[],
  options: { parallel?: number; fetchImpl?: typeof fetch } = {},
): Promise<number[][]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const size = REMOTE_MEDIA_BATCH[format];
  const batches: EmbeddingMediaItem[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    batches.push(items.slice(offset, offset + size));
  }

  const results: number[][][] = new Array<number[][]>(batches.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= batches.length) return;
      const batch = batches[index];
      const request = buildMediaRequest(format, target, batch);
      const response = await fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(REMOTE_MEDIA_TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        // The URL carries no secret (the key travels in a header), and naming
        // it is what tells a wrong base URL from a wrong model.
        throw new Error(
          `${response.status} ${response.statusText} from POST ${request.url} ` +
            `(model "${target.model}", ${batch[0].modality})` +
            (detail ? `: ${detail}` : ''),
        );
      }
      results[index] = parseMediaResponse(
        format,
        await response.json(),
        batch.length,
      );
    }
  };
  const lanes = Math.max(1, Math.min(options.parallel ?? 1, batches.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  return results.flat();
}
