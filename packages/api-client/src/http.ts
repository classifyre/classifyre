/**
 * Retry policy shared by the generated client and the hand-written fetches.
 *
 * The API answers a momentarily unavailable database with `503` +
 * `Retry-After` (see `PrismaExceptionFilter`), and the desktop app's local API
 * can refuse connections outright for a second or two while it boots. Both used
 * to reach the UI as a hard "Failed to load …" on the overview pages, which
 * a single retry a few hundred milliseconds later would have avoided.
 */

/** Prisma codes the API reports when nothing was committed — always replayable. */
const TRANSIENT_DB_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "P2028",
  "P2034",
]);

/** Gateway/overload statuses that are worth a second attempt. */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 200;
const MAX_DELAY_MS = 2000;

export interface RetryPolicy {
  /** Total attempts including the first. Set to 1 to disable retrying. */
  attempts?: number;
  /** Treat this request as replayable regardless of method/path. */
  replayable?: boolean;
}

/** Exponential backoff with full jitter, so concurrent pages don't sync up. */
function backoffMs(retryNumber: number): number {
  const ceiling = Math.min(
    MAX_DELAY_MS,
    BASE_DELAY_MS * 2 ** (retryNumber - 1),
  );
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

/** `Retry-After: <seconds>`, clamped so a large value can't stall the UI. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_DELAY_MS);
}

function methodOf(init?: RequestInit): string {
  return (init?.method ?? "GET").toUpperCase();
}

/**
 * Whether re-sending this request is safe.
 *
 * Idempotent methods always are. `search/*` is POST only because the filters
 * don't fit in a query string, so it counts as a read. A streaming body cannot
 * be replayed at all.
 */
function isReplayable(url: string, init?: RequestInit): boolean {
  if (
    typeof ReadableStream !== "undefined" &&
    init?.body instanceof ReadableStream
  ) {
    return false;
  }
  const method = methodOf(init);
  if (method === "GET" || method === "HEAD" || method === "OPTIONS")
    return true;
  return method === "POST" && /\/search(\/|$)/.test(url.split("?")[0] ?? "");
}

/** Reads the error body without consuming the response the caller will get. */
async function transientDbCode(
  response: Response,
): Promise<string | undefined> {
  if (response.status !== 503) return undefined;
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    const code = typeof body?.code === "string" ? body.code : undefined;
    return code && TRANSIENT_DB_CODES.has(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * `fetch` that retries transient API failures with jittered backoff.
 *
 * Retries when the response is `502/503/504` or the request never reached the
 * server, but only for requests that are safe to replay — plus any `503`
 * carrying a transient Prisma code, since those guarantee the failed attempt
 * committed nothing. The final response (or error) is returned unchanged, so
 * callers keep their existing error handling.
 */
export async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  policy: RetryPolicy = {},
): Promise<Response> {
  const attempts = policy.attempts ?? MAX_ATTEMPTS;
  const url = typeof input === "string" ? input : input.toString();
  const replayable = policy.replayable ?? isReplayable(url, init);

  for (let attempt = 1; ; attempt++) {
    const isLastAttempt = attempt >= attempts;

    try {
      const response = await fetch(input, init);
      if (response.ok || isLastAttempt) return response;

      const dbCode = await transientDbCode(response);
      const retryable =
        dbCode !== undefined ||
        (replayable && RETRYABLE_STATUSES.has(response.status));
      if (!retryable) return response;

      await sleep(retryAfterMs(response) ?? backoffMs(attempt));
    } catch (error) {
      // Network-level failure: the request never completed, so replaying it is
      // safe for reads. Aborts are the caller's decision and never retried.
      if (isAbortError(error) || !replayable || isLastAttempt) throw error;
      await sleep(backoffMs(attempt));
    }
  }
}
