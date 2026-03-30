/** No provider config stored yet or model/key missing. */
export class AiConfigError extends Error {
  readonly code = 'AI_CONFIG_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigError';
  }
}

/** Invalid or missing API key (HTTP 401 / 403). */
export class AiAuthError extends Error {
  readonly code = 'AI_AUTH_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AiAuthError';
  }
}

/** Provider rate limit hit (HTTP 429). */
export class AiRateLimitError extends Error {
  readonly code = 'AI_RATE_LIMIT_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AiRateLimitError';
  }
}

/** Requested model not found (HTTP 404). */
export class AiModelNotFoundError extends Error {
  readonly code = 'AI_MODEL_NOT_FOUND' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AiModelNotFoundError';
  }
}

/**
 * Structured-output parsing or schema validation failed after all retries.
 * `cause` contains the last parse/validation error.
 */
export class AiSchemaError extends Error {
  readonly code = 'AI_SCHEMA_ERROR' as const;
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiSchemaError';
  }
}

/** Generic provider-side error (5xx, unexpected response). */
export class AiProviderError extends Error {
  readonly code = 'AI_PROVIDER_ERROR' as const;
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export type AiError =
  | AiConfigError
  | AiAuthError
  | AiRateLimitError
  | AiModelNotFoundError
  | AiSchemaError
  | AiProviderError;
