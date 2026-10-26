import type { ExploreFindHitDto } from './explore.dto';

/**
 * Finding on the canvas: which of the assets already drawn answer a
 * question. Pure, so the ranking is tested without a database.
 */

/** Assets a find may look through: a canvas holds fewer. */
export const EXPLORE_FIND_LIMIT = 400;
/** Closest by meaning that are lit up, at most. */
const MEANING_LIT = 5;
/** Ranked by meaning that are listed, at most. */
const MEANING_LISTED = 30;

export interface FindInputs {
  /** Assets whose name holds the question. */
  named: string[];
  /** Assets with a passage that holds it, and that passage. */
  worded: Array<{ id: string; page: number | null; text: string | null }>;
  /** Every asset's best passage by meaning, and its score. */
  meant: Array<{
    id: string;
    score: number;
    page: number | null;
    text: string | null;
  }>;
}

/**
 * Name and words first: they are what the person typed. Then by meaning,
 * the closest first; the few that stand out from the canvas (well above the
 * middle score) are lit, the rest only listed. Scores are read against the
 * other assets on the canvas, because a model's raw scores mean nothing on
 * their own.
 */
export function rankFindHits(input: FindInputs): ExploreFindHitDto[] {
  const meaning = new Map(input.meant.map((m) => [m.id, m]));
  const hits = new Map<string, ExploreFindHitDto>();
  for (const id of input.named) {
    hits.set(id, {
      id,
      how: 'name',
      score: meaning.get(id)?.score ?? null,
      page: null,
      text: null,
      lit: true,
    });
  }
  for (const w of input.worded) {
    if (hits.has(w.id)) continue;
    hits.set(w.id, {
      id: w.id,
      how: 'words',
      score: meaning.get(w.id)?.score ?? null,
      page: w.page,
      text: w.text,
      lit: true,
    });
  }
  const byScore = [...input.meant].sort((a, b) => b.score - a.score);
  if (byScore.length) {
    const best = byScore[0].score;
    const middle = byScore[Math.floor(byScore.length / 2)].score;
    const bar = middle + 0.6 * (best - middle);
    byScore.slice(0, MEANING_LISTED).forEach((m, rank) => {
      if (hits.has(m.id)) return;
      hits.set(m.id, {
        id: m.id,
        how: 'meaning',
        score: m.score,
        page: m.page,
        text: m.text,
        // One asset alone stands out from nothing: it is the answer.
        lit: rank < MEANING_LIT && (byScore.length === 1 || m.score >= bar),
      });
    });
  }
  return [...hits.values()];
}
