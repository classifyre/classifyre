import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
} from '@prisma/client/runtime/client';

/**
 * Prisma error codes that mean "nothing was committed, try again".
 *
 * P1001 — can't reach the database server (network blip, checkpoint I/O stall,
 *         a Postgres pod restart, or the desktop Postgres still booting).
 * P1002 — server reached but the connection timed out.
 * P1008 — operation timed out.
 * P1017 — server closed the connection (idle reaper, failover, restart).
 * P2024 — timed out fetching a connection from the pool (pool starvation).
 * P2028 — transaction API error: `maxWait` elapsed before a connection was
 *         free, or the transaction itself timed out. Either way it rolled back.
 * P2034 — write conflict / deadlock; the transaction rolled back.
 *
 * Every one of these leaves the database untouched, which is what makes an
 * automatic retry safe even for writes.
 */
export const TRANSIENT_PRISMA_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2028',
  'P2034',
]);

/**
 * Driver-level failures that never get a Prisma code because they come from the
 * `pg` pool / socket rather than the query engine. With driver adapters these
 * surface as `PrismaClientUnknownRequestError` (or a bare `Error` from the
 * pool), so they have to be matched on message.
 */
const TRANSIENT_DRIVER_MESSAGES = [
  'connection terminated',
  'connection ended unexpectedly',
  'timeout exceeded when trying to connect',
  'server closed the connection unexpectedly',
  'terminating connection due to administrator command',
  'the database system is starting up',
  'too many clients already',
  'econnreset',
  'econnrefused',
  'etimedout',
  'epipe',
  'ehostunreach',
  'enetunreach',
];

/** `true` when the pool/socket error text marks a retryable condition. */
function hasTransientDriverMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return TRANSIENT_DRIVER_MESSAGES.some((marker) =>
    normalized.includes(marker),
  );
}

/**
 * Classify an error thrown by any Prisma call.
 *
 * Returns the Prisma code to report (e.g. `P2028`) when the failure is a
 * transient database condition the caller may retry, or `undefined` when it is
 * a genuine error (bad query, constraint violation, application bug).
 *
 * Unwraps `cause` chains so an error rethrown by a service still classifies.
 */
export function transientDbErrorCode(
  error: unknown,
  depth = 0,
): string | undefined {
  if (!error || depth > 4) return undefined;

  if (error instanceof PrismaClientKnownRequestError) {
    return TRANSIENT_PRISMA_CODES.has(error.code) ? error.code : undefined;
  }

  if (error instanceof PrismaClientInitializationError) {
    const code = error.errorCode ?? 'P1001';
    if (TRANSIENT_PRISMA_CODES.has(code)) return code;
    // Initialization failures are, by definition, "we never got to the query" —
    // treat an unrecognized one as a connectivity problem rather than a 500.
    return hasTransientDriverMessage(error.message) ? code : undefined;
  }

  if (error instanceof PrismaClientUnknownRequestError) {
    return hasTransientDriverMessage(error.message) ? 'P1001' : undefined;
  }

  if (error instanceof Error) {
    if (hasTransientDriverMessage(error.message)) return 'P1001';
    return transientDbErrorCode(
      (error as { cause?: unknown }).cause,
      depth + 1,
    );
  }

  return undefined;
}

/** Convenience predicate for `transientDbErrorCode`. */
export function isTransientDbError(error: unknown): boolean {
  return transientDbErrorCode(error) !== undefined;
}
