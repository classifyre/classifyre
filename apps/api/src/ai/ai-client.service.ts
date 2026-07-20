import { Injectable, Logger } from '@nestjs/common';
import { AiProviderConfigService } from '../ai-provider-config.service';
import type { AiSchemaAttempt } from './errors';
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
import { normalizeAgainstSchema } from './schema-validate';
import type {
  AiCompletionOptions,
  AiMessage,
  AiProviderResult,
  AiProviderRuntimeConfig,
  AiResponse,
  AiUsage,
  JsonSchema,
} from './types';

const JSON_SYSTEM_HINT =
  'You MUST respond with valid JSON only — no explanation, no markdown fences, no extra text.';

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);

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
    const config = await this.getRuntimeConfig(options.configId);
    const provider = createProvider(config.provider);
    const result = await this.completeWithBackoff(
      provider,
      messages,
      config,
      options,
    );
    return {
      content: result.text,
      model: config.model,
      provider: config.provider,
      usage: result.usage,
    };
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
    const config = await this.getRuntimeConfig(options.configId);
    const provider = createProvider(config.provider);
    const maxRetries = options.maxRetries ?? 2;
    const providerOptions: AiCompletionOptions = {
      ...options,
      jsonSchema: options.jsonSchema ?? schema,
    };

    // Inject JSON system hint once, before the first user message
    const baseMessages = injectJsonHint(messages);

    let currentMessages = baseMessages;
    let lastError: unknown;
    const failedAttempts: AiSchemaAttempt[] = [];
    // Every attempt costs tokens — accumulate across the whole retry loop so
    // callers can attribute the true consumption of this response.
    let totalUsage: AiUsage | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let raw = '';
      try {
        const result = await this.completeWithBackoff(
          provider,
          currentMessages,
          config,
          providerOptions,
        );
        raw = result.text;
        totalUsage = addUsage(totalUsage, result.usage);

        let parsed = extractJson(raw) as T;
        if (options.repair) parsed = options.repair(parsed) as T;
        parsed = normalizeAgainstSchema(parsed, schema);

        return {
          content: parsed,
          model: config.model,
          provider: config.provider,
          raw,
          usage: totalUsage,
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
        failedAttempts.push({
          raw,
          error: err instanceof Error ? err.message : String(err),
        });

        if (attempt < maxRetries) {
          // Extend the conversation with the bad output + correction request
          currentMessages = addCorrectionTurn(currentMessages, raw, err);
        }
      }
    }

    throw new AiSchemaError(
      `Failed to produce valid JSON after ${maxRetries + 1} attempt(s).`,
      lastError,
      failedAttempts,
      totalUsage,
    );
  }

  /**
   * Context window (tokens) of the provider credential, as configured in
   * settings. Null when unknown — callers should assume a large window.
   */
  async getContextSize(configId?: string): Promise<number | null> {
    try {
      const config = await this.getRuntimeConfig(configId);
      return config.contextSize ?? null;
    } catch {
      return null;
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Calls the provider, retrying rate limits (429) and connection blips with
   * increasing delays. Providers can be busy for minutes — slow is fine.
   */
  private async completeWithBackoff(
    provider: ReturnType<typeof createProvider>,
    messages: AiMessage[],
    config: AiProviderRuntimeConfig,
    options: AiCompletionOptions,
  ): Promise<AiProviderResult> {
    const retries = options.rateLimitRetries ?? 3;
    const delaysMs = [60_000, 120_000, 240_000];

    for (let attempt = 0; ; attempt++) {
      try {
        return await provider.complete(messages, config, options);
      } catch (err) {
        const retryable =
          err instanceof AiRateLimitError ||
          (err instanceof AiProviderError &&
            (err.statusCode === undefined ||
              // A no-body 404 from an OpenAI-compatible gateway is a transient
              // routing/cold-start miss (a genuine missing model surfaces as
              // AiModelNotFoundError, which is never retried). Give it the same
              // backoff as a 5xx rather than killing the run on first contact.
              err.statusCode === 404 ||
              err.statusCode === 429 ||
              err.statusCode >= 500));
        if (!retryable || attempt >= retries) throw err;
        // Incremental backoff with ±20% jitter so parallel agents don't
        // hammer an overloaded provider in lockstep.
        const base = delaysMs[Math.min(attempt, delaysMs.length - 1)];
        const delay = Math.round(base * (0.8 + Math.random() * 0.4));
        this.logger.warn(
          `Provider busy (${err instanceof Error ? err.message : String(err)}); ` +
            `retry ${attempt + 1}/${retries} in ${Math.round(delay / 1000)}s ` +
            `(incremental schedule ${delaysMs.map((d) => `${d / 1000}s`).join(' → ')})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async getRuntimeConfig(
    configId?: string,
  ): Promise<AiProviderRuntimeConfig> {
    const id =
      configId ?? (await this.providerConfigService.getDefaultConfigId());

    if (!id) {
      throw new AiConfigError(
        'No default AI provider selected. Choose one in Settings → AI Providers.',
      );
    }

    return this.providerConfigService.getRuntimeConfig(id);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sum two usage reports; null + null stays null (provider reports nothing). */
function addUsage(total: AiUsage | null, next: AiUsage | null): AiUsage | null {
  if (!next) return total;
  return {
    inputTokens: (total?.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (total?.outputTokens ?? 0) + next.outputTokens,
  };
}

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
