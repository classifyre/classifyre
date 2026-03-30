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
  AiProviderRuntimeConfig,
  IAiProvider,
} from '../types';

export class OpenAiProvider implements IAiProvider {
  async complete(
    messages: AiMessage[],
    config: AiProviderRuntimeConfig,
    options: AiCompletionOptions,
  ): Promise<string> {
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl ?? undefined,
    });

    try {
      const completion = await client.chat.completions.create({
        model: config.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: options.temperature ?? 0.3,
        ...(options.maxTokens !== undefined
          ? { max_tokens: options.maxTokens }
          : {}),
      });

      return completion.choices[0]?.message?.content ?? '';
    } catch (err) {
      throw mapOpenAiError(err);
    }
  }
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
