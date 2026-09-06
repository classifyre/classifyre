import {
  ENCRYPTED_CONFIG_PATHS,
  MASKED_CONFIG_ENCRYPTED_PREFIX,
} from '../utils/masked-config.utils';
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
    if (isPlainObject(config)) {
      let next = { ...config };
      for (const path of ENCRYPTED_CONFIG_PATHS) {
        const strippedPath = stripEncryptedPath(next, path);
        if (strippedPath) {
          next = strippedPath.config;
          stripped.push(strippedPath.stripped);
          if (strippedPath.expected.length > 0) {
            next = { ...next, [strippedPath.keysField]: strippedPath.expected };
          }
        }
      }
      cleaned['config'] = next;
    }
  }

  return { row: cleaned, stripped };
}

/**
 * Remove one encrypted path from an export-bound source config.
 *
 * `masked` goes wholesale (it is nothing but credentials); `augmentation`
 * keeps everything except its `secrets` — the notebook, variables and limits
 * are configuration, not credentials, and the import must see them. Either
 * way the secret *names* are kept alongside (`maskedKeys`,
 * `augmentationSecretKeys`) so the import can name them in its "re-enter
 * these" warning without ever having carried a value. Returns null when the
 * path is absent, so sources without augmentation gain no new keys.
 */
function stripEncryptedPath(
  config: Record<string, unknown>,
  path: string,
): {
  config: Record<string, unknown>;
  stripped: string;
  expected: string[];
  keysField: string;
} | null {
  const segments = path.split('.');
  if (segments.length === 1) {
    const [key] = segments;
    if (!Object.hasOwn(config, key)) return null;
    const { [key]: removed, ...rest } = config;
    return {
      config: rest,
      stripped: `config.${path}`,
      expected: isPlainObject(removed) ? Object.keys(removed) : [],
      keysField: 'maskedKeys',
    };
  }
  const [head, ...tail] = segments;
  const holder = config[head];
  if (!isPlainObject(holder)) return null;
  const leaf = tail[tail.length - 1];
  let node: Record<string, unknown> = holder;
  for (const segment of tail.slice(0, -1)) {
    const next = node[segment];
    if (!isPlainObject(next)) return null;
    node = next;
  }
  if (!Object.hasOwn(node, leaf)) return null;
  const nodeCopy: Record<string, unknown> = { ...node };
  const removed = nodeCopy[leaf];
  delete nodeCopy[leaf];
  // Rebuild the chain so only the leaf is dropped and siblings survive.
  let rebuilt: unknown = nodeCopy;
  for (let index = tail.length - 2; index >= 0; index--) {
    const parent = (
      index === 0
        ? { ...holder }
        : { ...(getNested(holder, tail.slice(0, index)) ?? {}) }
    ) as Record<string, unknown>;
    parent[tail[index]] = rebuilt;
    rebuilt = parent;
  }
  return {
    config: { ...config, [head]: rebuilt },
    stripped: `config.${path}`,
    expected: isPlainObject(removed) ? Object.keys(removed) : [],
    keysField: 'augmentationSecretKeys',
  };
}

function getNested(
  root: Record<string, unknown>,
  segments: string[],
): Record<string, unknown> | null {
  let node: unknown = root;
  for (const segment of segments) {
    if (!isPlainObject(node)) return null;
    node = node[segment];
  }
  return isPlainObject(node) ? node : null;
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
