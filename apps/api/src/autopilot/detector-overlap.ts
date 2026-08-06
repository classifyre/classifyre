/**
 * Duplicate detection for authored detectors.
 *
 * `inquiries.create` refuses a near-duplicate and points at `inquiries.enrich`;
 * `detector.create` had no equivalent, and it shows. On a live instance the
 * detector-authoring agent produced ten custom detectors in under three hours,
 * seven of them the same idea re-approached from a slightly different angle:
 *
 *   diplomatic_cable_references        spaced_classification_markings
 *   classified_network_references      sensitive_but_unclassified_marker
 *   intel_handling_caveats             intelligence_reporting_references
 *   intel_dissemination_caveats
 *
 * Every cycle it invented a new detector for the theme instead of sharpening
 * the one it wrote last cycle. It also created `phone_number_detector` on a
 * source where the built-in PII `PHONE_NUMBER` pattern was already enabled — so
 * the corpus got scanned twice for the same thing.
 *
 * Two independent checks, because they catch different mistakes: what the agent
 * has already built, and what the product already does out of the box.
 */

/** Overlap above which two detectors are treated as the same detector. */
export const DETECTOR_DUPLICATE_OVERLAP = 0.6;

/**
 * How many authored detectors may sit unproven — active, wired in, and having
 * produced no findings — before authoring another is refused.
 *
 * Name similarity alone cannot catch this family: `diplomatic_cable_references`
 * and `intelligence_reporting_references` are the same instinct expressed with
 * no shared words. What they DO have in common is that neither had produced a
 * single finding when the next one was written. The authoring mission already
 * says "verify pending detectors before authoring anything new"; this is that
 * rule in code. Three, not one, because a detector needs a re-scan to prove
 * itself and several can legitimately be in flight at once.
 */
export const MAX_UNPROVEN_DETECTORS = 3;

/**
 * Built-in PII pattern names mapped to the words an authored detector would use
 * for the same concept. Deliberately narrow: only patterns whose meaning is
 * unambiguous from a name, so a genuinely novel detector is never blocked by a
 * loose word match.
 */
const BUILT_IN_PATTERN_WORDS: Record<string, string[]> = {
  EMAIL_ADDRESS: ['email', 'emails', 'mail'],
  PHONE_NUMBER: ['phone', 'telephone', 'mobile', 'msisdn'],
  IP_ADDRESS: ['ip', 'ipv4', 'ipv6'],
  CREDIT_CARD: ['credit', 'card', 'pan'],
  IBAN_CODE: ['iban'],
  CRYPTO: ['crypto', 'bitcoin', 'wallet'],
  US_SSN: ['ssn', 'social'],
  MEDICAL_LICENSE: ['medical', 'license'],
  URL: ['url', 'link'],
};

/** Words that identify nothing on their own and would match everything. */
const STOP_WORDS = new Set([
  'detector',
  'detect',
  'detection',
  'custom',
  'new',
  'the',
  'and',
  'for',
  'of',
  'in',
  'on',
  'a',
  'an',
  'ref',
  'refs',
  'reference',
  'references',
  'marker',
  'markers',
  'marking',
  'markings',
  'pattern',
  'patterns',
  'content',
  'text',
  'data',
  'value',
  'values',
]);

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function shared(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

function jaccard(a: string[], b: string[]): number {
  const x = new Set(a);
  const y = new Set(b);
  if (x.size === 0 || y.size === 0) return 0;
  const n = shared(x, y);
  return n / (x.size + y.size - n);
}

/**
 * Dice coefficient, used for NAMES specifically.
 *
 * Detector names differ by a qualifier far more often than by subject:
 * `intel_handling_caveats` and `intel_dissemination_caveats` were written four
 * minutes apart about the same thing and share two of three tokens. Jaccard
 * scores that 0.5 — below any threshold that also keeps `phone_number_detector`
 * apart from `passport_number_detector` (0.33). Dice separates them cleanly:
 * 0.67 against 0.5.
 */
function dice(a: string[], b: string[]): number {
  const x = new Set(a);
  const y = new Set(b);
  if (x.size === 0 || y.size === 0) return 0;
  return (2 * shared(x, y)) / (x.size + y.size);
}

/** Every regex literal anywhere inside a pipeline schema. */
export function extractPatterns(schema: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (
        typeof value === 'string' &&
        /^(pattern|regex|expression)$/i.test(key)
      ) {
        found.push(value);
      } else {
        walk(value);
      }
    }
  };
  walk(schema);
  return found;
}

export interface DetectorLike {
  id?: string;
  key: string;
  name: string;
  description?: string | null;
  pipelineSchema?: unknown;
}

/**
 * How alike two detectors are: the stronger of their naming overlap and their
 * literal-pattern overlap.
 *
 * Identical regexes under different names are the same detector, and so are
 * two differently-written regexes aimed at the same clearly-named concept —
 * `intel_handling_caveats` and `intel_dissemination_caveats` share "intel" and
 * "caveats" and were written four minutes apart.
 */
export function detectorSimilarity(a: DetectorLike, b: DetectorLike): number {
  const patterns = jaccard(
    extractPatterns(a.pipelineSchema),
    extractPatterns(b.pipelineSchema),
  );
  const naming = dice(
    tokenize(`${a.key} ${a.name}`),
    tokenize(`${b.key} ${b.name}`),
  );
  return Math.max(patterns, naming);
}

/**
 * The built-in pattern, if any, that already covers what this detector is for.
 * `enabledPatterns` is what is switched on for the source right now, so a
 * detector duplicating a pattern the operator disabled on purpose still passes.
 */
export function coveredByBuiltIn(
  proposal: DetectorLike,
  enabledPatterns: string[],
): string | null {
  const words = new Set(tokenize(`${proposal.key} ${proposal.name}`));
  if (words.size === 0) return null;
  for (const pattern of enabledPatterns) {
    const synonyms = BUILT_IN_PATTERN_WORDS[pattern];
    if (!synonyms) continue;
    if (synonyms.some((s) => words.has(s))) return pattern;
  }
  return null;
}
