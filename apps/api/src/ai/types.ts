export type AiRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  role: AiRole;
  content: string;
}

/** A plain JSON Schema object used to describe a structured output shape. */
export type JsonSchema = Record<string, unknown>;

export interface AiCompletionOptions {
  /** Sampling temperature (0–1). Default: 0.3. */
  temperature?: number;
  /** Max tokens to generate. Provider default when omitted. */
  maxTokens?: number;
  /**
   * Max retry attempts when completeJson fails to produce valid JSON.
   * Default: 2 (3 total attempts).
   */
  maxRetries?: number;
  /**
   * Target a specific AI provider credential by id. When omitted, the
   * instance-wide default selected in Settings is used.
   */
  configId?: string;
  /**
   * JSON Schema the response must match. Providers that support native
   * structured output (OpenAI-compatible response_format) enforce it
   * server-side; others fall back to the prompt hint + validation loop.
   */
  jsonSchema?: JsonSchema;
  /**
   * Optional repair hook run after JSON extraction and before validation —
   * fixes known model shape quirks (e.g. singular keys, nested arrays).
   */
  repair?: (value: unknown) => unknown;
  /**
   * Retries on provider rate limiting / connection blips, with increasing
   * delays. Default: 3 (delays 60s/120s/240s). Set 0 to fail fast.
   */
  rateLimitRetries?: number;
}

/** Token consumption reported by the provider for one or more requests. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiResponse<T = string> {
  content: T;
  model: string;
  provider: AiProviderType;
  /** Raw provider output the content was parsed from (set by completeJson). */
  raw?: string;
  /**
   * Total token consumption across every provider request made to produce
   * this response (including failed JSON attempts that were retried).
   * Null when the provider did not report usage.
   */
  usage: AiUsage | null;
}

export type AiProviderType = 'OPENAI_COMPATIBLE' | 'CLAUDE' | 'GEMINI';

/** Runtime config derived from DB + decrypted key. */
export interface AiProviderRuntimeConfig {
  provider: AiProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
  contextSize?: number | null;
  supportsVision: boolean;
}

/** One provider request's result: the raw text plus reported token usage. */
export interface AiProviderResult {
  text: string;
  /** Null when the provider response carried no usage metadata. */
  usage: AiUsage | null;
}

/** Internal interface every provider must implement. */
export interface IAiProvider {
  /**
   * Generate a text completion. Returns the raw string from the provider
   * plus its reported token usage. Throws typed AiError subclasses on failure.
   */
  complete(
    messages: AiMessage[],
    config: AiProviderRuntimeConfig,
    options: AiCompletionOptions,
  ): Promise<AiProviderResult>;
}
