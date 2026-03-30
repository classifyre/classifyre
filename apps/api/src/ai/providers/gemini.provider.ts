import { GoogleGenAI } from '@google/genai';
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

export class GeminiProvider implements IAiProvider {
  async complete(
    messages: AiMessage[],
    config: AiProviderRuntimeConfig,
    options: AiCompletionOptions,
  ): Promise<string> {
    const client = new GoogleGenAI({ apiKey: config.apiKey });

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

      return response.text ?? '';
    } catch (err) {
      throw mapGeminiError(err);
    }
  }
}

function mapGeminiError(err: unknown): Error {
  if (!(err instanceof Error)) {
    return new AiProviderError(String(err));
  }

  const msg = err.message.toLowerCase();

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
  if (
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

  return new AiProviderError(err.message);
}
