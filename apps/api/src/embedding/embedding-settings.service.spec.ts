import { EmbeddingSettingsService } from './embedding-settings.service';
import { EmbeddingConfigService } from './embedding-config.service';

/**
 * The consequential decision this service makes is not "what is the model" —
 * it is "does this change invalidate every vector we have stored".
 *
 * Getting that wrong is expensive in both directions. A false negative leaves
 * a corpus embedded by one model being searched as if it were another, which
 * does not error: cosine distance between incompatible vectors is a number,
 * the UI ranks by it, and the results are quietly meaningless. A false
 * positive throws away a corpus that took hours to build because someone
 * nudged a batch size.
 */
describe('EmbeddingSettingsService', () => {
  const row: Record<string, unknown> = {};
  let stored: Record<string, unknown> | null;

  const prisma = {
    embeddingSettings: {
      findUnique: jest.fn(() => Promise.resolve(stored)),
      upsert: jest.fn(({ update }: { update: Record<string, unknown> }) => {
        stored = { ...(stored ?? { id: 1 }), ...update };
        return Promise.resolve(stored);
      }),
    },
  };
  const aiProviders = { getRuntimeConfig: jest.fn() };
  const cls = { get: jest.fn(() => 'ns_test') };

  function build() {
    return new EmbeddingSettingsService(
      prisma as never,
      new EmbeddingConfigService(),
      aiProviders as never,
      cls as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    stored = null;
    for (const key of Object.keys(row)) delete row[key];
  });

  it('inherits every deployment default when nothing is overridden', async () => {
    const service = build();
    const resolved = await service.resolve();
    const defaults = service.deploymentDefaults();

    expect(resolved).toEqual(defaults);
  });

  it('applies only the fields a workspace actually overrode', async () => {
    stored = { id: 1, model: 'Xenova/bge-small-en-v1.5', dimensions: 512 };

    const service = build();
    const resolved = await service.resolve();

    expect(resolved.model).toBe('Xenova/bge-small-en-v1.5');
    expect(resolved.dimensions).toBe(512);
    // Untouched fields must still track the deployment, not a frozen copy.
    expect(resolved.pooling).toBe(service.deploymentDefaults().pooling);
  });

  it('treats a model change as a rebuild', async () => {
    const service = build();
    const result = await service.update({ model: 'Xenova/bge-small-en-v1.5' });

    expect(result.requiresRebuild).toBe(true);
    expect(result.changedFields).toContain('model');
  });

  it.each(['provider', 'revision', 'dimensions', 'pooling', 'normalize'])(
    'treats a %s change as a rebuild',
    async (field) => {
      const service = build();
      const defaults = service.deploymentDefaults();
      const patch: Record<string, unknown> = {
        provider: 'openai-compatible',
        revision: 'main',
        dimensions: 768,
        pooling: 'cls',
        normalize: !defaults.normalize,
      };

      const result = await service.update({
        [field]: patch[field],
        // A remote provider needs a binding; supplied so validation passes.
        ...(field === 'provider' ? { aiProviderConfigId: 'provider-1' } : {}),
      });

      expect(result.requiresRebuild).toBe(true);
    },
  );

  it('does not rebuild for throughput knobs', async () => {
    const service = build();
    const result = await service.update({
      batchSize: 4,
      workerConcurrency: 2,
      intraOpThreads: 1,
    });

    expect(result.changedFields.length).toBeGreaterThan(0);
    expect(result.requiresRebuild).toBe(false);
  });

  // The switch moved to Settings → Cleanup › Features, which also holds the
  // queues and offers keeping or deleting the corpus. A stale client sending
  // it through the model settings must learn that, not have it half-applied.
  it('refuses the on/off switch in a settings patch', async () => {
    const service = build();

    await expect(service.update({ enabled: false })).rejects.toThrow(
      /Settings → Cleanup/,
    );
    expect(prisma.embeddingSettings.upsert).not.toHaveBeenCalled();
  });

  describe('the on/off switch', () => {
    it('turns off as a pause by default, without asking for a rebuild', async () => {
      const service = build();

      const state = await service.setEnabled(false, null);

      expect(state.enabled).toBe(false);
      expect(state.disabledMode).toBe('kept');
      expect(stored).toEqual(
        expect.objectContaining({ enabled: false, disabledMode: 'kept' }),
      );
      expect(await service.enabledNow()).toBe(false);
    });

    it('records a deleted corpus', async () => {
      const service = build();

      const state = await service.setEnabled(false, 'deleted');

      expect(state.disabledMode).toBe('deleted');
    });

    it('clears the mode when turned back on', async () => {
      stored = { id: 1, enabled: false, disabledMode: 'deleted' };
      const service = build();

      const state = await service.setEnabled(true, null);

      expect(state.enabled).toBe(true);
      expect(state.disabledMode).toBeNull();
      expect(stored).toEqual(
        expect.objectContaining({ enabled: true, disabledMode: null }),
      );
    });

    it('only moves the change time when the switch itself moves', async () => {
      const at = new Date('2026-09-01T00:00:00Z');
      stored = {
        id: 1,
        enabled: false,
        disabledMode: 'kept',
        enabledChangedAt: at,
      };
      const service = build();

      // Already off: deleting its data is not "turned off again".
      const state = await service.setEnabled(false, 'deleted');

      expect(state.changedAt).toEqual(at);
    });

    it('reads an off switch with no recorded mode as a pause', async () => {
      stored = { id: 1, enabled: false };
      const service = build();

      expect((await service.switchState()).disabledMode).toBe('kept');
    });
  });

  // Another process (the API pod that served the change) flipped the switch;
  // this one must notice without a restart.
  it('re-reads the switch after a few seconds', async () => {
    const service = build();
    expect(await service.enabledNow()).toBe(
      service.deploymentDefaults().enabled,
    );

    stored = { id: 1, enabled: false };
    jest.useFakeTimers({ now: Date.now() + 6_000 });
    try {
      expect(await service.enabledNow()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears an override back to the deployment default when sent null', async () => {
    stored = { id: 1, model: 'Xenova/bge-small-en-v1.5' };
    const service = build();

    const result = await service.update({ model: null });

    expect(result.requiresRebuild).toBe(true);
    expect((await service.resolve()).model).toBe(
      service.deploymentDefaults().model,
    );
  });

  // Reported from a live instance: saving nemotron-3-embed-1b (2,048 dims)
  // answered 400 "dimensions must be between 1 and 2000". The old cap was
  // pgvector's HNSW *index* limit applied as a validation rule, which rejects
  // models pgvector stores and searches perfectly well.
  it.each([2048, 3072, 4096, 8192])(
    'accepts %i dimensions, which pgvector can store',
    async (dimensions) => {
      const service = build();
      await expect(service.update({ dimensions })).resolves.toEqual(
        expect.objectContaining({ requiresRebuild: true }),
      );
    },
  );

  it('still rejects a dimension pgvector cannot store at all', async () => {
    const service = build();
    await expect(service.update({ dimensions: 16001 })).rejects.toThrow(
      'dimensions must be between 1 and 16000',
    );
  });

  it('rejects a remote provider with no AI provider to authenticate it', async () => {
    const service = build();
    await expect(
      service.update({
        provider: 'openai-compatible',
        aiProviderConfigId: null,
      }),
    ).rejects.toThrow('needs an AI provider');
  });

  it('rejects switching to a remote provider when the binding is only implicitly absent', async () => {
    // The page saves the provider and the binding separately, and a workspace
    // whose bound credential was removed has neither field in the patch.
    stored = { id: 1 };
    const service = build();

    await expect(
      service.update({ provider: 'openai-compatible' }),
    ).rejects.toThrow('needs an AI provider');
  });

  it('drops a local model override when the workspace switches to a remote provider', async () => {
    // The remote section of the settings page has no model input — it says the
    // provider owns that — so an override left behind here is unreachable and
    // would be sent to the remote endpoint as a model it has never heard of.
    stored = { id: 1, model: 'Xenova/bge-small-en-v1.5', dimensions: 512 };
    aiProviders.getRuntimeConfig.mockResolvedValue({
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: 'secret',
      model: 'nvidia/nemotron-3-embed-1b',
      embeddingDimensions: 2048,
      embeddingPooling: 'mean',
    });
    const service = build();

    await service.update({
      provider: 'openai-compatible',
      aiProviderConfigId: 'provider-1',
    });
    const resolved = await service.resolve();

    expect(resolved.model).toBe('nvidia/nemotron-3-embed-1b');
    expect(resolved.dimensions).toBe(2048);
  });

  it('never reports the API key as a changed field', async () => {
    aiProviders.getRuntimeConfig.mockResolvedValue({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
    });
    const service = build();

    const result = await service.update({
      provider: 'openai-compatible',
      aiProviderConfigId: 'provider-1',
    });

    expect(result.changedFields).not.toContain('apiKey');
  });

  it('serves the deployment defaults synchronously before anything is resolved', () => {
    const service = build();
    expect(service.cached()).toEqual(service.deploymentDefaults());
  });
});
