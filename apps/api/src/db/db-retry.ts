import { Logger } from '@nestjs/common';
import { transientDbErrorCode } from './transient-db-error';

const logger = new Logger('DbRetry');

export interface DbRetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Delay before the first retry; doubles each attempt. */
  baseDelayMs?: number;
  /** Upper bound for a single backoff step. */
  maxDelayMs?: number;
  /** Label used in the warning log line. */
  label?: string;
}

const DEFAULT_ATTEMPTS = Number(process.env.DB_RETRY_ATTEMPTS ?? 3);
const DEFAULT_BASE_DELAY_MS = Number(process.env.DB_RETRY_BASE_DELAY_MS ?? 120);
const DEFAULT_MAX_DELAY_MS = Number(process.env.DB_RETRY_MAX_DELAY_MS ?? 1500);

/**
 * Exponential backoff with full jitter.
 *
 * Jitter matters here because pool starvation hits every concurrent request at
 * once — retrying them all on the same schedule just recreates the pile-up.
 */
export function dbRetryDelayMs(
  retryNumber: number,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (retryNumber - 1));
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

/**
 * Run `operation`, retrying it while it fails with a transient database error
 * (pool starvation, transaction start timeout, deadlock, connection drop).
 *
 * Only safe for operations that are idempotent as a whole — every transient
 * code we retry on guarantees the failed attempt committed nothing, but a
 * multi-step operation may already have committed *earlier* steps. Read paths
 * and single-transaction writes qualify; multi-transaction writes do not.
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: DbRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const label = options.label ?? 'operation';

  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = transientDbErrorCode(error);
      if (!code || attempt >= attempts) throw error;

      const delay = dbRetryDelayMs(
        attempt,
        options.baseDelayMs,
        options.maxDelayMs,
      );
      logger.warn(
        `Transient database error [${code}] on ${label}; retrying in ${delay}ms (attempt ${attempt + 1}/${attempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
