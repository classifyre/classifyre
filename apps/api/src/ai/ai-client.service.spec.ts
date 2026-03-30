import { Test, TestingModule } from '@nestjs/testing';
import { AiClientService } from './ai-client.service';
import {
  AiAuthError,
  AiConfigError,
  AiRateLimitError,
  AiSchemaError,
} from './errors';
import type { AiProviderRuntimeConfig } from './types';
import { AiProviderConfigService } from '../ai-provider-config.service';

// ── Mock provider factory ────────────────────────────────────────────────────

const mockProviderComplete = jest.fn<
  Promise<string>,
  [unknown, AiProviderRuntimeConfig, unknown]
>();

jest.mock('./providers', () => ({
  createProvider: () => ({
    complete: (...args: Parameters<typeof mockProviderComplete>) =>
      mockProviderComplete(...args),
  }),
}));

// ── Mock AiProviderConfigService ─────────────────────────────────────────────

const mockConfig = {
  provider: 'CLAUDE' as const,
  model: 'claude-sonnet-4-5',
  hasApiKey: true,
  apiKeyPreview: 'sk-a...b123',
  baseUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockProviderConfigService = {
  getConfig: jest.fn().mockResolvedValue(mockConfig),
  getDecryptedApiKey: jest.fn().mockResolvedValue('sk-test-key'),
};

// ── Test suite ───────────────────────────────────────────────────────────────

describe('AiClientService', () => {
  let service: AiClientService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiClientService,
        {
          provide: AiProviderConfigService,
          useValue: mockProviderConfigService,
        },
      ],
    }).compile();

    service = module.get(AiClientService);
    jest.clearAllMocks();
    mockProviderConfigService.getConfig.mockResolvedValue(mockConfig);
    mockProviderConfigService.getDecryptedApiKey.mockResolvedValue(
      'sk-test-key',
    );
  });

  // ── completeText ────────────────────────────────────────────────────────────

  describe('completeText', () => {
    it('returns a plain text response', async () => {
      mockProviderComplete.mockResolvedValueOnce('Hello world');

      const result = await service.completeText([
        { role: 'user', content: 'Say hello' },
      ]);

      expect(result.content).toBe('Hello world');
      expect(result.model).toBe('claude-sonnet-4-5');
      expect(result.provider).toBe('CLAUDE');
    });

    it('throws AiConfigError when no API key is stored', async () => {
      mockProviderConfigService.getDecryptedApiKey.mockResolvedValueOnce(null);

      await expect(
        service.completeText([{ role: 'user', content: 'hi' }]),
      ).rejects.toBeInstanceOf(AiConfigError);
    });

    it('throws AiConfigError when model is empty', async () => {
      mockProviderConfigService.getConfig.mockResolvedValueOnce({
        ...mockConfig,
        model: '',
      });

      await expect(
        service.completeText([{ role: 'user', content: 'hi' }]),
      ).rejects.toBeInstanceOf(AiConfigError);
    });

    it('surfaces AiAuthError without retrying', async () => {
      mockProviderComplete.mockRejectedValueOnce(
        new AiAuthError('invalid key'),
      );

      await expect(
        service.completeText([{ role: 'user', content: 'hi' }]),
      ).rejects.toBeInstanceOf(AiAuthError);
      expect(mockProviderComplete).toHaveBeenCalledTimes(1);
    });

    it('surfaces AiRateLimitError without retrying', async () => {
      mockProviderComplete.mockRejectedValueOnce(
        new AiRateLimitError('rate limited'),
      );

      await expect(
        service.completeText([{ role: 'user', content: 'hi' }]),
      ).rejects.toBeInstanceOf(AiRateLimitError);
      expect(mockProviderComplete).toHaveBeenCalledTimes(1);
    });
  });

  // ── completeJson ────────────────────────────────────────────────────────────

  const simpleSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      value: { type: 'number' },
    },
    required: ['name', 'value'],
  };

  describe('completeJson', () => {
    it('parses a valid bare JSON response', async () => {
      mockProviderComplete.mockResolvedValueOnce('{"name":"test","value":42}');

      const result = await service.completeJson<{
        name: string;
        value: number;
      }>([{ role: 'user', content: 'Give me JSON' }], simpleSchema);

      expect(result.content).toEqual({ name: 'test', value: 42 });
    });

    it('parses JSON inside a markdown code block', async () => {
      mockProviderComplete.mockResolvedValueOnce(
        '```json\n{"name":"fenced","value":1}\n```',
      );

      const result = await service.completeJson<{
        name: string;
        value: number;
      }>([{ role: 'user', content: 'Give me JSON' }], simpleSchema);

      expect(result.content.name).toBe('fenced');
    });

    it('injects JSON system hint when no system message is present', async () => {
      mockProviderComplete.mockResolvedValueOnce('{"name":"x","value":0}');

      await service.completeJson(
        [{ role: 'user', content: 'Go' }],
        simpleSchema,
      );

      const calls = mockProviderComplete.mock.calls;
      const messages = calls[0]?.[0] as { role: string; content: string }[];
      expect(messages[0]?.role).toBe('system');
      expect(messages[0]?.content).toContain('valid JSON');
    });

    it('appends JSON hint to existing system message', async () => {
      mockProviderComplete.mockResolvedValueOnce('{"name":"x","value":0}');

      await service.completeJson(
        [
          { role: 'system', content: 'You are a bot.' },
          { role: 'user', content: 'Go' },
        ],
        simpleSchema,
      );

      const calls = mockProviderComplete.mock.calls;
      const messages = calls[0]?.[0] as { role: string; content: string }[];
      const sys = messages.find((m) => m.role === 'system');
      expect(sys?.content).toContain('You are a bot.');
      expect(sys?.content).toContain('valid JSON');
    });

    it('retries on invalid JSON then succeeds', async () => {
      mockProviderComplete
        .mockResolvedValueOnce('not json at all')
        .mockResolvedValueOnce('{"name":"retry","value":7}');

      const result = await service.completeJson<{
        name: string;
        value: number;
      }>([{ role: 'user', content: 'Go' }], simpleSchema, { maxRetries: 1 });

      expect(result.content.name).toBe('retry');
      expect(mockProviderComplete).toHaveBeenCalledTimes(2);
    });

    it('retry turn includes bad output as assistant + correction user message', async () => {
      mockProviderComplete
        .mockResolvedValueOnce('bad output')
        .mockResolvedValueOnce('{"name":"ok","value":1}');

      await service.completeJson(
        [{ role: 'user', content: 'Go' }],
        simpleSchema,
        { maxRetries: 1 },
      );

      const retryMessages = mockProviderComplete.mock.calls[1]?.[0] as {
        role: string;
        content: string;
      }[];
      const lastTwo = retryMessages.slice(-2);
      expect(lastTwo[0]?.role).toBe('assistant');
      expect(lastTwo[0]?.content).toBe('bad output');
      expect(lastTwo[1]?.role).toBe('user');
      expect(lastTwo[1]?.content).toContain('not valid JSON');
    });

    it('throws AiSchemaError after all retries are exhausted', async () => {
      mockProviderComplete.mockResolvedValue('still not json');

      await expect(
        service.completeJson([{ role: 'user', content: 'Go' }], simpleSchema, {
          maxRetries: 2,
        }),
      ).rejects.toBeInstanceOf(AiSchemaError);

      expect(mockProviderComplete).toHaveBeenCalledTimes(3);
    });

    it('throws AiSchemaError when JSON is valid but fails schema validation', async () => {
      // Missing required 'value' field
      mockProviderComplete.mockResolvedValue('{"name":"x"}');

      await expect(
        service.completeJson([{ role: 'user', content: 'Go' }], simpleSchema, {
          maxRetries: 0,
        }),
      ).rejects.toBeInstanceOf(AiSchemaError);
    });

    it('never retries on AiAuthError inside completeJson', async () => {
      mockProviderComplete.mockRejectedValue(new AiAuthError('bad key'));

      await expect(
        service.completeJson([{ role: 'user', content: 'Go' }], simpleSchema),
      ).rejects.toBeInstanceOf(AiAuthError);

      expect(mockProviderComplete).toHaveBeenCalledTimes(1);
    });
  });
});
