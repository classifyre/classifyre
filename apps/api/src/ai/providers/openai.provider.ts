import OpenAI, {
  APIConnectionError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
} from 'openai';
import {
  AiAuthError,
  AiModelNotFoundError,
  AiProviderError,
  AiRateLimitError,
} from '../errors';
import type {
  AiCompletionOptions,
  AiMessage,
  AiProviderResult,
  AiProviderRuntimeConfig,
  IAiProvider,
} from '../types';

/** Providers can be slow when busy — allow very long requests. */
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

export class OpenAiProvider implements IAiProvider {
  async complete(
    messages: AiMessage[],
    config: AiProviderRuntimeConfig,
    options: AiCompletionOptions,
  ): Promise<AiProviderResult> {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? undefined,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });

    const request = (
      responseFormat?:
        | { type: 'json_object' }
        | {
            type: 'json_schema';
            json_schema: { name: string; schema: Record<string, unknown> };
          },
    ) =>
      client.chat.completions.create({
        model: config.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options.temperature ?? 0.3,
        ...(options.maxTokens !== undefined
          ? { max_tokens: options.maxTokens }
          : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
      });

    try {
      let completion;
      if (options.jsonSchema) {
        // Prefer server-side structured output (vLLM/llama.cpp/OpenAI all
        // understand json_schema); fall back for servers that reject it.
        try {
          completion = await request({
            type: 'json_schema',
            json_schema: {
              name: 'output',
              schema: options.jsonSchema,
            },
          });
        } catch (err) {
          if (isUnsupportedResponseFormat(err)) {
            try {
              completion = await request({ type: 'json_object' });
            } catch (err2) {
              if (!isUnsupportedResponseFormat(err2)) throw err2;
              completion = await request();
            }
          } else {
            throw err;
          }
        }
      } else {
        completion = await request();
      }

      return {
        text: completion.choices[0]?.message?.content ?? '',
        usage: completion.usage
          ? {
              inputTokens: completion.usage.prompt_tokens ?? 0,
              outputTokens: completion.usage.completion_tokens ?? 0,
            }
          : null,
      };
    } catch (err) {
      throw mapOpenAiError(err);
    }
  }
}

/** 400s complaining about response_format → the server doesn't support it. */
function isUnsupportedResponseFormat(err: unknown): boolean {
  if (!(err instanceof OpenAI.APIError)) return false;
  if (err.status !== 400) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('response_format') ||
    msg.includes('json_schema') ||
    msg.includes('structured output') ||
    msg.includes('guided')
  );
}

function mapOpenAiError(err: unknown): Error {
  if (err instanceof AuthenticationError) {
    return new AiAuthError(
      `OpenAI authentication failed. Check the API key in AI provider settings. (${err.message})`,
    );
  }
  if (err instanceof RateLimitError) {
    return new AiRateLimitError(
      `OpenAI rate limit reached. Retry later. (${err.message})`,
    );
  }
  if (err instanceof NotFoundError) {
    return new AiModelNotFoundError(`OpenAI model not found. (${err.message})`);
  }
  if (err instanceof APIConnectionError) {
    return new AiProviderError(
      `Could not connect to OpenAI endpoint. (${err.message})`,
    );
  }
  if (err instanceof OpenAI.APIError) {
    return new AiProviderError(err.message, err.status);
  }
  return err instanceof Error
    ? new AiProviderError(err.message)
    : new AiProviderError(String(err));
}
