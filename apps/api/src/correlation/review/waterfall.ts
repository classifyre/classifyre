import type {
  ReviewWaterfallDto,
  ReviewWaterfallRowDto,
} from '../../dto/correlation-review.dto';

/**
 * The match-weight decomposition.
 *
 *   potential P_L = w_L * (countA_L + countB_L) / D    (what could have matched)
 *   actual    A_L = 2 * contribByLabel[L] / D          (what did)
 *   penalty   N_L = A_L - P_L                          (never positive)
 *
 * The sum telescopes: SUM(P_L + N_L) = SUM(A_L) = the stored score. That
 * identity holds whatever the label profiles say, which matters because the
 * profiles are refreshed separately from the scorer — so the bars always add
 * up to the number above them even if the two drifted.
 *
 * SUM(P_L) is 1 when they agree, and is drawn as a reference line: the score
 * is the fraction of available weight that actually matched. When it is not
 * 1, the profiles and the scorer disagree and the line moves visibly rather
 * than the discrepancy being absorbed silently.
 *
 * A label present on one side only contributes a positive potential bar and
 * an equal negative penalty — that is the evidence against, and it sits
 * inside the sum rather than hidden in a blend.
 *
 * `contribByLabel` is read rather than recomputed from `sharedByLabel`
 * because the phonetic pass stores a fuzzy-match COUNT there while scoring
 * with a sum of jaro-winkler similarities; multiplying that count by the
 * label weight overstates the pair by up to 25%.
 */
export function buildWaterfall(input: {
  metadata: Record<string, unknown>;
  storedScore: number;
  profiles: Array<{ assetId: string; label: string; nfCount: number }>;
  aId: string;
  bId: string;
  weightOf: (label: string) => number;
}): ReviewWaterfallDto {
  const { metadata, storedScore, profiles, aId, bId, weightOf } = input;
  const contrib = (metadata.contribByLabel ?? {}) as Record<string, number>;
  const shared = (metadata.sharedByLabel ?? {}) as Record<string, number>;
  const denomRaw = Number(metadata.denom);
  const phonetic = metadata.phoneticOnly === true;

  const countFor = (assetId: string, label: string): number =>
    profiles.find((p) => p.assetId === assetId && p.label === label)
      ?.nfCount ?? 0;

  const labels = new Set<string>([
    ...Object.keys(contrib),
    ...profiles.map((p) => p.label),
  ]);

  // Without a usable denominator there is no honest decomposition to draw.
  // Edges written before this metadata existed fall here until the next
  // recompute; showing a total that does not match the headline would be
  // worse than showing none.
  if (!Number.isFinite(denomRaw) || denomRaw <= 0) {
    return {
      rows: [],
      total: storedScore,
      perfect: 0,
      storedScore,
      phonetic,
    };
  }

  const rows: ReviewWaterfallRowDto[] = [];
  let total = 0;
  let perfect = 0;

  for (const label of labels) {
    const weight = weightOf(label);
    const aCount = countFor(aId, label);
    const bCount = countFor(bId, label);
    let potential = (weight * (aCount + bCount)) / denomRaw;
    const actual = (2 * (Number(contrib[label]) || 0)) / denomRaw;
    // Guard the one direction the arithmetic cannot justify: if the scorer
    // credited more than the profiles say was available, the profiles are
    // stale, and a positive "penalty" would read as evidence against that
    // somehow helped.
    if (actual > potential) potential = actual;
    const penalty = actual - potential;
    if (potential === 0 && actual === 0) continue;

    rows.push({
      label,
      potential,
      actual,
      penalty,
      sharedCount: Number(shared[label]) || 0,
      aCount,
      bCount,
      weight,
    });
    total += actual;
    perfect += potential;
  }

  // Strongest evidence first, then the heaviest objections.
  rows.sort((x, y) => y.actual - x.actual || x.penalty - y.penalty);
  // `storedScore` reports the exact total once a decomposition exists: the
  // caller shows it as the headline, and a headline the bars do not add up to
  // is the one thing this screen must never do. The rounded copy in the index
  // is for ordering, not for display.
  return { rows, total, perfect, storedScore: total, phonetic };
}
