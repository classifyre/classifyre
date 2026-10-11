import { isCodeDetectorSchema } from './custom-detector-code';
import { isDecisionSchema } from './custom-detector-decision';

/**
 * The secrets bag some custom-detector engines carry in `pipelineSchema.secrets`:
 * a code detector's credentials (read with `ctx.secret(name)`) and a decision
 * detector's provider API key.
 *
 * The rules are the same whichever engine holds the bag, so they live here once:
 * values are encrypted at rest, never returned (a response carries their names
 * only), written as a patch, decrypted only into a dispatched run, and left out
 * of what decides a new detector version.
 */

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Whether this pipeline schema's engine keeps credentials in `secrets`. */
export function carriesSecrets(schema: unknown): boolean {
  return isCodeDetectorSchema(schema) || isDecisionSchema(schema);
}

/** The schema without its secrets, plus the names of the secrets it holds. */
export function maskDetectorSecrets(schema: JsonRecord): {
  schema: JsonRecord;
  secretKeys: string[];
} {
  if (!carriesSecrets(schema)) {
    return { schema, secretKeys: [] };
  }
  const { secrets, ...rest } = schema;
  return {
    schema: rest,
    secretKeys: isRecord(secrets) ? Object.keys(secrets).sort() : [],
  };
}

/**
 * Apply a secrets patch: a non-empty string sets a key, null or "" deletes it,
 * an absent key keeps what is stored. The editor never receives secret values,
 * so replacing the bag wholesale would wipe every credential it did not retype.
 */
export function mergeDetectorSecrets(
  existing: unknown,
  incoming: unknown,
  encrypt: (value: string) => string,
): Record<string, string> {
  const merged: Record<string, string> = isRecord(existing)
    ? Object.fromEntries(
        Object.entries(existing).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};
  if (!isRecord(incoming)) return merged;
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === '') {
      delete merged[key];
    } else if (typeof value === 'string') {
      merged[key] = encrypt(value);
    }
  }
  return merged;
}

/** What decides a new detector version: everything but the secrets. */
export function versionedShape(schema: unknown): unknown {
  if (!carriesSecrets(schema)) return schema;
  const { secrets: _secrets, ...rest } = schema as JsonRecord;
  return rest;
}
