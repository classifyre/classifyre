import { MASKED_CONFIG_ENCRYPTED_PREFIX } from '../utils/masked-config.utils';
import type { TransferTableSpec } from './transfer-scopes';

/**
 * Nothing that can authenticate against a third party may leave the instance in
 * an archive. Two independent mechanisms enforce that, because a single list is
 * one forgotten `@map` away from leaking:
 *
 *  1. Declared removal — {@link TransferTableSpec.redact} names the credential
 *     columns per table, and `config.masked` (where every source connector
 *     stores its secrets) is dropped wholesale.
 *  2. A guard — {@link assertNoSecrets} then walks the redacted row and throws
 *     if any string still looks like a stored credential. It fails the export
 *     rather than writing the row, so a model that grows a new secret column
 *     breaks loudly here instead of shipping the secret.
 *
 * Both run on every exported row. The guard is cheap next to the gzip and the
 * database read, and the asymmetry is the point: a false positive costs a
 * failed export, a false negative costs a leaked credential.
 */

/**
 * Column-name shapes that hold credentials by convention in this schema.
 *
 * Matched only against a row's own scalar columns, never inside JSON. Source
 * and detector configuration is schema-driven and full of innocent names like
 * `secrets` (a detector) or `api_key` (a finding label); the credentials in
 * those blobs live under `config.masked`, which is removed wholesale above.
 */
const SECRET_COLUMN_RE =
  /(token|secret|password|passwd|apikey|credential|privatekey)/i;

/** Columns matching {@link SECRET_COLUMN_RE} that are provably not secrets. */
const SECRET_COLUMN_ALLOWLIST = new Set([
  // Telegram's getUpdates offset on ChatBot — a message cursor, not a token.
  'telegramLastUpdateId',
]);

export interface RedactionResult {
  row: Record<string, unknown>;
  /** Column paths dropped from this row, e.g. `apiKeyEnc`, `config.masked`. */
  stripped: string[];
}

/**
 * Strip a row's credentials ahead of writing it to an archive. Returns the
 * cleaned row plus the paths that were removed, so the export can tell the
 * operator exactly what the target instance will have to be given again.
 */
export function redactRow(
  spec: TransferTableSpec,
  row: Record<string, unknown>,
): RedactionResult {
  const cleaned: Record<string, unknown> = { ...row };
  const stripped: string[] = [];

  // Not credentials, so not reported — just columns that belong to the instance
  // the data came from rather than to the data.
  for (const column of spec.omit ?? []) delete cleaned[column];

  for (const column of spec.redact ?? []) {
    if (cleaned[column] === undefined || cleaned[column] === null) continue;
    delete cleaned[column];
    stripped.push(column);
  }

  if (spec.redactMaskedConfig) {
    const config = cleaned['config'];
    if (isPlainObject(config) && Object.hasOwn(config, 'masked')) {
      const { masked, ...rest } = config;
      // Keep a record of which credential fields the source expects, so the
      // import can name them in its "re-enter these" warning without ever
      // having carried a value.
      const expected = isPlainObject(masked) ? Object.keys(masked) : [];
      cleaned['config'] =
        expected.length > 0 ? { ...rest, maskedKeys: expected } : rest;
      stripped.push('config.masked');
    }
  }

  return { row: cleaned, stripped };
}

/**
 * Throw if a redacted row still carries something credential-shaped.
 *
 * Two checks, deliberately different in reach:
 *
 *  - Structural, everywhere including nested JSON: an AES-GCM envelope written
 *    by MaskedConfigCryptoService. Every secret this system stores is wrapped
 *    that way, so this is the check that actually guarantees the property.
 *  - Nominal, top-level columns only: a column named like a credential holding
 *    a non-empty string. Catches a newly added `apiKey`/`botToken` column that
 *    nobody added to a redact list — including one stored in plaintext, which
 *    the structural check would miss.
 */
export function assertNoSecrets(
  model: string,
  row: Record<string, unknown>,
): void {
  for (const [column, value] of Object.entries(row)) {
    if (
      typeof value === 'string' &&
      value.length > 0 &&
      !SECRET_COLUMN_ALLOWLIST.has(column) &&
      SECRET_COLUMN_RE.test(column)
    ) {
      throw refusal(model, column);
    }
  }

  const encrypted = findEncrypted(row, '');
  if (encrypted) throw refusal(model, encrypted);
}

function refusal(model: string, path: string): Error {
  return new Error(
    `Refusing to export ${model}: '${path}' looks like a stored credential. ` +
      `Add it to that table's redact list in transfer-scopes.ts before exporting this model.`,
  );
}

function findEncrypted(value: unknown, path: string): string | null {
  if (typeof value === 'string') {
    return value.startsWith(MASKED_CONFIG_ENCRYPTED_PREFIX)
      ? path || '<root>'
      : null;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const hit = findEncrypted(item, `${path}[${index}]`);
      if (hit) return hit;
    }
    return null;
  }

  if (!isPlainObject(value)) return null;

  for (const [key, nested] of Object.entries(value)) {
    const hit = findEncrypted(nested, path ? `${path}.${key}` : key);
    if (hit) return hit;
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
