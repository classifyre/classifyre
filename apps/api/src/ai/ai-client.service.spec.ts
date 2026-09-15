import { Test, TestingModule } from '@nestjs/testing';
import {
  AiClientService,
  backoffDelaysMs,
  isQuotaExhausted,
} from './ai-client.service';
import { validateAgainstSchema } from './schema-validate';
import {
  AiAuthError,
  AiConfigError,
  AiModelNotFoundError,
  AiProviderError,
  AiQuotaExhaustedError,
  AiRateLimitError,
  AiSchemaError,
} from './errors';
import type { AiProviderResult, AiProviderRuntimeConfig } from './types';
import { AiProviderConfigService } from '../ai-provider-config.service';

// ── Mock provider factory ────────────────────────────────────────────────────

// Tests may resolve a plain string (no usage metadata) or a full
// AiProviderResult; the factory normalizes to what the real interface returns.
const mockProviderComplete = jest.fn<
  Promise<string | AiProviderResult>,
  [unknown, AiProviderRuntimeConfig, unknown]
>();

jest.mock('./providers', () => ({
  createProvider: () => ({
    complete: async (
      ...args: Parameters<typeof mockProviderComplete>
    ): Promise<AiProviderResult> => {
      const result = await mockProviderComplete(...args);
      return typeof result === 'string'
        ? { text: result, usage: null }
        : result;
    },
  }),
}));

// ── Mock AiProviderConfigService ─────────────────────────────────────────────

const mockRuntimeConfig: AiProviderRuntimeConfig = {
  provider: 'CLAUDE',
  model: 'claude-sonnet-4-5',
  apiKey: 'sk-test-key',
  baseUrl: null,
  supportsVision: false,
};

