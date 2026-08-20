/**
 * Pure logic behind the key/value editor.
 *
 * Kept out of the component so it can be tested directly, and because the
 * secret-patch rule below is the kind of thing that deserves to be readable on
 * its own rather than buried in a form.
 */

/**
 * Keys are read from the notebook by name -- `ctx.var("api_base")` -- so a key
 * that is not a Python identifier is unreachable from the code that needs it.
 * The same pattern is enforced by the JSON schema and by the API; this copy is
 * the one that can say so before the user hits save.
 */
export const CONFIG_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export interface KeyValueEntry {
  key: string;
  value: string;
  /** A secret that exists but whose value the client was never sent. */
  existing?: boolean;
}

export type KeyProblem = "empty" | "invalid" | "duplicate";

export function validateKey(key: string, allKeys: string[]): KeyProblem | null {
  if (!key.trim()) return "empty";
  if (!CONFIG_KEY_PATTERN.test(key)) return "invalid";
  if (allKeys.filter((other) => other === key).length > 1) return "duplicate";
  return null;
}

export function keyValueEntriesAreValid(entries: KeyValueEntry[]): boolean {
  const keys = entries.map((entry) => entry.key);
  return entries.every((entry) => validateKey(entry.key, keys) === null);
}

export function entriesToRecord(
  entries: KeyValueEntry[],
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.key.trim()) record[entry.key] = entry.value;
  }
  return record;
}

export function recordToEntries(
  record: Record<string, string> | undefined,
): KeyValueEntry[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));
}

/**
 * Secret names become entries whose value is deliberately blank: the server
 * never sends the values, and a blank one is left alone on save.
 */
export function secretKeysToEntries(
  keys: string[] | undefined,
): KeyValueEntry[] {
  return (keys ?? []).map((key) => ({ key, value: "", existing: true }));
}

/**
 * Only the secrets the user actually touched, plus deletions.
 *
 * A full replacement would wipe every stored credential, because the editor was
 * never given them to send back — so an untouched entry is omitted rather than
 * saved as the blank the form is holding.
 */
export function secretEntriesToPatch(
  entries: KeyValueEntry[],
  originalKeys: string[],
): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  const present = new Set<string>();

  for (const entry of entries) {
    if (!entry.key.trim()) continue;
    present.add(entry.key);
    if (!entry.existing && entry.value !== "") {
      patch[entry.key] = entry.value;
    }
  }
  for (const key of originalKeys) {
    if (!present.has(key)) patch[key] = null;
  }
  return patch;
}
