import { Injectable } from '@nestjs/common';
import { AiProviderConfigService } from '../ai-provider-config.service';
import {
  AiAuthError,
  AiConfigError,
  AiModelNotFoundError,
  AiProviderError,
  AiRateLimitError,
  AiSchemaError,
} from './errors';
import { extractJson } from './json-extract';
import { createProvider } from './providers';
import { validateAgainstSchema } from './schema-validate';
import type {
  AiCompletionOptions,
  AiMessage,
  AiProviderRuntimeConfig,
  AiResponse,
  JsonSchema,
} from './types';

const JSON_SYSTEM_HINT =
  'You MUST respond with valid JSON only — no explanation, no markdown fences, no extra text.';

@Injectable()
export class AiClientService {
  constructor(
    private readonly providerConfigService: AiProviderConfigService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Generate a plain-text completion.
   *
   * @example
   * const { content } = await aiClient.completeText([
   *   { role: 'system', content: 'You are a helpful assistant.' },
   *   { role: 'user', content: 'Explain what PII means in one sentence.' },
   * ]);
   */
  async completeText(
    messages: AiMessage[],
    options: AiCompletionOptions = {},
  ): Promise<AiResponse<string>> {
    const config = await this.getRuntimeConfig();
    const provider = createProvider(config.provider);
    const raw = await provider.complete(messages, config, options);
    return { content: raw, model: config.model, provider: config.provider };
  }

  /**
   * Generate a structured JSON completion validated against `schema`.
   * Retries up to `options.maxRetries` (default 2) times on parse/validation failure.
   *
   * @example
   * import { singleAssetScanResults } from '@workspace/schemas';
   *
   * const { content } = await aiClient.completeJson<ScanResult>(
   *   [{ role: 'user', content: 'Summarise this scan result …' }],
   *   singleAssetScanResults,
   * );
   */
  async completeJson<T = unknown>(
    messages: AiMessage[],
    schema: JsonSchema,
    options: AiCompletionOptions = {},
  ): Promise<AiResponse<T>> {
    const config = await this.getRuntimeConfig();
    const provider = createProvider(config.provider);
    const maxRetries = options.maxRetries ?? 2;

    // Inject JSON system hint once, before the first user message
    const baseMessages = injectJsonHint(messages);

    let currentMessages = baseMessages;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let raw = '';
      try {
        raw = await provider.complete(currentMessages, config, options);

        const parsed = extractJson(raw) as T;
        validateAgainstSchema(parsed, schema);

        return {
          content: parsed,
          model: config.model,
          provider: config.provider,
        };
      } catch (err) {
        // Never retry provider-level errors — surface immediately so callers
        // get the actionable root cause without unnecessary extra requests.
        if (
          err instanceof AiAuthError ||
          err instanceof AiRateLimitError ||
          err instanceof AiModelNotFoundError ||
          err instanceof AiProviderError
        ) {
          throw err;
        }

        lastError = err;

        if (attempt < maxRetries) {
          // Extend the conversation with the bad output + correction request
          currentMessages = addCorrectionTurn(currentMessages, raw, err);
        }
      }
    }

    throw new AiSchemaError(
      `Failed to produce valid JSON after ${maxRetries + 1} attempt(s).`,
      lastError,
    );
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private async getRuntimeConfig(): Promise<AiProviderRuntimeConfig> {
    const stored = await this.providerConfigService.getConfig();
    const apiKey = await this.providerConfigService.getDecryptedApiKey();

    if (!apiKey) {
      throw new AiConfigError(
        'No AI API key configured. Add one in Settings → AI Provider.',
      );
    }
    if (!stored.model.trim()) {
      throw new AiConfigError(
        'No AI model configured. Set one in Settings → AI Provider.',
      );
    }

    return {
      provider: stored.provider,
      model: stored.model,
      apiKey,
      baseUrl: stored.baseUrl,
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Prepend or merge a JSON hint into the system message so every provider
 * knows to return raw JSON.
 */
function injectJsonHint(messages: AiMessage[]): AiMessage[] {
  const hasSystem = messages.some((m) => m.role === 'system');

  if (hasSystem) {
    return messages.map((m) =>
      m.role === 'system'
        ? { ...m, content: `${m.content}\n\n${JSON_SYSTEM_HINT}` }
        : m,
    );
  }

  return [{ role: 'system', content: JSON_SYSTEM_HINT }, ...messages];
}

/**
 * Append the bad assistant response and a user correction request so the
 * provider gets a second chance to produce valid JSON.
 */
function addCorrectionTurn(
  messages: AiMessage[],
  badOutput: string,
  error: unknown,
): AiMessage[] {
  const reason =
    error instanceof Error ? error.message : 'Unknown parse error.';
  return [
    ...messages,
    { role: 'assistant', content: badOutput || '(empty)' },
    {
      role: 'user',
      content:
        `Your previous response was not valid JSON or did not match the required schema.\n` +
        `Error: ${reason}\n` +
        `Please respond with valid JSON only — no explanation, no markdown, no extra text.`,
    },
  ];
}
