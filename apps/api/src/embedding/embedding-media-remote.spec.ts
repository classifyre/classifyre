import {
  buildMediaRequest,
  embedMediaRemote,
  parseMediaResponse,
} from './embedding-media-remote';
import { probeAudio, probeImage } from './embedding-media-probe';
import { decodeWavMono16k } from './transformers-embedding.worker';

/**
 * Text embedding has one request shape. Media has one per server, and getting
 * it wrong does not fail politely: a server that does not recognise the shape
 * embeds the JSON as text, or answers 400 on the first scanned picture. These
 * pin each shape against what its server documents.
 */
describe('remote media embedding', () => {
  const picture = {
    modality: 'image' as const,
    mimeType: 'image/jpeg',
    data: Buffer.from('jpeg-bytes'),
  };
  const clip = {
    modality: 'audio' as const,
    mimeType: 'audio/wav',
    data: Buffer.from('wav-bytes'),
  };

  describe('llama.cpp', () => {
    const target = {
      baseUrl: 'http://llama.svc:8080/v1',
      model: 'embeddinggemma-2',
      dimensions: 768,
    };

    it('sends a picture as an image_url part of one input', () => {
      const request = buildMediaRequest('llama-cpp', target, [picture]);

      expect(request.url).toBe('http://llama.svc:8080/v1/embeddings');
      expect(request.body).toEqual({
        model: 'embeddinggemma-2',
        input: [
          {
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${picture.data.toString('base64')}`,
                },
              },
            ],
          },
        ],
      });
    });

    it('sends a clip as an input_audio part', () => {
      const request = buildMediaRequest('llama-cpp', target, [clip]);

      expect(request.body).toMatchObject({
        input: [
          {
            content: [
              {
                type: 'input_audio',
                input_audio: { data: clip.data.toString('base64') },
              },
            ],
          },
        ],
      });
    });

    it('sends no Authorization header to a server that takes no key', () => {
      const request = buildMediaRequest('llama-cpp', target, [picture]);

      expect(request.headers).not.toHaveProperty('authorization');
      expect(
        buildMediaRequest('llama-cpp', { ...target, apiKey: 'k' }, [picture])
          .headers.authorization,
      ).toBe('Bearer k');
    });

    it('reads vectors back in the order they were asked for', () => {
      const vectors = parseMediaResponse(
        'llama-cpp',
        {
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        },
        2,
      );

      expect(vectors).toEqual([
        [1, 0],
        [0, 1],
      ]);
    });
  });

  describe('Gemini', () => {
    const target = {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: 'key',
      model: 'gemini-embedding-2',
      dimensions: 768,
    };

    // The provider's base URL is the OpenAI-compatible layer, which takes text
    // only. Media goes to the native method one level up.
    it('calls the native batch method, not the OpenAI-compatible one', () => {
      const request = buildMediaRequest('gemini', target, [picture]);

      expect(request.url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents',
      );
      expect(request.headers['x-goog-api-key']).toBe('key');
      expect(request.headers).not.toHaveProperty('authorization');
    });

    // Several parts in one content come back as ONE averaged vector.
    it('asks for one vector per item, at the workspace width', () => {
      const request = buildMediaRequest('gemini', target, [picture, clip]);

      expect(request.body).toEqual({
        requests: [
          {
            model: 'models/gemini-embedding-2',
            content: {
              parts: [
                {
                  inline_data: {
                    mime_type: 'image/jpeg',
                    data: picture.data.toString('base64'),
                  },
                },
              ],
            },
            output_dimensionality: 768,
          },
          {
            model: 'models/gemini-embedding-2',
            content: {
              parts: [
                {
                  inline_data: {
                    mime_type: 'audio/wav',
                    data: clip.data.toString('base64'),
                  },
                },
              ],
            },
            output_dimensionality: 768,
          },
        ],
      });
    });

    it('accepts a model written with its models/ prefix', () => {
      const request = buildMediaRequest(
        'gemini',
        { ...target, model: 'models/gemini-embedding-2' },
        [picture],
      );

      expect(request.url).toContain('/models/gemini-embedding-2:batch');
      expect(request.url).not.toContain('models/models/');
    });

    it('reads the values of each embedding', () => {
      expect(
        parseMediaResponse(
          'gemini',
          { embeddings: [{ values: [1, 0] }, { values: [0, 1] }] },
          2,
        ),
      ).toEqual([
        [1, 0],
        [0, 1],
      ]);
    });
  });

  it('refuses an answer with fewer vectors than items', () => {
    expect(() =>
      parseMediaResponse('gemini', { embeddings: [{ values: [1] }] }, 2),
    ).toThrow(/1 vector\(s\) for 2 media item/);
    expect(() => parseMediaResponse('llama-cpp', {}, 1)).toThrow(/0 vector/);
  });

  it('keeps input order across requests that finish out of order', async () => {
    const items = [1, 2, 3].map((n) => ({
      modality: 'image' as const,
      mimeType: 'image/jpeg',
      data: Buffer.from([n]),
    }));
    // llama.cpp takes one item a request; the later request answers first.
    const fetchImpl = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as {
        input: Array<{ content: Array<{ image_url: { url: string } }> }>;
      };
      const byte = Buffer.from(
        body.input[0].content[0].image_url.url.split(',')[1],
        'base64',
      )[0];
      await new Promise((resolve) => setTimeout(resolve, (4 - byte) * 5));
      return new Response(
        JSON.stringify({ data: [{ index: 0, embedding: [byte] }] }),
      );
    });

    const vectors = await embedMediaRemote(
      'llama-cpp',
      { baseUrl: 'http://llama.svc/v1', model: 'm' },
      items,
      { parallel: 3, fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(vectors).toEqual([[1], [2], [3]]);
  });

  it('says which endpoint and model refused, and why', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(
        new Response('{"error":"image input is not supported"}', {
          status: 400,
          statusText: 'Bad Request',
        }),
      ),
    );

    await expect(
      embedMediaRemote(
        'llama-cpp',
        { baseUrl: 'http://llama.svc/v1', model: 'text-only' },
        [picture],
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).rejects.toThrow(
      /400 Bad Request from POST http:\/\/llama\.svc\/v1\/embeddings \(model "text-only", image\).*not supported/,
    );
  });

  describe('OpenRouter', () => {
    const target = {
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-test',
      model: 'google/gemini-embedding-2',
      dimensions: 3072,
    };

    it('sends a picture as llama.cpp does, with the key as a bearer token', () => {
      const request = buildMediaRequest('openrouter', target, [picture]);

      expect(request.url).toBe('https://openrouter.ai/api/v1/embeddings');
      expect(request.headers.authorization).toBe('Bearer sk-or-test');
      expect(request.body).toEqual(
        buildMediaRequest('llama-cpp', target, [picture]).body,
      );
    });

    // Bare base64 is answered with 400 "expected a base64 data URL".
    it('sends a clip as a data URL', () => {
      const request = buildMediaRequest('openrouter', target, [clip]);

      expect(request.body).toMatchObject({
        model: 'google/gemini-embedding-2',
        input: [
          {
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: `data:audio/wav;base64,${clip.data.toString('base64')}`,
                  format: 'wav',
                },
              },
            ],
          },
        ],
      });
    });

    it('reads the answer as any OpenAI-shaped embeddings response', () => {
      const vectors = parseMediaResponse(
        'openrouter',
        {
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        },
        2,
      );

      expect(vectors).toEqual([
        [1, 0],
        [0, 1],
      ]);
    });
  });

  describe('test media', () => {
    it('is a real PNG', () => {
      const { data, mimeType } = probeImage();

      expect(mimeType).toBe('image/png');
      expect([...data.subarray(0, 8)]).toEqual([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      expect(data.subarray(12, 16).toString('ascii')).toBe('IHDR');
      expect(data.readUInt32BE(16)).toBe(64);
    });

    it('is a real second of 16 kHz audio', () => {
      const samples = decodeWavMono16k(probeAudio().data);

      expect(samples).toHaveLength(16_000);
      expect(Math.max(...samples)).toBeGreaterThan(0.3);
    });
  });
});
