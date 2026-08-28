import { buildWaterfall } from './waterfall';

/**
 * The one property the pair screen rests on: the bars a reviewer reads must
 * add up to the score printed above them. If they ever do not, the screen is
 * asking someone to trust an explanation of a number that the explanation does
 * not produce.
 */
const WEIGHTS: Record<string, number> = {
  email: 5,
  person: 2,
  address: 3,
};
const weightOf = (label: string): number => WEIGHTS[label] ?? 1;

function profiles(
  aId: string,
  bId: string,
  labels: Record<string, [number, number]>,
) {
  const out: Array<{ assetId: string; label: string; nfCount: number }> = [];
  for (const [label, [a, b]] of Object.entries(labels)) {
    if (a > 0) out.push({ assetId: aId, label, nfCount: a });
    if (b > 0) out.push({ assetId: bId, label, nfCount: b });
  }
  return out;
}

const sum = (rows: Array<{ potential: number; penalty: number }>): number =>
  rows.reduce((acc, r) => acc + r.potential + r.penalty, 0);

describe('match-weight waterfall', () => {
  it('sums to the stored score when every label matches', () => {
    // Both assets: email + person. nfWeight 7 each, denom 14, all shared.
    const w = buildWaterfall({
      metadata: {
        denom: 14,
        weightedShared: 7,
        contribByLabel: { email: 5, person: 2 },
        sharedByLabel: { email: 1, person: 1 },
      },
      storedScore: 1,
      profiles: profiles('a', 'b', { email: [1, 1], person: [1, 1] }),
      aId: 'a',
      bId: 'b',
      weightOf,
    });

    expect(sum(w.rows)).toBeCloseTo(w.storedScore, 6);
    expect(w.total).toBeCloseTo(1, 6);
    expect(w.perfect).toBeCloseTo(1, 6);
    // Nothing failed to match, so there is no evidence against.
    expect(w.rows.every((r) => r.penalty === 0)).toBe(true);
  });

  it('turns a label that did not match into negative evidence inside the sum', () => {
    // Both hold an address; the addresses differ. nfWeight 10 each, denom 20.
    const w = buildWaterfall({
      metadata: {
        denom: 20,
        weightedShared: 7,
        contribByLabel: { email: 5, person: 2 },
        sharedByLabel: { email: 1, person: 1 },
      },
      storedScore: 0.7,
      profiles: profiles('a', 'b', {
        email: [1, 1],
        person: [1, 1],
        address: [1, 1],
      }),
      aId: 'a',
      bId: 'b',
      weightOf,
    });

    expect(sum(w.rows)).toBeCloseTo(0.7, 6);
    expect(w.perfect).toBeCloseTo(1, 6);

    const address = w.rows.find((r) => r.label === 'address')!;
    // It could have contributed 3*(1+1)/20 = 0.3 and contributed none of it.
    expect(address.potential).toBeCloseTo(0.3, 6);
    expect(address.actual).toBe(0);
    expect(address.penalty).toBeCloseTo(-0.3, 6);
  });

  it('never reports a positive penalty', () => {
    // Profiles stale: the scorer credited a label the profile says is absent.
    // A positive "penalty" would read as an objection that helped.
    const w = buildWaterfall({
      metadata: {
        denom: 10,
        weightedShared: 5,
        contribByLabel: { email: 5 },
        sharedByLabel: { email: 1 },
      },
      storedScore: 1,
      profiles: [],
      aId: 'a',
      bId: 'b',
      weightOf,
    });

    expect(w.rows.every((r) => r.penalty <= 0)).toBe(true);
    expect(sum(w.rows)).toBeCloseTo(w.storedScore, 6);
  });

  it('is correct for a phonetic pair, where sharedByLabel would not be', () => {
    // The phonetic pass scores with a sum of jaro-winkler similarities but
    // records a plain match COUNT in sharedByLabel. Rebuilding the bars from
    // that count would give 2*2*1/8 = 0.5 instead of the true 0.44 — wrong by
    // 13%, silently. Reading contribByLabel is what keeps this honest.
    const jwWeighted = 1.76; // 0.88 similarity * weight 2
    const w = buildWaterfall({
      metadata: {
        denom: 8,
        weightedShared: jwWeighted,
        contribByLabel: { person: jwWeighted },
        sharedByLabel: { person: 1 },
        phoneticOnly: true,
      },
      storedScore: 0.44,
      profiles: profiles('a', 'b', { person: [1, 1] }),
      aId: 'a',
      bId: 'b',
      weightOf,
    });

    expect(w.phonetic).toBe(true);
    expect(sum(w.rows)).toBeCloseTo(0.44, 6);

    const naive = (2 * weightOf('person') * 1) / 8;
    expect(naive).toBeCloseTo(0.5, 6);
    expect(w.total).not.toBeCloseTo(naive, 3);
  });

  it('draws nothing rather than a total that contradicts the headline', () => {
    // Edges written before the contribution metadata existed. Showing bars
    // that do not reach the score would be worse than showing none.
    const w = buildWaterfall({
      metadata: { sharedByLabel: { email: 1 } },
      storedScore: 0.62,
      profiles: profiles('a', 'b', { email: [1, 1] }),
      aId: 'a',
      bId: 'b',
      weightOf,
    });

    expect(w.rows).toEqual([]);
    expect(w.total).toBe(0.62);
    expect(w.perfect).toBe(0);
  });

  it('surfaces scorer/profile disagreement by moving the reference line', () => {
    // denom says 20, the profiles only account for 16. The bars still sum to
    // the score (the identity telescopes), but "perfect" is no longer 1 — the
    // discrepancy is visible instead of absorbed.
    const w = buildWaterfall({
      metadata: {
        denom: 20,
        weightedShared: 5,
        contribByLabel: { email: 5 },
        sharedByLabel: { email: 1 },
      },
      storedScore: 0.5,
      profiles: profiles('a', 'b', { email: [1, 1], person: [1, 1] }),
      aId: 'a',
      bId: 'b',
      weightOf,
    });

    expect(sum(w.rows)).toBeCloseTo(0.5, 6);
    expect(w.perfect).toBeLessThan(1);
  });

  it('reports a headline the bars actually add up to', () => {
    // The index stores a rounded copy of the score for ordering. If the pair
    // screen printed that copy, a score of 0.714286 would appear as 0.71 above
    // bars adding to 0.714 — small, wrong, and exactly the kind of discrepancy
    // that makes someone stop trusting the breakdown. So the reported score is
    // recomputed here rather than passed through.
    const w = buildWaterfall({
      metadata: {
        denom: 7,
        weightedShared: 2.5,
        contribByLabel: { email: 2.5 },
        sharedByLabel: { email: 1 },
      },
      storedScore: 0.71, // what the rounded index would have said
      profiles: profiles('a', 'b', { email: [1, 1], person: [1, 1] }),
      aId: 'a',
      bId: 'b',
      weightOf,
    });

    expect(w.total).toBeCloseTo(5 / 7, 10);
    expect(w.storedScore).toBe(w.total);
    expect(sum(w.rows)).toBeCloseTo(w.storedScore, 10);
    expect(w.storedScore).not.toBe(0.71);
  });
});
