import Anthropic, {
  APIConnectionError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import type {
  MessageParam,
  TextBlock,
} from '@anthropic-ai/sdk/resources/messages';
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

export class ClaudeProvider implements IAiProvider {
  async complete(
    messages: AiMessage[],
    config: AiProviderRuntimeConfig,
    options: AiCompletionOptions,
  ): Promise<string> {
    const client = new Anthropic({ apiKey: config.apiKey });

    const systemParts = messages.filter((m) => m.role === 'system');
    const system = systemParts.map((m) => m.content).join('\n\n') || undefined;

    const claudeMessages: MessageParam[] = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Anthropic requires at least one user message and messages must alternate.
    // If the array is empty or starts with assistant, prepend a sentinel.
    if (
      claudeMessages.length === 0 ||
      claudeMessages[0]?.role === 'assistant'
    ) {
      claudeMessages.unshift({ role: 'user', content: '.' });
    }

    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: options.maxTokens ?? 4096,
        ...(system !== undefined ? { system } : {}),
        messages: claudeMessages,
        temperature: options.temperature ?? 0.3,
      });

      const textBlock = response.content.find(
        (b): b is TextBlock => b.type === 'text',
      );
      return textBlock?.text ?? '';
    } catch (err) {
      throw mapClaudeError(err);
    }
  }
}

function mapClaudeError(err: unknown): Error {
  if (err instanceof AuthenticationError) {
    return new AiAuthError(
      `Claude authentication failed. Check the API key in AI provider settings. (${err.message})`,
    );
  }
  if (err instanceof RateLimitError) {
    return new AiRateLimitError(
      `Claude rate limit reached. Retry later. (${err.message})`,
    );
  }
  if (err instanceof NotFoundError) {
    return new AiModelNotFoundError(`Claude model not found. (${err.message})`);
  }
  if (err instanceof APIConnectionError) {
    return new AiProviderError(
      `Could not connect to Anthropic API. (${err.message})`,
    );
  }
  if (err instanceof Anthropic.APIError) {
    return new AiProviderError(err.message, err.status);
  }
  return err instanceof Error
    ? new AiProviderError(err.message)
    : new AiProviderError(String(err));
}
