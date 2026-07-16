import { scorePair } from './correlation.service';
import { valueHash } from './value-normalizer';

/**
 * G-016 reproduction attempt.
 *
 * The first-use protocol reported correlation "inflating shared-value counts"
 * and producing impossible duplicate scores — a 45.46 / "4546%" match between
 * two PDFs, and 3,808 shared Bates numbers when only 427 Bates findings existed
 * globally. Its hypothesis was that correlation re-indexes each finding's
 * embedded `pipeline_result.entities`, counting a page's entities once per
 * finding emitted from that page.
 *
 * That hypothesis does not hold against this code:
 *
 *  - `rebuildAssetValues` selects five scalar columns and never reads
 *    `metadata`, so the embedded pipeline_result is not an input to scoring.
 *  - It dedupes into a Map keyed by valueHash, and `asset_correlation_values`
 *    carries `@@unique([assetId, valueHash])`, so a value cannot be indexed
 *    twice for one asset.
 *  - `scorePair` is weighted Dice — 2·shared / (totalA + totalB) — whose
 *    numerator is a subset sum of its denominator's terms.
 *
 * These tests pin the bound the reported score violates. They are the evidence
 * for closing G-016 against this build rather than a fix: if a score above 1
 * is ever reachable here, they fail and the report is reproduced.
 */
function tok(label: string, value: string) {
  return { valueHash: valueHash(label, value), label, normalizedValue: value };
}

describe('scorePair score bounds (G-016)', () => {
  it('never exceeds 1 even when both assets are identical', () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      tok('bates_number', `EFTA000${i}`),
    );

    const s = scorePair(rows, [...rows]);

    expect(s.weighted).toBeLessThanOrEqual(1);
    expect(s.jaccard).toBeLessThanOrEqual(1);
    // The reported 45.46 would surface here as a weighted far above 1.
    expect(s.weighted).toBeCloseTo(1, 5);
  });

  it('never counts more shared values than either asset holds', () => {
    // The reported shape: 3,808 shared Bates numbers against a global total of
    // 427. sharedCount is bounded by the smaller asset's value count.
    const shared = Array.from({ length: 20 }, (_, i) =>
      tok('bates_number', `EFTA${i}`),
    );
    const a = [...shared, tok('person', 'jeffrey epstein')];
    const b = [...shared, tok('person', 'ghislaine maxwell')];

    const s = scorePair(a, b);

    expect(s.sharedCount).toBe(20);
    expect(s.sharedCount).toBeLessThanOrEqual(Math.min(a.length, b.length));
    expect(s.sharedByLabel.bates_number).toBe(20);
  });

  it('ignores duplicate rows for the same value rather than double-counting', () => {
    // The DB's unique(assetId, valueHash) makes this unreachable in practice.
    // Asserted anyway: it is the exact inflation the report describes, so the
    // scorer must not depend on the constraint to stay correct.
    const dup = tok('bates_number', 'EFTA00008744');
    const a = [dup, dup, dup, dup];
    const b = [dup];

    const s = scorePair(a, b);

    expect(s.sharedCount).toBe(1);
    expect(s.weighted).toBeLessThanOrEqual(1);
  });

  it('stays bounded across lopsided asset sizes', () => {
    const shared = tok('email', 'x@y.com');
    const a = [
      shared,
      ...Array.from({ length: 500 }, (_, i) => tok('date', `d${i}`)),
    ];
    const b = [shared];

    const s = scorePair(a, b);

    expect(s.weighted).toBeGreaterThan(0);
    expect(s.weighted).toBeLessThanOrEqual(1);
    expect(s.jaccard).toBeLessThanOrEqual(1);
  });

  it('stays bounded for every label in the weight table', () => {
    // A heavy label (credit_card, weight 6) against a light one (country, 1)
    // is the widest weight spread the table allows.
    const heavy = Array.from({ length: 10 }, (_, i) =>
      tok('credit_card', `4111111111111${i}`),
    );
    const light = Array.from({ length: 10 }, (_, i) => tok('country', `c${i}`));

    for (const rows of [heavy, light, [...heavy, ...light]]) {
      const s = scorePair(rows, [...rows]);
      expect(s.weighted).toBeLessThanOrEqual(1);
    }
  });

  it('reports exact only when both value sets match entirely', () => {
    const a = [tok('email', 'a@x.com'), tok('phone', '+431')];
    const b = [tok('email', 'a@x.com')];

    expect(scorePair(a, [...a]).exact).toBe(true);
    // A subset must not read as an exact duplicate — that is what drove the
    // thin-evidence "100%" clusters the protocol flagged as leads-only.
    expect(scorePair(a, b).exact).toBe(false);
  });

  it('is symmetric', () => {
    const a = [tok('email', 'a@x.com'), tok('date', '2005-01-01')];
    const b = [tok('email', 'a@x.com'), tok('person', 'jane doe')];

    expect(scorePair(a, b).weighted).toBeCloseTo(scorePair(b, a).weighted, 10);
  });
});
