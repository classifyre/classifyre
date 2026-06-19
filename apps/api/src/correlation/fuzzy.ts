/**
 * Thin wrapper around the `natural` NLP library.
 *
 * `natural` v8 includes a SentimentAnalyzer that requires `afinn-165`, which
 * ships as an ESM-only package. Importing the whole `natural` barrel therefore
 * breaks in a CJS runtime (NestJS / ts-node compiled output). We bypass that
 * by requiring only the three sub-modules we actually need — phonetics,
 * distance, and tokenizers — none of which touch the sentiment module.
 *
 * All consumers of fuzzy-matching primitives import from here so the messy
 * require is isolated to one place with a clear typed surface.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

interface IDoubleMetaphone {
  process(token: string): [string, string];
}
interface ITokenizer {
  tokenize(text: string): string[];
}
type JaroWinklerFn = (a: string, b: string) => number;

const phonetics = require('natural/lib/natural/phonetics');
const distance = require('natural/lib/natural/distance');
const tokenizers = require('natural/lib/natural/tokenizers');

const _dm: IDoubleMetaphone = new phonetics.DoubleMetaphone();
const _tok: ITokenizer = new tokenizers.AggressiveTokenizer();
const _jw: JaroWinklerFn = distance.JaroWinklerDistance;

/**
 * Tokenize a (pre-normalized) string into lowercase word tokens.
 * Uses AggressiveTokenizer which splits on non-word characters.
 * e.g. "John Smith" → ["john", "smith"]
 */
export function tokenize(text: string): string[] {
  return (_tok.tokenize(text) ?? []).map((t) => t.toLowerCase());
}

/**
 * DoubleMetaphone primary code for a single token.
 * Returns null for tokens that produce an empty code (e.g. pure numbers).
 * e.g. "smith" → "SM0"  "smyth" → "SM0"  "john" → "JN"  "jon" → "JN"
 */
export function metaphoneCode(token: string): string | null {
  const [primary] = _dm.process(token);
  return primary || null;
}

/**
 * Jaro-Winkler distance between two strings. Returns a value in [0, 1];
 * 1 = identical, 0 = completely different. Values ≥ 0.85 are considered
 * high-confidence fuzzy matches for names and short text fields.
 */
export function jaroWinkler(a: string, b: string): number {
  return _jw(a, b);
}