const mockProviderConfigService = {
  getDefaultConfigId: jest.fn().mockResolvedValue('config-1'),
  getRuntimeConfig: jest.fn().mockResolvedValue(mockRuntimeConfig),
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
    mockProviderConfigService.getDefaultConfigId.mockResolvedValue('config-1');
    mockProviderConfigService.getRuntimeConfig.mockResolvedValue(
      mockRuntimeConfig,
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
      expect(result.usage).toBeNull();
    });

    it('passes through provider-reported token usage', async () => {
      mockProviderComplete.mockResolvedValueOnce({
        text: 'Hello',
        usage: { inputTokens: 12, outputTokens: 3 },
      });

      const result = await service.completeText([
        { role: 'user', content: 'Say hello' },
      ]);

      expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    });

    it('throws AiConfigError when no default provider is selected', async () => {
      mockProviderConfigService.getDefaultConfigId.mockResolvedValueOnce(null);

      await expect(
        service.completeText([{ role: 'user', content: 'hi' }]),
      ).rejects.toBeInstanceOf(AiConfigError);
    });

    it('propagates AiConfigError from the resolved credential', async () => {
      mockProviderConfigService.getRuntimeConfig.mockRejectedValueOnce(
        new AiConfigError('no key'),
      );

      await expect(
        service.completeText([{ role: 'user', content: 'hi' }]),
      ).rejects.toBeInstanceOf(AiConfigError);
    });

    it('targets a specific credential when configId is passed', async () => {
      mockProviderComplete.mockResolvedValueOnce('ok');

      await service.completeText([{ role: 'user', content: 'hi' }], {
        configId: 'config-2',
      });

      expect(mockProviderConfigService.getRuntimeConfig).toHaveBeenCalledWith(
        'config-2',
      );
      expect(
        mockProviderConfigService.getDefaultConfigId,
      ).not.toHaveBeenCalled();
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

    it('surfaces AiRateLimitError without retrying when backoff is disabled', async () => {
      mockProviderComplete.mockRejectedValueOnce(
        new AiRateLimitError('rate limited'),
      );

      await expect(
        service.completeText([{ role: 'user', content: 'hi' }], {
          rateLimitRetries: 0,
        }),
      ).rejects.toBeInstanceOf(AiRateLimitError);
      expect(mockProviderComplete).toHaveBeenCalledTimes(1);
    });

    it('retries a no-body 404 (transient gateway miss) then succeeds', async () => {
      // Fire the backoff delay immediately so the retry runs without real waits.
      const timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((
        cb: () => void,
      ) => {
        cb();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);
      mockProviderComplete
        .mockRejectedValueOnce(new AiProviderError('404 (no body)', 404))
        .mockResolvedValueOnce('Recovered');

      const result = await service.completeText([
        { role: 'user', content: 'hi' },
      ]);

      expect(result.content).toBe('Recovered');
      expect(mockProviderComplete).toHaveBeenCalledTimes(2);
      timeoutSpy.mockRestore();
    });

    describe('a spent quota', () => {
      // Verbatim from the worker log on 2026-09-13: each of these was retried
      // at 60, 120 and 240 s while holding one of four global worker slots.
      const dailyQuota = () =>
        new AiRateLimitError(
          'OpenAI rate limit reached. Retry later. (429 Rate limit exceeded: ' +
            'free-models-per-day. Add 10 credits to unlock 1000 free model ' +
            'requests per day)',
        );
      const hi = [{ role: 'user' as const, content: 'hi' }];

      afterEach(() => jest.restoreAllMocks());

      it('is not retried, and says when it can be tried again', async () => {
        mockProviderComplete.mockRejectedValueOnce(dailyQuota());

        const attempt = service.completeText(hi);

        await expect(attempt).rejects.toBeInstanceOf(AiQuotaExhaustedError);
        // Still an AiRateLimitError for every existing handler.
        await expect(attempt).rejects.toBeInstanceOf(AiRateLimitError);
        expect(mockProviderComplete).toHaveBeenCalledTimes(1);
      });

      it('refuses the next call on the same credential without asking the provider', async () => {
        mockProviderComplete.mockRejectedValueOnce(dailyQuota());
        await expect(service.completeText(hi)).rejects.toThrow(
          'free-models-per-day',
        );

        await expect(service.completeText(hi)).rejects.toThrow(
          /not calling it again until/,
        );
        expect(mockProviderComplete).toHaveBeenCalledTimes(1);
      });

      it('does not cool down a different credential', async () => {
        mockProviderComplete.mockRejectedValueOnce(dailyQuota());
        await expect(service.completeText(hi)).rejects.toBeInstanceOf(
          AiQuotaExhaustedError,
        );

        mockProviderConfigService.getRuntimeConfig.mockResolvedValueOnce({
          ...mockRuntimeConfig,
          apiKey: 'sk-paid-key',
        });
        mockProviderComplete.mockResolvedValueOnce('answered');

        await expect(service.completeText(hi)).resolves.toMatchObject({
          content: 'answered',
        });
      });

      it('asks the provider again once the cooldown has passed', async () => {
        const start = Date.now();
        const now = jest.spyOn(Date, 'now').mockReturnValue(start);
        mockProviderComplete.mockRejectedValueOnce(dailyQuota());
        await expect(service.completeText(hi)).rejects.toBeInstanceOf(
          AiQuotaExhaustedError,
        );

        // The 15-minute expiry is jittered ±10%, so wait past its ceiling.
        now.mockReturnValue(start + 20 * 60 * 1000);
        mockProviderComplete.mockResolvedValueOnce('reset');

        await expect(service.completeText(hi)).resolves.toMatchObject({
          content: 'reset',
        });
        expect(mockProviderComplete).toHaveBeenCalledTimes(2);
      });

      it('names the stored provider message in the cooldown refusal', async () => {
        mockProviderComplete.mockRejectedValueOnce(dailyQuota());
        await expect(service.completeText(hi)).rejects.toBeInstanceOf(
          AiQuotaExhaustedError,
        );

        const refusal = service.completeText(hi);
        await expect(refusal).rejects.toThrow('free-models-per-day');
        await expect(refusal).rejects.toThrow(/not calling it again until/);
        expect(mockProviderComplete).toHaveBeenCalledTimes(1);
      });

      it('treats HTTP 402 as quota exhausted, never retried', async () => {
        mockProviderComplete.mockRejectedValueOnce(
          new AiProviderError('402 Payment Required: add funds', 402),
        );

        await expect(service.completeText(hi)).rejects.toBeInstanceOf(
          AiQuotaExhaustedError,
        );
        expect(mockProviderComplete).toHaveBeenCalledTimes(1);

        // And the cooldown fires for it too.
        await expect(service.completeText(hi)).rejects.toThrow(
          /not calling it again until/,
        );
        expect(mockProviderComplete).toHaveBeenCalledTimes(1);
      });

      it('treats a billing-exhaustion body as quota exhausted whatever the status', async () => {
        mockProviderComplete.mockRejectedValueOnce(
          new AiProviderError(
            '400 failed_precondition: insufficient_credit, balance empty',
            400,
          ),
        );

        await expect(service.completeText(hi)).rejects.toBeInstanceOf(
          AiQuotaExhaustedError,
        );
        expect(mockProviderComplete).toHaveBeenCalledTimes(1);
      });

      it('leaves an ordinary 400 to fail without a cooldown', async () => {
        mockProviderComplete
          .mockRejectedValueOnce(new AiProviderError('400 bad request', 400))
          .mockRejectedValueOnce(new AiProviderError('400 bad request', 400));

        await expect(
          service.completeText(hi, { rateLimitRetries: 0 }),
        ).rejects.toBeInstanceOf(AiProviderError);
        await expect(
          service.completeText(hi, { rateLimitRetries: 0 }),
        ).rejects.toBeInstanceOf(AiProviderError);
        // No cooldown: the provider was asked again.
        expect(mockProviderComplete).toHaveBeenCalledTimes(2);
      });

      it('leaves an ordinary rate limit to the backoff', async () => {
        const timeoutSpy = jest
          .spyOn(global, 'setTimeout')
          .mockImplementation(((cb: () => void) => {
            cb();
            return 0 as unknown as ReturnType<typeof setTimeout>;
          }) as typeof setTimeout);
        mockProviderComplete
          .mockRejectedValueOnce(new AiRateLimitError('429 slow down'))
          .mockResolvedValueOnce('after backoff');

        await expect(service.completeText(hi)).resolves.toMatchObject({
          content: 'after backoff',
        });
        expect(mockProviderComplete).toHaveBeenCalledTimes(2);
        timeoutSpy.mockRestore();
      });
    });

    it('never retries AiModelNotFoundError (genuine missing model)', async () => {
      mockProviderComplete.mockRejectedValueOnce(
        new AiModelNotFoundError('OpenAI model not found.'),
      );

      await expect(
        service.completeText([{ role: 'user', content: 'hi' }]),
      ).rejects.toBeInstanceOf(AiModelNotFoundError);
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

    it('accumulates token usage across failed and successful attempts', async () => {
      mockProviderComplete
        .mockResolvedValueOnce({
          text: 'not json at all',
          usage: { inputTokens: 100, outputTokens: 10 },
        })
        .mockResolvedValueOnce({
          text: '{"name":"retry","value":7}',
          usage: { inputTokens: 120, outputTokens: 15 },
        });

      const result = await service.completeJson<{
        name: string;
        value: number;
      }>([{ role: 'user', content: 'Go' }], simpleSchema, { maxRetries: 1 });

      expect(result.usage).toEqual({
        inputTokens: 220,
        outputTokens: 25,
        cachedInputTokens: 0,
      });
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

/**
 * An error a caller cannot act on reads to it as an error that cannot be fixed.
 *
 * The detector-authoring agent hit `(root) must NOT have additional properties`
 * five times in a row against the live instance. Ajv knows exactly which key it
 * rejected — it is sitting in `error.params.additionalProperty` — but the
 * message dropped it, so the agent could only guess ("remove case_sensitive",
 * "try just the pipeline_schema", "try absolute minimal REGEX schema"), burned
 * its whole iteration budget, and authored nothing.
 */
describe('isQuotaExhausted', () => {
  it('passes through an already-classified quota error', () => {
    expect(isQuotaExhausted(new AiQuotaExhaustedError('gone', null))).toBe(
      true,
    );
  });

  it('matches the new resource/quota wording on a 429', () => {
    expect(
      isQuotaExhausted(
        new AiRateLimitError('RESOURCE_EXHAUSTED: quota used up'),
      ),
    ).toBe(true);
    expect(
      isQuotaExhausted(new AiRateLimitError('Quota exceeded for metric X')),
    ).toBe(true);
  });

  it('matches HTTP 402 without any marker wording', () => {
    expect(isQuotaExhausted(new AiProviderError('Payment Required', 402))).toBe(
      true,
    );
  });

  it('matches billing-exhaustion bodies whatever the status', () => {
    expect(
      isQuotaExhausted(new AiProviderError('insufficient_credit: empty', 400)),
    ).toBe(true);
    expect(
      isQuotaExhausted(new AiProviderError('you are out of credits', 429)),
    ).toBe(true);
  });

  it('rejects ordinary rate limits and provider errors', () => {
    expect(isQuotaExhausted(new AiRateLimitError('429 slow down'))).toBe(false);
    expect(isQuotaExhausted(new AiProviderError('boom', 500))).toBe(false);
    expect(isQuotaExhausted(new AiProviderError('bad request', 400))).toBe(
      false,
    );
  });
});

describe('backoffDelaysMs', () => {
  const previousEnv = process.env;

  afterEach(() => {
    process.env = previousEnv;
  });

  it('keeps the 60/120/240 shape by default', () => {
    process.env = { ...previousEnv };
    delete process.env.AI_RATE_LIMIT_BACKOFF_BUDGET_MS;
    expect(backoffDelaysMs()).toEqual([60_000, 120_000, 240_000]);
  });

  it('scales the shape to fit under a smaller budget', () => {
    process.env = {
      ...previousEnv,
      AI_RATE_LIMIT_BACKOFF_BUDGET_MS: '42000',
    };
    const delays = backoffDelaysMs();
    expect(delays).toEqual([6_000, 12_000, 24_000]);
    expect(delays.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(42_000);
  });
});

describe('schema error messages name what was wrong', () => {
  const objectSchema = {
    type: 'object',
    properties: { name: { type: 'string' }, mode: { enum: ['A', 'B'] } },
    required: ['name'],
    additionalProperties: false,
  } as const;

  it('names the rejected property instead of "additional properties"', () => {
    expect(() =>
      validateAgainstSchema(
        { name: 'x', case_sensitive: true },
        objectSchema as never,
      ),
    ).toThrow(/case_sensitive/);
  });

  it('names the missing property', () => {
    expect(() => validateAgainstSchema({}, objectSchema as never)).toThrow(
      /"name"/,
    );
  });

  it('lists the allowed values for a bad enum', () => {
    expect(() =>
      validateAgainstSchema({ name: 'x', mode: 'Z' }, objectSchema as never),
    ).toThrow(/allowed: A, B/);
  });
});
