import { GoogleGenAI } from '@google/genai';
import {
  AiAuthError,
  AiModelNotFoundError,
  AiProviderError,
  AiQuotaExhaustedError,
  AiRateLimitError,
} from '../errors';
import type {
  AiCompletionOptions,
  AiMessage,
  AiProviderResult,
  AiProviderRuntimeConfig,
  IAiProvider,
} from '../types';

export class GeminiProvider implements IAiProvider {
  async complete(
    messages: AiMessage[],
    config: AiProviderRuntimeConfig,
    options: AiCompletionOptions,
  ): Promise<AiProviderResult> {
    const client = new GoogleGenAI({
      apiKey: config.apiKey,
      httpOptions: { timeout: 30 * 60 * 1000 },
    });

    const systemParts = messages.filter((m) => m.role === 'system');
    const systemInstruction =
      systemParts.map((m) => m.content).join('\n\n') || undefined;

    // Gemini uses 'user' and 'model' roles (not 'assistant')
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    try {
      const response = await client.models.generateContent({
        model: config.model,
        contents,
        config: {
          temperature: options.temperature ?? 0.3,
          ...(options.maxTokens !== undefined
            ? { maxOutputTokens: options.maxTokens }
            : {}),
          ...(systemInstruction !== undefined ? { systemInstruction } : {}),
        },
      });

      const meta = response.usageMetadata;
      return {
        text: response.text ?? '',
        usage: meta
          ? {
              inputTokens: meta.promptTokenCount ?? 0,
              // Include thinking tokens — they are billed as output.
              outputTokens:
                (meta.candidatesTokenCount ?? 0) +
                (meta.thoughtsTokenCount ?? 0),
            }
          : null,
      };
    } catch (err) {
      throw mapGeminiError(err);
    }
  }
}

/**
 * HTTP status of a Gemini SDK failure, when it carries one. `ApiError`
 * exposes it as `status`; other shapes surface it as `statusCode` or `code`,
 * or only inside the message ("... 400 ...", "status 429").
 */
function geminiStatus(err: Error): number | undefined {
  const record = err as Error & {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
  };
  for (const field of [record.status, record.statusCode, record.code]) {
    if (typeof field === 'number' && Number.isFinite(field)) return field;
  }
  const match = err.message.match(/\b([1-5]\d\d)\b/);
  return match ? Number(match[1]) : undefined;
}

function mapGeminiError(err: unknown): Error {
  if (!(err instanceof Error)) {
    return new AiProviderError(String(err));
  }

  const msg = err.message.toLowerCase();
  const status = geminiStatus(err);

  if (
    msg.includes('api key not valid') ||
    msg.includes('api_key_invalid') ||
    msg.includes('unauthorized') ||
    msg.includes('invalid api key') ||
    msg.includes('permission denied')
  ) {
    return new AiAuthError(
      `Gemini authentication failed. Check the API key in AI provider settings. (${err.message})`,
    );
  }
  // HTTP 402 is "payment required": the allowance is gone, never a blip.
  if (status === 402) {
    return new AiQuotaExhaustedError(
      `Gemini quota exhausted. (${err.message})`,
    );
  }
  if (
    status === 429 ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit')
  ) {
    return new AiRateLimitError(
      `Gemini rate limit reached. Retry later. (${err.message})`,
    );
  }
  if (
    msg.includes('not found') ||
    (msg.includes('model') && msg.includes('404'))
  ) {
    return new AiModelNotFoundError(`Gemini model not found. (${err.message})`);
  }

  // An unknown 4xx (e.g. a safety-block 400) is a final answer for this
  // input, not a busy provider: it carries its status so the client does not
  // retry it. Retry stays for 5xx, plain 429s and network errors (no status).
  if (status !== undefined && status >= 400 && status < 500) {
    return new AiProviderError(err.message, status);
  }
  return new AiProviderError(
    err.message,
    status !== undefined && status >= 500 ? status : undefined,
  );
}
