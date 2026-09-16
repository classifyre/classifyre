import { GoogleGenAI } from '@google/genai';
import {
  AiProviderError,
  AiQuotaExhaustedError,
  AiRateLimitError,
} from '../errors';
import type { AiProviderRuntimeConfig } from '../types';
import { GeminiProvider } from './gemini.provider';

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn(),
}));

const MockGoogleGenAI = GoogleGenAI as unknown as jest.Mock;

const config: AiProviderRuntimeConfig = {
  provider: 'GEMINI',
  model: 'gemini-2.0-flash',
  apiKey: '[REDACTED]',
  baseUrl: null,
  supportsVision: false,
};

function failWith(error: unknown): void {
  MockGoogleGenAI.mockImplementation(() => ({
    models: { generateContent: jest.fn().mockRejectedValue(error) },
  }));
}

/** A Gemini SDK failure carrying an HTTP status, like ApiError does. */
function statusError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

const messages = [{ role: 'user' as const, content: 'hi' }];

describe('GeminiProvider error mapping', () => {
  beforeEach(() => {
    MockGoogleGenAI.mockReset();
  });

  it('maps a safety-block 400 to a non-retryable provider error', async () => {
    failWith(
      statusError(
        'GenerateContent failed: response blocked for SAFETY reasons. status 400',
        400,
      ),
    );

    const attempt = new GeminiProvider().complete(messages, config, {});

    await expect(attempt).rejects.toBeInstanceOf(AiProviderError);
    await expect(attempt).rejects.not.toBeInstanceOf(AiRateLimitError);
    await expect(attempt).rejects.toMatchObject({ statusCode: 400 });
  });

  it('keeps retrying 5xx and network errors', async () => {
    failWith(
      statusError('GenerateContent failed: overloaded. status 503', 503),
    );

    await expect(
      new GeminiProvider().complete(messages, config, {}),
    ).rejects.toMatchObject({ statusCode: 503 });

    failWith(new Error('socket hang up'));

    const network = new GeminiProvider().complete(messages, config, {});
    await expect(network).rejects.toBeInstanceOf(AiProviderError);
    await expect(network).rejects.toMatchObject({ statusCode: undefined });
  });

  it('maps quota exhaustion to a rate limit the client cools down', async () => {
    failWith(
      statusError(
        'GenerateContent failed: RESOURCE_EXHAUSTED quota exceeded. status 429',
        429,
      ),
    );

    await expect(
      new GeminiProvider().complete(messages, config, {}),
    ).rejects.toBeInstanceOf(AiRateLimitError);
  });

  it('maps a plain 429 to a rate limit', async () => {
    failWith(statusError('Too Many Requests. status 429', 429));

    await expect(
      new GeminiProvider().complete(messages, config, {}),
    ).rejects.toBeInstanceOf(AiRateLimitError);
  });

  it('maps HTTP 402 to quota exhausted', async () => {
    failWith(
      statusError('Payment Required: billing disabled. status 402', 402),
    );

    await expect(
      new GeminiProvider().complete(messages, config, {}),
    ).rejects.toBeInstanceOf(AiQuotaExhaustedError);
  });
});
