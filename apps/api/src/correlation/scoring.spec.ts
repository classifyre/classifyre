import { scorePair } from './correlation.service';
import { valueHash } from './value-normalizer';

/** Build a ValueRow-shaped token for a (label, value) pair. */
function tok(label: string, value: string) {
  return { valueHash: valueHash(label, value), label, normalizedValue: value };
}

describe('scorePair', () => {
  it('returns zero score for disjoint assets', () => {
    const a = [tok('email', 'a@x.com')];
    const b = [tok('email', 'b@x.com')];
    const s = scorePair(a, b);
    expect(s.sharedCount).toBe(0);
    expect(s.weighted).toBe(0);
    expect(s.jaccard).toBe(0);
    expect(s.exact).toBe(false);
  });

  it('scores identical assets as a perfect, exact match', () => {
    const rows = [tok('email', 'a@x.com'), tok('phone', '+431')];
    const s = scorePair(rows, [...rows]);
    expect(s.weighted).toBeCloseTo(1, 5);
    expect(s.jaccard).toBeCloseTo(1, 5);
    expect(s.exact).toBe(true);
    expect(s.sharedByLabel).toEqual({ email: 1, phone: 1 });
  });

  it('weights identifier labels more heavily (Dice)', () => {
    // A and B share one email (weight 5); each also has a unique country (1).
    const a = [tok('email', 'shared@x.com'), tok('country', 'at')];
    const b = [tok('email', 'shared@x.com'), tok('country', 'de')];
    const s = scorePair(a, b);
    // weightedShared = 5; totals = 6 + 6 = 12 → 2*5/12
    expect(s.weighted).toBeCloseTo((2 * 5) / 12, 5);
    // jaccard = 1 shared / 3 union
    expect(s.jaccard).toBeCloseTo(1 / 3, 5);
    expect(s.exact).toBe(false);
    expect(s.sharedByLabel).toEqual({ email: 1 });
  });

  it('counts shared tokens per label', () => {
    const a = [
      tok('email', 'a@x.com'),
      tok('email', 'b@x.com'),
      tok('phone', '+1'),
    ];
    const b = [tok('email', 'a@x.com'), tok('email', 'b@x.com')];
    const s = scorePair(a, b);
    expect(s.sharedCount).toBe(2);
    expect(s.sharedByLabel).toEqual({ email: 2 });
    // Not exact: A has an extra phone.
    expect(s.exact).toBe(false);
  });

  it('handles empty assets without dividing by zero', () => {
    expect(scorePair([], []).weighted).toBe(0);
    expect(scorePair([tok('email', 'a@x.com')], []).weighted).toBe(0);
  });

  it('honors a custom weight function (DB-backed tuning)', () => {
    const a = [tok('email', 'shared@x.com'), tok('country', 'at')];
    const b = [tok('email', 'shared@x.com'), tok('country', 'de')];
    const weightOf = () => 10; // every label weighted equally
    const s = scorePair(a, b, weightOf);
    // weightedShared = 10 (one email); totals = 20 + 20 → 2*10/40 = 0.5
    expect(s.weighted).toBeCloseTo(0.5, 5);
  });
});
