/**
 * Shared derivations for the review queue.
 *
 * The cutoff arithmetic lives here rather than in a component because it is
 * the load-bearing idea of level 1: the server ships a histogram per pattern,
 * and moving a cutoff re-derives every number on the page from those arrays
 * without another request. Anything that needs a request on drag defeats it.
 */
import type { ReviewPatternDto } from "@workspace/api-client";

/**
 * The three lineage states, as the generated client spells them. Aliased once
 * so a filter passed between levels cannot drift into a bare string.
 */
export type LineageFilter = "PATH" | "NO_PATH" | "UNKNOWN";

export const BUCKET_COUNT = 20;

/** Pairs a reviewer settles per hour, for the rough workload estimate. */
const PAIRS_PER_HOUR = 60;

export interface Cutoffs {
  /** Below this, matches are treated as rejected. */
  review: number;
  /** At or above this, matches are strong enough not to need a person. */
  merge: number;
}

export const scoreForBucket = (bucket: number): number =>
  bucket / BUCKET_COUNT;

export const bucketForScore = (score: number): number =>
  Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor(score * BUCKET_COUNT)));

const sumRange = (buckets: number[], from: number, to: number): number => {
  let total = 0;
  for (let i = Math.max(0, from); i < Math.min(buckets.length, to); i++) {
    total += buckets[i] ?? 0;
  }
  return total;
};

export interface PatternBand {
  /** Pairs inside the review band. */
  inBand: number;
  /** Of those, how many are still undecided. */
  undecided: number;
  /**
   * Clusters touched by the band. An upper bound: a cluster can appear in more
   * than one bucket, so the bins cannot be added without double counting. The
   * UI labels it as an estimate rather than quietly presenting it as exact.
   */
  clustersInBand: number;
  /** Pairs settled per decision, if the whole band were decided by cluster. */
  leverage: number;
  /** Share of this pattern's pairs that lineage cannot explain. */
  escalateShare: number;
  /**
   * Ordering weight. Volume alone puts unfixable noise on top and score alone
   * puts the easiest work last, so this multiplies how much is left by how far
   * one decision reaches, and lifts patterns holding unexplained matches.
   */
  reviewValue: number;
}

export function patternBand(
  pattern: ReviewPatternDto,
  cutoffs: Cutoffs,
): PatternBand {
  const lo = bucketForScore(cutoffs.review);
  const hi = bucketForScore(cutoffs.merge);
  const inBand = sumRange(pattern.scoreBuckets, lo, hi);
  const decided = sumRange(pattern.decidedBuckets, lo, hi);
  const clustersInBand = sumRange(pattern.clusterBuckets, lo, hi);
  const undecided = Math.max(0, inBand - decided);
  const leverage = undecided / Math.max(1, clustersInBand);
  const escalateShare =
    pattern.lineageNoPathPairs / Math.max(1, pattern.pairCount);
  return {
    inBand,
    undecided,
    clustersInBand,
    leverage,
    escalateShare,
    reviewValue: undecided * leverage * (1 + 2 * escalateShare),
  };
}

export interface PortfolioBands {
  /** At or above the merge cutoff: strong enough not to need a person. */
  autoConfirmed: number;
  /** Between the cutoffs: the actual queue. */
  needsReview: number;
  /** Below the review cutoff: not worth looking at. */
  rejected: number;
  total: number;
  /** Undecided pairs inside the review band — the hero number. */
  workRemaining: number;
}

export function portfolioBands(
  patterns: ReviewPatternDto[],
  cutoffs: Cutoffs,
): PortfolioBands {
  const lo = bucketForScore(cutoffs.review);
  const hi = bucketForScore(cutoffs.merge);
  let autoConfirmed = 0;
  let needsReview = 0;
  let rejected = 0;
  let workRemaining = 0;
  for (const p of patterns) {
    rejected += sumRange(p.scoreBuckets, 0, lo);
    needsReview += sumRange(p.scoreBuckets, lo, hi);
    autoConfirmed += sumRange(p.scoreBuckets, hi, BUCKET_COUNT);
    workRemaining += patternBand(p, cutoffs).undecided;
  }
  return {
    autoConfirmed,
    needsReview,
    rejected,
    total: autoConfirmed + needsReview + rejected,
    workRemaining,
  };
}

/** Combined histogram across every pattern, for the level-1 distribution. */
export function combinedBuckets(patterns: ReviewPatternDto[]): number[] {
  const out = new Array<number>(BUCKET_COUNT).fill(0);
  for (const p of patterns) {
    p.scoreBuckets.forEach((v, i) => {
      out[i] = (out[i] ?? 0) + v;
    });
  }
  return out;
}

export const estimatedHours = (pairs: number): number =>
  Math.max(1, Math.round(pairs / PAIRS_PER_HOUR));

export const fmt = (n: number): string => n.toLocaleString();

export const pct = (n: number): string => `${Math.round(n * 100)}`;

/** Two decimals, tabular — scores are compared down a column. */
export const score2 = (n: number): string => n.toFixed(2);

// ── Pair ids in a URL ───────────────────────────────────────────────────────
//
// A pair is two asset ids. Encoding them as one path segment keeps the review
// screen a real page — /duplicates/pairs/<a>..<b> — with one dynamic segment,
// which is all the static export can recover from a hard load.

const PAIR_SEPARATOR = "..";

export const encodePairId = (aId: string, bId: string): string =>
  `${aId}${PAIR_SEPARATOR}${bId}`;

export function decodePairId(
  raw: string | null | undefined,
): { aId: string; bId: string } | null {
  if (!raw) return null;
  const [aId, bId] = decodeURIComponent(raw).split(PAIR_SEPARATOR);
  if (!aId || !bId) return null;
  return { aId, bId };
}

/** Pattern keys contain `+` and `:`, so they must be encoded into a path. */
export const encodePatternKey = (key: string): string =>
  encodeURIComponent(key);
