import { Prisma } from '@prisma/client';

/**
 * Words-in-passages search over `asset_chunks.text`: the lexical half of a
 * hybrid asset search.
 *
 * A passage is found by the words it shares with the question, each weighted
 * by how rare it is in the workspace, so "24,483" or a company name outweighs
 * "which page shows". Nothing about the query has to occur whole in the
 * passage, which is what a question or a bare figure never does.
 */

/**
 * A figure is one word however it was typed or printed.
 *
 * A PDF converter spaces a number out ("10 ,114 . 8" for 10,114.8) and the
 * full-text parser reads "10,114.8" as two tokens — so a query for the figure
 * and the page that prints it share none. A separator between two digits is
 * dropped on both sides, text and question alike, and both read "101148".
 *
 * Kept to `.` and `,`: squeezing spaces as well would fuse neighbouring table
 * columns into one token. The passages are squeezed by the generated column
 * `asset_chunks.text_tsv` (see its migration, which must use this very pattern:
 * asserted in the spec); the question is squeezed here.
 */
export const FIGURE_SEPARATORS = String.raw`(\d)\s?[.,]\s?(?=\d)`;

/** `operand` (the question) with its figures squeezed. */
export function squeezedFigures(operand: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`regexp_replace(${operand}, ${FIGURE_SEPARATORS}::text, '\\1', 'g')`;
}

/** Terms of a question that are searched for; the rest of a long paste is ignored. */
export const MAX_QUERY_TERMS = 40;

/**
 * A word in more than this share of the workspace's passages says nothing
 * ("the", "year", a company's name on every page of its report) and is left out.
 */
export const COMMON_TERM_SHARE = 0.2;

/**
 * A word with a digit in it that is in no more than this share of passages (and
 * at least FIGURE_FLOOR of them) is a figure or an identifier rather than a
 * year. Years and dates are in every page header and fail this.
 */
export const FIGURE_SHARE = 0.005;
export const FIGURE_FLOOR = 20;

/** A search over passages may not hold the connection longer than this. */
export const LEXICAL_TIMEOUT_MS = 8000;

/** How much of the best passage is returned. Matches the semantic half. */
export const PASSAGE_CHARS = 600;

/** One asset, as found by the words of its passages. */
export interface LexicalChunkHit {
  id: string;
  /** Rarity-weighted words shared with the question, scaled by how close together they sit. Only orders hits. */
  score: number;
  page: number | null;
  text: string | null;
  /**
   * The passage carries every figure of the question — all of the numbers it
   * asked about, each in few passages of the workspace. That is an answer to
   * "which page shows 24,483?", not a topical neighbour.
   */
  exact: boolean;
}

/** Where in an asset the question matched best, and what found it. */
export interface AssetMatch {
  /** Similarity to the question (0-1); null for a passage found by its words alone. */
  score: number | null;
  page: number | null;
  text: string | null;
  via: 'meaning' | 'words';
}

/**
 * The passage to show for an asset found by meaning, by words, or both.
 *
 * Meaning picks the passage unless the words found something it cannot: the
 * asset has no semantic match at all, or one passage holds the exact figures of
 * the question. A semantic vector places "which page shows 24,483?" near any
 * balance sheet; the words know which page has that number.
 */
export function chooseMatch(
  meaning: Pick<AssetMatch, 'score' | 'page' | 'text'> | undefined,
  words: LexicalChunkHit | undefined,
): AssetMatch | undefined {
  if (words && (!meaning || words.exact)) {
    return {
      score: null,
      page: words.page,
      text: words.text,
      via: 'words',
    };
  }
  if (!meaning) return undefined;
  return { ...meaning, via: 'meaning' };
}
