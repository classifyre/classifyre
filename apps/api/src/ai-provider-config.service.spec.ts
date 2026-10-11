import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  AiProviderConfigService,
  normalizeProviderBaseUrl,
  providerEndpointKey,
} from './ai-provider-config.service';

function createService() {
  const prisma = {
    aiProviderConfig: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    customDetector: {
      count: jest.fn(),
    },
    embeddingSettings: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const crypto = {
    encryptString: jest.fn((s: string) => `enc:${s}`),
    decryptString: jest.fn((s: string) => s.replace(/^enc:/, '')),
  };
  const service = new AiProviderConfigService(prisma as any, crypto as any);
  return { service, prisma, crypto };
}

describe('AiProviderConfigService.remove', () => {
  it('throws ConflictException when detectors still reference the provider', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue({
      id: 'ai-1',
      name: 'Prod',
    });
    prisma.customDetector.count.mockResolvedValue(2);

    await expect(service.remove('ai-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.aiProviderConfig.delete).not.toHaveBeenCalled();
  });

  it('deletes when no detectors reference the provider', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue({
      id: 'ai-1',
      name: 'Prod',
    });
    prisma.customDetector.count.mockResolvedValue(0);

    await service.remove('ai-1');
    expect(prisma.aiProviderConfig.delete).toHaveBeenCalledWith({
      where: { id: 'ai-1' },
    });
  });

  it('refuses to delete the credential the workspace embeds with', async () => {
    // The FK is onDelete: SetNull, so deleting it used to succeed and leave the
    // workspace on a remote provider with no endpoint behind it.
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue({
      id: 'ai-1',
      name: 'Prod',
    });
    prisma.customDetector.count.mockResolvedValue(0);
    prisma.embeddingSettings.findFirst.mockResolvedValue({ id: 1 });

    await expect(service.remove('ai-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.aiProviderConfig.delete).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for an unknown id', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue(null);

    await expect(service.remove('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AiProviderConfigService supportsVision', () => {
  const baseRow = {
    id: 'ai-1',
    name: 'Vision Claude',
    provider: 'CLAUDE',
    model: 'claude-sonnet-4-5',
    apiKeyEnc: 'enc:sk-test',
    baseUrl: null,
    contextSize: null,
    supportsVision: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('persists supportsVision on create and returns it', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.create.mockResolvedValue(baseRow);

    const result = await service.create({
      name: 'Vision Claude',
      provider: 'CLAUDE',
      supportsVision: true,
    } as any);

    expect(prisma.aiProviderConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ supportsVision: true }),
      }),
    );
    expect(result.supportsVision).toBe(true);
  });

  it('defaults supportsVision to false on create when omitted', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.create.mockResolvedValue({
      ...baseRow,
      supportsVision: false,
    });

    await service.create({ name: 'Text Claude', provider: 'CLAUDE' } as any);

    expect(prisma.aiProviderConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ supportsVision: false }),
      }),
    );
  });

  it('updates supportsVision when provided', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue(baseRow);
    prisma.aiProviderConfig.update.mockResolvedValue({
      ...baseRow,
      supportsVision: false,
    });

    await service.update('ai-1', { supportsVision: false });

    expect(prisma.aiProviderConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ supportsVision: false }),
      }),
    );
  });

  it('includes supportsVision in the resolved runtime config', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue(baseRow);

    const runtime = await service.getRuntimeConfig('ai-1');

    expect(runtime.supportsVision).toBe(true);
  });
});

