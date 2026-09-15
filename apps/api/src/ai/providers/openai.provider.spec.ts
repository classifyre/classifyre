import OpenAI, { APIError } from 'openai';
import {
  AiProviderError,
  AiQuotaExhaustedError,
  AiRateLimitError,
} from '../errors';
import type { AiProviderRuntimeConfig } from '../types';
import { OpenAiProvider } from './openai.provider';

// bun test's jest shim has no requireActual, so the mock re-declares the
// SDK's error hierarchy instead of re-exporting it. instanceof still works
// because the provider and this spec resolve the same mocked classes.
jest.mock('openai', () => {
  class APIError extends Error {
    readonly status: number;
    readonly error: unknown;
    readonly headers: unknown;
    constructor(
      status: number,
      error: unknown,
      message: string | undefined,
      headers: unknown,
    ) {
      super(message);
      this.name = 'APIError';
      this.status = status;
      this.error = error;
      this.headers = headers;
    }
  }
  class AuthenticationError extends APIError {}
  class NotFoundError extends APIError {}
  class RateLimitError extends APIError {}
  class APIConnectionError extends Error {}
  const MockClient = jest.fn();
  (MockClient as unknown as Record<string, unknown>).APIError = APIError;
  return {
    __esModule: true,
    default: MockClient,
    APIError,
    AuthenticationError,
    NotFoundError,
    RateLimitError,
    APIConnectionError,
  };
});

const MockOpenAI = OpenAI as unknown as jest.Mock;
const create = jest.fn();

const config: AiProviderRuntimeConfig = {
  provider: 'OPENAI_COMPATIBLE',
  model: 'test-model',
  apiKey: '[REDACTED]',
  baseUrl: null,
  supportsVision: false,
};

const messages = [{ role: 'user' as const, content: 'hi' }];

describe('OpenAiProvider error mapping', () => {
  beforeEach(() => {
    create.mockReset();
    MockOpenAI.mockImplementation(() => ({
      chat: { completions: { create } },
    }));
  });

  it('maps HTTP 402 to quota exhausted', async () => {
    create.mockRejectedValueOnce(
      new APIError(
        402,
        undefined,
        '402 Payment Required: add funds',
        undefined,
      ),
    );

    const attempt = new OpenAiProvider().complete(messages, config, {});

    await expect(attempt).rejects.toBeInstanceOf(AiQuotaExhaustedError);
    // Still a rate limit for every existing handler.
    await expect(attempt).rejects.toBeInstanceOf(AiRateLimitError);
  });

  it('maps a billing-exhaustion body to quota exhausted whatever the status', async () => {
    create.mockRejectedValueOnce(
      new APIError(
        400,
        undefined,
        '400 failed_precondition: insufficient_credit, balance empty',
        undefined,
      ),
    );

    await expect(
      new OpenAiProvider().complete(messages, config, {}),
    ).rejects.toBeInstanceOf(AiQuotaExhaustedError);
  });

  it('leaves an ordinary 400 as a plain provider error', async () => {
    create.mockRejectedValueOnce(
      new APIError(400, undefined, '400 bad request', undefined),
    );

    const attempt = new OpenAiProvider().complete(messages, config, {});

    await expect(attempt).rejects.toBeInstanceOf(AiProviderError);
    await expect(attempt).rejects.not.toBeInstanceOf(AiQuotaExhaustedError);
    await expect(attempt).rejects.toMatchObject({ statusCode: 400 });
  });
});
