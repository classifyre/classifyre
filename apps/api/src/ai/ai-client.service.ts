import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import providerRefusalMarkers from '@workspace/schemas/provider_refusal_markers';
import { AiProviderConfigService } from '../ai-provider-config.service';
import type { AiSchemaAttempt } from './errors';
import {
  AiAuthError,
  AiConfigError,
  AiModelNotFoundError,
  AiProviderError,
  AiQuotaExhaustedError,
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

/**
 * Wording that turns a 429 from "slow down" into "the allowance is gone". One
 * list in packages/schemas, shared with the CLI's LLM detector runner, so a
 * scan and an agent agree on when retrying cannot help.
 */
const QUOTA_MARKERS: readonly string[] = (providerRefusalMarkers.quota ?? [])
  .map((marker) => String(marker).trim().toLowerCase())
  .filter((marker) => marker.length > 0);

const DEFAULT_QUOTA_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * How long a credential is left alone after its quota runs out. Short enough
 * that a reset is noticed within the quarter hour, long enough that a backlog
 * of agent jobs does not re-ask the provider once per job. Jittered ±10% so
 * a fleet of API replicas does not re-ask the provider in lockstep.
 */
function quotaCooldownMs(): number {
  const seconds = Number(process.env.AI_QUOTA_COOLDOWN_SECONDS);
  const base =
    Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : DEFAULT_QUOTA_COOLDOWN_MS;
  return Math.round(base * (0.9 + Math.random() * 0.2));
}

/**
 * Billing-exhaustion signals, checked before the generic marker scan with
 * word-boundary anchors. Mirrors the head of the shared quota list in
 * provider_refusal_markers.json.
 */
const BILLING_EXHAUSTED_PATTERNS: readonly RegExp[] = [
  /(?<![a-z0-9_])insufficient_credit(?![a-z0-9_])/,
  /(?<![a-z0-9_])insufficient balance(?![a-z0-9_])/,
  /(?<![a-z0-9_])out of credits(?![a-z0-9_])/,
];

/** Whether a provider error is a spent quota rather than a busy provider. */
export function isQuotaExhausted(err: unknown): boolean {
  // Already classified upstream (e.g. an HTTP 402 mapped to
  // AiQuotaExhaustedError by a provider): the decision was made, only the
  // local cooldown refusal is left.
  if (err instanceof AiQuotaExhaustedError) return true;
  if (!(err instanceof AiRateLimitError) && !(err instanceof AiProviderError)) {
    return false;
  }
  const text = err.message.toLowerCase();
  // Anchored billing-exhaustion markers first: a spent balance is quota
  // gone whatever status carried it.
  if (BILLING_EXHAUSTED_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  // HTTP 402 is "payment required": the allowance is gone, never a blip.
  if (err instanceof AiProviderError && err.statusCode === 402) return true;
  const rateLimited =
    err instanceof AiRateLimitError ||
    (err instanceof AiProviderError && err.statusCode === 429);
  if (!rateLimited) return false;
  return QUOTA_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Incremental backoff between rate-limit retries: 60 → 120 → 240 s. One call
 * can therefore hold a global worker slot for 7 minutes while every other
 * background job waits behind it.
 */
const BACKOFF_SCHEDULE_MS = [60_000, 120_000, 240_000];
const DEFAULT_BACKOFF_BUDGET_MS = BACKOFF_SCHEDULE_MS.reduce(
  (a, b) => a + b,
  0,
);

/**
 * Cap on the total backoff one call may hold a worker slot, in ms.
 * `AI_RATE_LIMIT_BACKOFF_BUDGET_MS` lowers it; the 60/120/240 shape is kept
 * and scaled to fit under the cap.
 */
function backoffBudgetMs(): number {
  const raw = Number(process.env.AI_RATE_LIMIT_BACKOFF_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BACKOFF_BUDGET_MS;
}

/** The backoff schedule scaled to fit the total-hold budget, shape kept. */
export function backoffDelaysMs(): number[] {
  const budget = backoffBudgetMs();
  if (budget >= DEFAULT_BACKOFF_BUDGET_MS) return [...BACKOFF_SCHEDULE_MS];
  return BACKOFF_SCHEDULE_MS.map((step) =>
    Math.max(1_000, Math.round((step / DEFAULT_BACKOFF_BUDGET_MS) * budget)),
  );
}

const JSON_SYSTEM_HINT =
  'You MUST respond with valid JSON only — no explanation, no markdown fences, no extra text.';

@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  /**
   * Credentials left alone after their quota ran out. Per-process only: each
   * API replica keeps its own map, so a fresh deploy or a second replica may
   * still spend one call learning the quota is gone.
   */
  private readonly quotaCooldowns = new Map<
    string,
    { until: number; message: string }
  >();

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
    // Scaled to the total-hold budget: one call never keeps a worker slot
    // past it, however many retries the schedule holds.
    const delaysMs = backoffDelaysMs();
    const credential = this.credentialKey(config);

    const cooldown = this.quotaCooldowns.get(credential);
    if (cooldown !== undefined) {
      if (Date.now() < cooldown.until) {
        throw new AiQuotaExhaustedError(
          `AI provider quota exhausted for this credential (${cooldown.message}); ` +
            `not calling it again until ${new Date(cooldown.until).toISOString()}.`,
          new Date(cooldown.until),
        );
      }
      this.quotaCooldowns.delete(credential);
    }

    for (let attempt = 0; ; attempt++) {
      try {
        return await provider.complete(messages, config, options);
      } catch (err) {
        // A spent quota is the one 429 that retrying cannot fix. Retrying it
        // was 60 + 120 + 240 s per call, each held on one of the few global
        // worker slots while every other background job waited behind it.
        if (isQuotaExhausted(err)) {
          const retryAfter = new Date(Date.now() + quotaCooldownMs());
          const message = err instanceof Error ? err.message : String(err);
          this.quotaCooldowns.set(credential, {
            until: retryAfter.getTime(),
            message,
          });
          this.logger.warn(
            `Provider quota exhausted (${message}); not retrying, and no ` +
              `further calls on this credential until ${retryAfter.toISOString()}.`,
          );
          throw new AiQuotaExhaustedError(message, retryAfter);
        }
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

  /** Which quota a call spends: the credential, never the raw key itself. */
  private credentialKey(config: AiProviderRuntimeConfig): string {
    const keyDigest = createHash('sha256')
      .update(config.apiKey ?? '')
      .digest('hex')
      .slice(0, 16);
    return `${config.provider}|${config.baseUrl ?? ''}|${keyDigest}`;
  }

  private async getRuntimeConfig(
    configId?: string,
  ): Promise<AiProviderRuntimeConfig> {
    const id =
      configId ?? (await this.providerConfigService.getDefaultConfigId());

    if (!id) {
      throw new AiConfigError(
        'No Assistant AI provider selected. Assign one in Harness AI → Configuration.',
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
    cachedInputTokens:
      (total?.cachedInputTokens ?? 0) + (next.cachedInputTokens ?? 0),
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
