import { EmbeddingConfigService } from './embedding-config.service';
import {
  resolvedFromEnv,
  withModelCapabilities,
  type ResolvedEmbeddingConfig,
} from './embedding-settings.service';
import {
  canonicalLocalModelId,
  localModelProfile,
  LOCAL_EMBEDDING_MODELS,
} from './embedding-local-models';
import {
  mediaContentHash,
  normalizeMediaModalities,
} from './embedding-modality';

/**
 * What a workspace embeds besides text is two questions with one answer: what
 * it asked for, and what the model in use can do. Everything that collects,
 * stores, embeds or searches media reads the answer (`mediaModalities`), so
 * these pin how it is worked out for the built-in provider and for a remote
 * one.
 */
describe('embedding modalities', () => {
  const base = (
    patch: Partial<ResolvedEmbeddingConfig> = {},
  ): ResolvedEmbeddingConfig => ({
    ...resolvedFromEnv(new EmbeddingConfigService()),
    ...patch,
  });

  describe('built-in provider', () => {
    it('embeds text only on the model every install starts with', () => {
      const cfg = withModelCapabilities(base());

      expect(cfg.model).toBe('Xenova/all-MiniLM-L6-v2');
      expect(cfg.supportedMedia).toEqual([]);
      expect(cfg.mediaModalities).toEqual([]);
      expect(cfg.localFamily).toBe('feature-extraction');
      // No prompts: vectors already stored were made without any.
      expect(cfg.documentPrefix).toBeUndefined();
      expect(cfg.queryPrefix).toBeUndefined();
    });

    it('embeds pictures on EmbeddingGemma 2 without being asked twice', () => {
      const cfg = withModelCapabilities(
        base({ model: 'onnx-community/embeddinggemma-2-ONNX' }),
      );

      expect(cfg.supportedMedia).toEqual(['image', 'audio']);
      // Pictures are on by default, sound is not.
      expect(cfg.mediaModalities).toEqual(['image']);
      expect(cfg.localFamily).toBe('embeddinggemma-2');
    });

    it('gives a local model the task prompts it was trained with', () => {
      const cfg = withModelCapabilities(
        base({ model: 'onnx-community/embeddinggemma-2-ONNX' }),
      );

      expect(cfg.documentPrefix).toBe('title: none | text: ');
      expect(cfg.queryPrefix).toBe('task: search result | query: ');
    });

    it('follows what the workspace turned on and off', () => {
      const model = 'onnx-community/embeddinggemma-2-ONNX';

      expect(
        withModelCapabilities(base({ model, embedImages: false }))
          .mediaModalities,
      ).toEqual([]);
      expect(
        withModelCapabilities(base({ model, embedAudio: true }))
          .mediaModalities,
      ).toEqual(['image', 'audio']);
    });

    it('cannot be asked for pictures a text model does not embed', () => {
      const cfg = withModelCapabilities(
        base({ embedImages: true, embedAudio: true }),
      );

      expect(cfg.mediaModalities).toEqual([]);
    });
  });

  describe('remote provider', () => {
    const remote = (patch: Partial<ResolvedEmbeddingConfig> = {}) =>
      base({ provider: 'openai-compatible', model: 'some-model', ...patch });

    it('embeds what the provider says its model takes', () => {
      const cfg = withModelCapabilities(remote(), {
        embeddingModalities: ['image', 'audio'],
        embeddingMediaFormat: 'gemini',
      });

      expect(cfg.supportedMedia).toEqual(['image', 'audio']);
      expect(cfg.mediaModalities).toEqual(['image']);
      expect(cfg.mediaFormat).toBe('gemini');
    });

    // Text has one request shape; media has one per server. A provider that
    // names none cannot be sent a picture, whatever else it claims.
    it('embeds text only without a media request format', () => {
      const cfg = withModelCapabilities(remote(), {
        embeddingModalities: ['image'],
        embeddingMediaFormat: null,
      });

      expect(cfg.supportedMedia).toEqual([]);
      expect(cfg.mediaFormat).toBeUndefined();
    });

    it('ignores a format it does not speak', () => {
      const cfg = withModelCapabilities(remote(), {
        embeddingModalities: ['image'],
        embeddingMediaFormat: 'smoke-signals',
      });

      expect(cfg.mediaModalities).toEqual([]);
    });

    it('is text-only when configured by environment, with no provider row', () => {
      expect(withModelCapabilities(remote()).mediaModalities).toEqual([]);
    });

    it('keeps the prompts the provider stated', () => {
      const cfg = withModelCapabilities(
        remote({ documentPrefix: 'passage: ', queryPrefix: 'query: ' }),
        { embeddingModalities: [], embeddingMediaFormat: null },
      );

      expect(cfg.documentPrefix).toBe('passage: ');
      expect(cfg.queryPrefix).toBe('query: ');
    });
  });

  describe('local model catalogue', () => {
    it('still lists the model the image is built with', () => {
      expect(LOCAL_EMBEDDING_MODELS.map((model) => model.id)).toContain(
        new EmbeddingConfigService().model,
      );
    });

    // The author's repository holds PyTorch weights; only the ONNX conversion
    // runs here. Typing the name people know selects the one that loads.
    it("accepts google's own repository as a name for EmbeddingGemma 2", () => {
      expect(canonicalLocalModelId('google/embeddinggemma-2')).toBe(
        'onnx-community/embeddinggemma-2-ONNX',
      );
      expect(canonicalLocalModelId(' Google/EmbeddingGemma-2 ')).toBe(
        'onnx-community/embeddinggemma-2-ONNX',
      );
    });

    it('leaves every other name alone', () => {
      expect(canonicalLocalModelId('Xenova/gte-small')).toBe(
        'Xenova/gte-small',
      );
      expect(canonicalLocalModelId('acme/custom-model')).toBe(
        'acme/custom-model',
      );
    });

    it('loads a mirror of EmbeddingGemma 2 the same way', () => {
      const profile = localModelProfile('acme/embeddinggemma-2-onnx-mirror');

      expect(profile?.family).toBe('embeddinggemma-2');
      expect(profile?.id).toBe('acme/embeddinggemma-2-onnx-mirror');
    });

    it('knows nothing about a model that is not listed', () => {
      expect(localModelProfile('acme/custom-model')).toBeNull();
    });

    // Pooling is part of how a model was trained. A first-token model read by
    // averaging answers with a vector of the right width from the wrong place.
    it('reads each model the way it was trained to be read', () => {
      const pooling = (id: string) => localModelProfile(id)?.pooling;

      expect(pooling('onnx-community/bge-m3-ONNX')).toBe('cls');
      expect(
        pooling('onnx-community/granite-embedding-97m-multilingual-r2-ONNX'),
      ).toBe('cls');
      expect(pooling('onnx-community/Qwen3-Embedding-0.6B-ONNX')).toBe(
        'last_token',
      );
    });

    it('loads a model that pools for itself through its own output', () => {
      for (const id of [
        'onnx-community/embeddinggemma-300m-ONNX',
        'onnx-community/harrier-oss-v1-270m-ONNX',
        'onnx-community/voyage-4-nano-ONNX',
      ]) {
        expect(localModelProfile(id)?.family).toBe('sentence-embedding');
      }
    });

    it('asks an instruction-tuned model the way its card writes it', () => {
      const qwen = localModelProfile('Qwen/Qwen3-Embedding-0.6B');

      expect(qwen?.id).toBe('onnx-community/Qwen3-Embedding-0.6B-ONNX');
      expect(qwen?.queryPrefix).toBe(
        'Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:',
      );
      expect(qwen?.documentPrefix).toBeUndefined();
    });

    it('says what a two-encoder model takes besides text', () => {
      const media = (id: string) => localModelProfile(id)?.mediaModalities;

      expect(media('openai/clip-vit-base-patch32')).toEqual(['image']);
      expect(media('google/siglip2-base-patch16-224')).toEqual(['image']);
      expect(media('laion/larger_clap_general')).toEqual(['audio']);
    });

    it('lists no model twice and no alias that is also a model', () => {
      const ids = LOCAL_EMBEDDING_MODELS.map((model) => model.id.toLowerCase());
      const aliases = LOCAL_EMBEDDING_MODELS.flatMap((model) =>
        (model.aliases ?? []).map((alias) => alias.toLowerCase()),
      );

      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(aliases).size).toBe(aliases.length);
      expect(aliases.filter((alias) => ids.includes(alias))).toEqual([]);
    });
  });

  it('keeps only media kinds it knows, in a fixed order', () => {
    expect(
      normalizeMediaModalities(['audio', 'image', 'smell', 'image']),
    ).toEqual(['image', 'audio']);
    expect(normalizeMediaModalities('image')).toEqual([]);
    expect(normalizeMediaModalities(null)).toEqual([]);
  });

  it('identifies media by its bytes', () => {
    const picture = Buffer.from([1, 2, 3]);

    expect(mediaContentHash(picture)).toBe(
      mediaContentHash(Buffer.from([1, 2, 3])),
    );
    expect(mediaContentHash(picture)).not.toBe(
      mediaContentHash(Buffer.from([1, 2, 4])),
    );
    expect(mediaContentHash(picture)).toHaveLength(64);
  });
});
