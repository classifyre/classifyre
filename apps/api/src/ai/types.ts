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
}

export interface AiResponse<T = string> {
  content: T;
  model: string;
  provider: AiProviderType;
}

export type AiProviderType = 'OPENAI_COMPATIBLE' | 'CLAUDE' | 'GEMINI';

/** Runtime config derived from DB + decrypted key. */
export interface AiProviderRuntimeConfig {
  provider: AiProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
}

/** Internal interface every provider must implement. */
export interface IAiProvider {
  /**
   * Generate a text completion. Returns the raw string from the provider.
   * Throws typed AiError subclasses on failure.
   */
  complete(
    messages: AiMessage[],
    config: AiProviderRuntimeConfig,
    options: AiCompletionOptions,
  ): Promise<string>;
}
