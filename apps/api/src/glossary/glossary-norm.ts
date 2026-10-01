/**
 * The value normaliser and key rules of the semantic layer.
 *
 * `glossaryNorm` is the TypeScript half of the SQL function `glossary_norm`
 * created by migration 20261001120000_glossary_model. The binding compiler
 * evaluates the same binding in SQL (linker, filters, previews) and in memory
 * (Meaning cards, watches), and the two halves only agree because they
 * normalise identically: NFKC, internal whitespace collapsed, trimmed,
 * lower-cased. Change one and you must change the other — the conformance spec
 * runs both against the same fixtures.
 */

/** Contract C8: a term or scheme key. */
export const TERM_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;

/** URN prefix for a term reference (C8). */
export const TERM_URN_PREFIX = 'term://glossary/';

/** At most this many previous keys are remembered per term (SL1 R2). */
export const MAX_PREVIOUS_KEYS = 20;

/** Base length a generated key is trimmed to, leaving room for `-<n>`. */
const KEY_BASE_MAX = 94;

const GERMAN: Array<[RegExp, string]> = [
  [/ä/g, 'ae'],
  [/ö/g, 'oe'],
  [/ü/g, 'ue'],
  [/Ä/g, 'Ae'],
  [/Ö/g, 'Oe'],
  [/Ü/g, 'Ue'],
  [/ß/g, 'ss'],
];

export function glossaryNorm(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The normalised forms lookup and lookup bindings match on: term, aliases,
 * codes and hidden aliases (SL1 R7). Proposed aliases are deliberately absent.
 */
export function matchKeysFor(term: {
  term: string;
  aliases?: string[];
  codes?: string[];
  hiddenAliases?: string[];
}): string[] {
  const keys = new Set<string>();
  for (const value of [
    term.term,
    ...(term.aliases ?? []),
    ...(term.codes ?? []),
    ...(term.hiddenAliases ?? []),
  ]) {
    const normalized = glossaryNorm(value);
    if (normalized) keys.add(normalized);
  }
  return [...keys];
}

/**
 * The slug a key is generated from (SL1 R2): German letters transliterated,
 * other diacritics folded to ASCII, lower-cased, runs of anything else become
 * `-`. The migration backfill implements the same rule in SQL.
 */
export function keyBase(name: string): string {
  let value = name;
  for (const [pattern, replacement] of GERMAN) {
    value = value.replace(pattern, replacement);
  }
  value = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/ø/g, 'o')
    .replace(/Ø/g, 'O')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, KEY_BASE_MAX)
    .replace(/^-+|-+$/g, '');
  return value || 'term';
}

/**
 * A free key for `name`: the slug, or the slug with `-2`, `-3`, … when it is
 * taken. `isTaken` must consider both current and previous keys, because keys
 * are never reused (a reference to an old key must keep resolving).
 */
export async function generateKey(
  name: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = keyBase(name);
  if (!(await isTaken(base))) return base;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(`Could not find a free key for "${name}"`);
}

export function isValidKey(key: string): boolean {
  return TERM_KEY_PATTERN.test(key);
}

/** `term://glossary/<key>` (C8). */
export function termUrn(key: string): string {
  return `${TERM_URN_PREFIX}${key}`;
}

/** The key a `term://glossary/<key>` URN names, or null. */
export function keyFromTermUrn(urn: string): string | null {
  const lowered = urn.trim().toLowerCase();
  if (!lowered.startsWith(TERM_URN_PREFIX)) return null;
  const key = lowered.slice(TERM_URN_PREFIX.length).replace(/\/+$/, '');
  return isValidKey(key) ? key : null;
}

/**
 * How an alias should be filed, when it looks like it belongs elsewhere
 * (SL1 R8): a single character is a hidden alias (`E`, `K`), and up to 16
 * characters of uppercase letters, digits and `_ . / -` or a space is a code
 * (`GES`, `PKS 725000`, `HGB_224_3_A`). Suggested in the editor, never moved
 * automatically.
 */
export function suggestLabelKind(
  alias: string,
): 'hiddenAlias' | 'code' | null {
  const value = alias.trim();
  if (value.length === 1) return 'hiddenAlias';
  if (
    value.length <= 16 &&
    /[A-Z0-9]/.test(value) &&
    /^[A-Z0-9_./\- ]+$/.test(value) &&
    /[A-Z]/.test(value)
  ) {
    return 'code';
  }
  if (value.length <= 16 && /^[0-9][0-9_./\- ]*$/.test(value)) return 'code';
  return null;
}

/** Trimmed, de-duplicated (case-insensitively unless `caseSensitive`), capped. */
export function cleanLabels(
  values: string[] | undefined,
  options: { caseSensitive?: boolean; max?: number } = {},
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = raw.trim();
    if (!value) continue;
    const identity = options.caseSensitive ? value : value.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(value);
  }
  return out.slice(0, options.max ?? 50);
}
