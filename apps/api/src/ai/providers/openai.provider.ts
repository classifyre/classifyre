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

/**
 * A 404 is a genuinely-missing model only when the response body says so — an
 * OpenAI-style `code: "model_not_found"` or a body that names the model. A 404
 * with no body (`err.error` unset) is a gateway/routing miss and is treated as
 * transient by the caller.
 */
function isGenuineMissingModel(err: NotFoundError): boolean {
  const code = (err as { code?: string | null }).code;
  if (typeof code === 'string' && code.toLowerCase().includes('model')) {
    return true;
  }
  const body = (err as { error?: unknown }).error;
  if (body == null) return false; // "(no body)" → transient, not a real 404 model
  return JSON.stringify(body).toLowerCase().includes('model');
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
    // A genuine missing-model 404 from an OpenAI-style server carries a body
    // describing the model (code "model_not_found", or a message naming it). A
    // bare "404 status code (no body)" from an OpenAI-compatible gateway
    // (NVIDIA/vLLM behind a load balancer, a model still cold-starting) is a
    // transient routing miss, NOT a config error — mapping it to
    // AiModelNotFoundError (which the client never retries) turns a blip into a
    // fatal run failure. Only the former is permanent; the latter is retryable.
    if (isGenuineMissingModel(err)) {
      return new AiModelNotFoundError(
        `OpenAI model not found. (${err.message})`,
      );
    }
    return new AiProviderError(
      `OpenAI endpoint returned 404 with no error body — treating as a ` +
        `transient gateway miss, not a missing model. (${err.message})`,
      404,
    );
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
