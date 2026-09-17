/**
 * Safety rails for scan error text that gets stored and shown.
 *
 * A failed scan's logs travel three places people can read: the runner's
 * persisted log object, `Runner.errorMessage` / `errorDetails`, and
 * notifications. Drivers and notebooks echo credentials into those streams
 * (a connection string in a traceback, a notebook logging the endpoint
 * candidates it tried), so every write path below redacts credential-shaped
 * values and bounds the size before persisting.
 *
 * What the user still sees: the failure kind, the actionable head/tail of
 * the output, and an explicit marker wherever text was cut. What they never
 * see: `user:password@host` URLs, `Bearer` tokens, `password=` /
 * `api_key:` assignments, or unbounded multi-megabyte blobs.
 */

export const SECRET_PLACEHOLDER = '••••';

/** Stored `errorMessage`-class fields are sentences, not dumps. */
export const STORED_ERROR_MESSAGE_CHARS = 4000;

/** One embedded job-output string inside `errorDetails` keeps its tail. */
export const ERROR_DETAILS_OUTPUT_CHARS = 8000;

/** A single log line longer than this is cut (with a marker). */
export const STORED_LOG_LINE_CHARS = 16 * 1024;

const URL_CREDENTIALS_RE = /(:\/\/[^/\s:@?#]+:)([^@/\s?#]+)(@)/g;
const BEARER_RE = /\bbearer\s+[A-Za-z0-9\-._~+/=]+/gi;
const SENSITIVE_ASSIGNMENT_RE =
  /\b(password|passwd|pwd|secret|secrets|token|api[_-]?key|apikey|auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|credentials?)\b(\s*["']?\s*[:=]\s*["']?)([^"'\s,};\]]+)/gi;

/**
 * Hide credential-shaped substrings without knowing exact secret values.
 * Mirrors the CLI's `redact_generic` so both sides hide the same shapes.
 */
export function redactSecretsForStorage(text: string): string {
  if (!text) return text;
  return text
    .replace(URL_CREDENTIALS_RE, `$1${SECRET_PLACEHOLDER}$3`)
    .replace(BEARER_RE, `Bearer ${SECRET_PLACEHOLDER}`)
    .replace(
      SENSITIVE_ASSIGNMENT_RE,
      (match, key: string, sep: string, value: string) =>
        value === SECRET_PLACEHOLDER || value.includes('[REDACTED]')
          ? match
          : `${key}${sep}${SECRET_PLACEHOLDER}`,
    );
}

/**
 * Redact then bound an error sentence for a stored `errorMessage` column.
 * Redaction runs before truncation so a cut never leaves half a secret.
 */
export function sanitizeStoredErrorMessage(
  text: string,
  maxChars: number = STORED_ERROR_MESSAGE_CHARS,
): string {
  return redactSecretsForStorage(text).slice(0, maxChars);
}

/**
 * Redact exact known secret values (e.g. the source's own masked secrets,
 * decrypted). Longest first so a secret containing another still wins.
 * Values shorter than 4 chars are skipped: redacting "1" would blank every
 * digit in the output and hide the bug being diagnosed.
 */
export function redactWithSecrets(text: string, secrets: string[]): string {
  if (!text) return text;
  const values = [...new Set(secrets)]
    .filter((s) => typeof s === 'string' && s.trim().length >= 4)
    .sort((a, b) => b.length - a.length);
  if (values.length === 0) return text;
  const pattern = new RegExp(
    values.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g',
  );
  return text.replace(pattern, SECRET_PLACEHOLDER);
}

/**
 * Exact values first, credential shapes second.
 */
export function sanitizeWithSecrets(text: string, secrets: string[]): string {
  return redactSecretsForStorage(
    redactEncodedSecrets(redactWithSecrets(text, secrets), secrets),
  );
}

const B64_RUN_RE = /[A-Za-z0-9_+/-]{24,}={0,2}/g;
const ENCODED_SECRET_MIN_LENGTH = 8;

/**
 * Hide base64 blobs whose decoded form contains a known secret. Asset
 * hashes are reversible base64 over the connector's raw id, so an id built
 * from secrets leaks *encoded* -- invisible to plain substring matching.
 * Benign blobs decode clean (or to non-printable bytes) and pass through.
 */
