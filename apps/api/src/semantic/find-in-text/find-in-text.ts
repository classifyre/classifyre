import { createHash } from 'node:crypto';

/**
 * "Find in text" (SL2 §7, D10): a term's labels as one REGEX alternation.
 *
 * Pure, so the pattern and its tests can be pinned without a database and run
 * through both regex engines the CLI may use.
 *
 * Word boundaries are an explicit character class, not `\b`: the REGEX runner
 * uses google-re2 when installed and Python's `re` otherwise, and RE2's `\b`
 * and `\w` are ASCII-only, so a label such as "Überschuldung" would never
 * match under it. The class below covers ASCII and the Latin-1 and Latin
 * Extended letters and behaves the same in both engines. Capture group 1 keeps
 * the boundary characters out of the finding's value.
 */

/** Letters and digits that continue a word (ASCII, Latin-1, Latin Extended-A/B). */
export const WORD_CHAR_CLASS = '0-9A-Za-z\\u00C0-\\u024F';
const WORD_CHAR_CLASS_PY = '0-9A-Za-zÀ-ɏ';

export interface LabelChoice {
  value: string;
  /** Codes match case-sensitively; terms and aliases case-insensitively. */
  type: 'term' | 'alias' | 'code';
  checked: boolean;
  /** Why a label is unchecked by default. */
  reason?: string;
}

export interface FindInTextOptions {
  wholeWords: boolean;
  continuations: boolean;
}

/** Escape a literal for both RE2 and Python's `re`. */
/** A label that starts or ends with a non-ASCII character. */
const NON_ASCII_EDGE = /^[^ -~]|[^ -~]$/u;

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Labels offered by default: term and aliases (≥ 3 chars checked), codes. */
export function defaultLabels(term: {
  term: string;
  aliases: string[];
  codes: string[];
  hiddenAliases: string[];
}): {
  labels: LabelChoice[];
  excluded: Array<{ value: string; reason: string }>;
} {
  const labels: LabelChoice[] = [];
  const seen = new Set<string>();
  const push = (value: string, type: LabelChoice['type']) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const identity =
      type === 'code' ? `c:${trimmed}` : `l:${trimmed.toLowerCase()}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const short = trimmed.length < 3;
    labels.push({
      value: trimmed,
      type,
      checked: !short,
      ...(short
        ? {
            reason:
              'Shorter than 3 characters: it would match inside too much text.',
          }
        : {}),
    });
  };
  push(term.term, 'term');
  for (const alias of term.aliases) push(alias, 'alias');
  for (const code of term.codes) push(code, 'code');
  return {
    labels,
    excluded: term.hiddenAliases.map((value) => ({
      value,
      reason: 'Hidden aliases are used by lookup, never matched in text.',
    })),
  };
}

/** Whether a label carries letters outside the boundary class (Greek, Cyrillic…). */
export function hasUnprotectedScript(value: string): boolean {
  return /[Ͱ-῿Ⰰ-￿]/.test(value);
}

/**
 * The pattern: `(?:^|[^W])((?i:a|b)|CODE)(?:[^W]|$)` with whole words, or
 * `((?i:a|b)|CODE)` without. Longer labels first so the alternation prefers
 * the longest label at a position.
 */
export function buildFindInTextPattern(
  labels: LabelChoice[],
  options: FindInTextOptions,
): string {
  const chosen = labels.filter((label) => label.checked);
  const byLength = (a: LabelChoice, b: LabelChoice) =>
    b.value.length - a.value.length;
  const insensitive = chosen
    .filter((l) => l.type !== 'code')
    .sort(byLength)
    .map((l) => escapeRegexLiteral(l.value));
  const codes = chosen
    .filter((l) => l.type === 'code')
    .sort(byLength)
    .map((l) => escapeRegexLiteral(l.value));
  if (!insensitive.length && !codes.length) {
    throw new Error('Choose at least one label to match');
  }
  const cont = options.continuations ? `[${WORD_CHAR_CLASS_PY}]*` : '';
  const parts: string[] = [];
  if (insensitive.length)
    parts.push(`(?i:(?:${insensitive.join('|')})${cont})`);
  parts.push(...codes);
  const core = `(${parts.join('|')})`;
  return options.wholeWords
    ? `(?:^|[^${WORD_CHAR_CLASS_PY}])${core}(?:[^${WORD_CHAR_CLASS_PY}]|$)`
    : core;
}

export interface GeneratedScenario {
  name: string;
  inputText: string;
  shouldMatch: boolean;
}

/** Test scenarios (SL2 §7.2): positives per label, boundary cases, negatives. */
export function buildFindInTextScenarios(
  labels: LabelChoice[],
  excludedHidden: string[],
  options: FindInTextOptions,
): GeneratedScenario[] {
  const chosen = labels.filter((label) => label.checked);
  const scenarios: GeneratedScenario[] = [];
  for (const label of chosen) {
    scenarios.push({
      name: `matches "${label.value}"`,
      inputText: `In the report, the ${label.value} was discussed at length.`,
      shouldMatch: true,
    });
  }
  const first = chosen[0];
  if (first) {
    scenarios.push({
      name: `matches "${first.value}" at the start of the text`,
      inputText: `${first.value} is mentioned first.`,
      shouldMatch: true,
    });
    scenarios.push({
      name: `matches "${first.value}" directly after punctuation`,
      inputText: `See below:(${first.value}) and more.`,
      shouldMatch: true,
    });
  }
  for (const label of chosen) {
    if (NON_ASCII_EDGE.test(label.value)) {
      scenarios.push({
        name: `matches "${label.value}" with a non-ASCII edge`,
        inputText: `Bericht: ${label.value} festgestellt.`,
        shouldMatch: true,
      });
    }
  }
  if (options.wholeWords) {
    for (const label of chosen.filter((l) => l.type === 'code')) {
      scenarios.push({
        name: `does not match "${label.value}" inside a longer token`,
        inputText: `The token X${label.value}X is not the code.`,
        shouldMatch: false,
      });
    }
  }
  for (const hidden of excludedHidden) {
    if (
      chosen.some((label) => label.value.toLowerCase() === hidden.toLowerCase())
    )
      continue;
    scenarios.push({
      name: `does not match the hidden alias "${hidden}"`,
      inputText: `Only the hidden alias ${hidden} appears here.`,
      shouldMatch: false,
    });
  }
  return scenarios;
}

/** Hash of the labels a detector was generated with ("out of date — regenerate"). */
export function labelsHash(
  labels: LabelChoice[],
  options: FindInTextOptions,
): string {
  const canonical = JSON.stringify({
    labels: labels
      .filter((l) => l.checked)
      .map((l) => `${l.type}:${l.value}`)
      .sort(),
    options,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/**
 * Hash of a term's matchable labels (term, aliases, codes). Stored on the
 * generated detector; when the term's labels change, the detector shows
 * "Out of date — regenerate".
 */
export function termLabelsHash(term: {
  term: string;
  aliases: string[];
  codes: string[];
}): string {
  const canonical = JSON.stringify([
    term.term.trim(),
    [...term.aliases].map((a) => a.trim().toLowerCase()).sort(),
    [...term.codes].map((c) => c.trim()).sort(),
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}
