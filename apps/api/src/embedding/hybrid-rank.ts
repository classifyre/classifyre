/** The constant of reciprocal rank fusion: rank r in a list is worth 1 / (RRF_K + r). */
export const RRF_K = 60;

/** One list's verdict on an asset, best first. */
export interface RankedHit {
  id: string;
  /**
   * Found by a picture or a sound clip rather than by text: the asset has
   * nothing a word search could have matched.
   */
  media?: boolean;
}

/**
 * Hybrid order for assets: what the meaning search found, fused with what the
 * words of the question found in passages and in names.
 *
 * Reciprocal rank fusion adds one term for every list an asset is ranked in,
 * so an asset found by both halves beats one found by a single half at a
 * better rank. That is the point of hybrid search for text, and it is wrong
 * for a picture: a photograph of a stained ceiling cannot be in the word list
 * at all, not because the words missed it but because it has no words. On
 * the whole-drive workspace the photograph Gemini Embedding 2 put first for
 * "water coming through the bedroom ceiling" fell out of the first twelve
 * results, behind every passage that shared a word with the question.
 *
 * So an asset that the meaning search found through a picture or a clip, and
 * that the word search did not find, is counted in the word list at the rank
 * it holds in the meaning list. It then competes as an equal: ahead of a
 * passage that only the meaning search found lower down, behind one that both
 * halves put near the top.
 */
export function fuseHybridRanks(
  meaning: readonly RankedHit[],
  passages: readonly RankedHit[],
  names: readonly RankedHit[],
): Array<[string, number]> {
  const fused = new Map<string, number>();
  const add = (id: string, rank: number) =>
    fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
  const byWords = new Set(passages.map((hit) => hit.id));
  meaning.forEach((hit, rank) => {
    add(hit.id, rank);
    if (hit.media && !byWords.has(hit.id)) add(hit.id, rank);
  });
  passages.forEach((hit, rank) => add(hit.id, rank));
  names.forEach((hit, rank) => add(hit.id, rank));
  return [...fused.entries()].sort((left, right) => right[1] - left[1]);
}