export function redactEncodedSecrets(text: string, secrets: string[]): string {
  if (!text) return text;
  const values = [...new Set(secrets)].filter(
    (s) =>
      typeof s === 'string' && s.trim().length >= ENCODED_SECRET_MIN_LENGTH,
  );
  if (values.length === 0) return text;
  return text.replace(B64_RUN_RE, (run) => {
    const decoded = tryBase64DecodePrintable(run);
    if (decoded === null) return run;
    return values.some((secret) => decoded.includes(secret))
      ? SECRET_PLACEHOLDER
      : run;
  });
}

function tryBase64DecodePrintable(run: string): string | null {
  const padded = run + '='.repeat(((-run.length % 4) + 4) % 4);
  for (const normalized of [
    padded,
    padded.replace(/-/g, '+').replace(/_/g, '/'),
  ]) {
    try {
      const decoded = Buffer.from(normalized, 'base64').toString('utf8');

      if (/^[\x20-\x7E\t\n\r]*$/.test(decoded)) return decoded;
    } catch {
      // try the next normalization
    }
  }
  return null;
}

/**
 * Recursively redact every string inside an arbitrary JSON-shaped value.
 * Used for `errorDetails` and notification metadata, which are built from
 * driver/notebook text the API never controls.
 */
export function redactDeepStrings(value: unknown): unknown {
  return mapStrings(value, redactSecretsForStorage);
}

/** Deep-redact with exact secret values plus credential shapes. */
export function redactDeepWithSecrets(
  value: unknown,
  secrets: string[],
): unknown {
  return mapStrings(value, (text) => sanitizeWithSecrets(text, secrets));
}

function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = mapStrings(item, fn);
    }
    return out;
  }
  return value;
}

/**
 * Bound one long embedded string (the captured job output inside
 * `errorDetails`) keeping the tail: a failure's cause is at the end, and
 * the head is already summarized in `errorMessage`.
 */
export function boundDetailString(
  text: string,
  maxChars: number = ERROR_DETAILS_OUTPUT_CHARS,
): string {
  return tailBound(redactSecretsForStorage(text), maxChars);
}

/** Keep the tail of an over-long string with an explicit omission marker. */
export function tailBound(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return (
    `… [${omitted.toLocaleString()} chars of earlier output omitted] …\n` +
    text.slice(text.length - maxChars)
  );
}

/**
 * Tail-bound every over-long string inside error details. One unbounded
 * string (a full 4 MB job log) must not reach a JSONB column and the UI
 * that renders it.
 */
export function boundLongDetailStrings(
  value: unknown,
  maxChars: number = ERROR_DETAILS_OUTPUT_CHARS,
): unknown {
  return mapStrings(value, (text) => tailBound(text, maxChars));
}

/** Redact and bound a single log line before it is buffered or persisted. */
export function sanitizeStoredLogLine(
  message: string,
  maxLineChars: number = STORED_LOG_LINE_CHARS,
): string {
  const redacted = redactSecretsForStorage(message);
  if (redacted.length <= maxLineChars) return redacted;
  const omitted = redacted.length - maxLineChars;
  return (
    `${redacted.slice(0, maxLineChars)}… ` +
    `[line truncated, ${omitted.toLocaleString()} chars omitted]`
  );
}

/**
 * Split buffered entries into the head+tail window kept for persistence.
 * Returns the two slices and how many middle entries were omitted; the
 * caller inserts the marker entry so readers see the gap.
 */
export function splitPersistWindow<T>(
  entries: T[],
  headLines: number,
  tailLines: number,
): { head: T[]; tail: T[]; omitted: number } {
  const capacity = Math.max(0, headLines) + Math.max(0, tailLines);
  if (entries.length <= capacity) {
    return { head: entries, tail: [], omitted: 0 };
  }
  const head = entries.slice(0, Math.max(0, headLines));
  const tail = tailLines > 0 ? entries.slice(entries.length - tailLines) : [];
  return { head, tail, omitted: entries.length - head.length - tail.length };
}