describe('AiProviderConfigService endpoint-bound key', () => {
  const stored: {
    id: string;
    name: string;
    provider: string;
    model: string;
    apiKeyEnc: string | null;
    baseUrl: string | null;
    contextSize: null;
    supportsVision: boolean;
    supportsEmbedding: boolean;
    embeddingDimensions: null;
    embeddingPooling: null;
    inputCostPerMTok: null;
    outputCostPerMTok: null;
    cachedInputCostPerMTok: null;
    createdAt: Date;
    updatedAt: Date;
  } = {
    id: 'ai-1',
    name: 'Gateway',
    provider: 'OPENAI_COMPATIBLE',
    model: 'gpt-4o',
    apiKeyEnc: 'enc:old-key',
    baseUrl: 'https://gateway.example.test',
    contextSize: null,
    supportsVision: false,
    supportsEmbedding: false,
    embeddingDimensions: null,
    embeddingPooling: null,
    inputCostPerMTok: null,
    outputCostPerMTok: null,
    cachedInputCostPerMTok: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function mockUpdate(existing: typeof stored) {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue(existing);
    prisma.aiProviderConfig.update.mockImplementation(({ data }: any) => ({
      ...existing,
      ...data,
    }));
    return { service, prisma };
  }

  it('normalises the endpoint the way the key binding compares it', () => {
    expect(normalizeProviderBaseUrl(null)).toBe('');
    expect(normalizeProviderBaseUrl(undefined)).toBe('');
    expect(normalizeProviderBaseUrl('')).toBe('');
    expect(normalizeProviderBaseUrl('   ')).toBe('');
    expect(
      providerEndpointKey(
        'OPENAI_COMPATIBLE',
        'https://Gateway.example.test/v1/',
      ),
    ).toBe('OPENAI_COMPATIBLE|https://gateway.example.test/v1');
    expect(providerEndpointKey('CLAUDE', null)).toBe(
      providerEndpointKey('CLAUDE', ''),
    );
  });

  it('drops the stored key when the base URL changes without a new key', async () => {
    const { service, prisma } = mockUpdate(stored);

    await service.update('ai-1', {
      baseUrl: 'https://collector.example.test',
    });

    const data = prisma.aiProviderConfig.update.mock.calls[0][0].data;
    expect(data.apiKeyEnc).toBeNull();
  });

  it('drops the stored key when the provider changes without a new key', async () => {
    const { service, prisma } = mockUpdate({
      ...stored,
      provider: 'CLAUDE',
      baseUrl: null,
    });

    await service.update('ai-1', { provider: 'GEMINI' });

    const data = prisma.aiProviderConfig.update.mock.calls[0][0].data;
    expect(data.apiKeyEnc).toBeNull();
  });

  it('keeps the stored key across a model-only change', async () => {
    const { service, prisma } = mockUpdate(stored);

    await service.update('ai-1', { model: 'gpt-4o-mini' });

    const data = prisma.aiProviderConfig.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('apiKeyEnc');
  });

  it('keeps the stored key across a trailing-slash-only change', async () => {
    const { service, prisma } = mockUpdate(stored);

    await service.update('ai-1', {
      baseUrl: 'https://gateway.example.test/',
    });

    const data = prisma.aiProviderConfig.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('apiKeyEnc');
  });

  it('stores a new key together with a new URL', async () => {
    const { service, prisma } = mockUpdate(stored);

    await service.update('ai-1', {
      baseUrl: 'https://collector.example.test',
      apiKey: 'the-new-key',
    });

    const data = prisma.aiProviderConfig.update.mock.calls[0][0].data;
    expect(data.apiKeyEnc).toBe('enc:the-new-key');
  });
});

describe('AiProviderConfigService keyless endpoints', () => {
  const row = {
    id: 'ai-1',
    name: 'Embedding pod',
    provider: 'OPENAI_COMPATIBLE',
    model: 'embeddinggemma-2',
    apiKeyEnc: null as string | null,
    baseUrl: 'http://llama-embedding.classifyre-dev.svc:8080/v1' as
      | string
      | null,
    contextSize: null,
    supportsVision: false,
    supportsEmbedding: true,
    embeddingDimensions: 768,
    embeddingPooling: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('resolves a self-hosted OpenAI-compatible endpoint that has no key', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue(row);

    const runtime = await service.getRuntimeConfig('ai-1');

    expect(runtime.apiKey).toBe('');
    expect(runtime.baseUrl).toBe(row.baseUrl);
    expect(runtime.embeddingDimensions).toBe(768);
  });

  it('still refuses a managed provider without a key', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue({
      ...row,
      provider: 'GEMINI',
      baseUrl: null,
    });

    await expect(service.getRuntimeConfig('ai-1')).rejects.toThrow(
      'has no API key configured',
    );
  });

  it('still refuses an OpenAI-compatible provider with neither key nor endpoint', async () => {
    const { service, prisma } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue({
      ...row,
      baseUrl: '  ',
    });

    await expect(service.getRuntimeConfig('ai-1')).rejects.toThrow(
      'has no API key configured',
    );
  });

  it('does not treat a stored key that no longer decrypts as keyless', async () => {
    const { service, prisma, crypto } = createService();
    prisma.aiProviderConfig.findUnique.mockResolvedValue({
      ...row,
      apiKeyEnc: 'enc:from-another-deployment',
    });
    crypto.decryptString.mockImplementation(() => {
      throw new Error('bad decrypt');
    });

    await expect(service.getRuntimeConfig('ai-1')).rejects.toThrow(
      'has no API key configured',
    );
  });
});
