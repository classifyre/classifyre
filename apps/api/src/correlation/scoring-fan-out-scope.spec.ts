import { Prisma } from '@prisma/client';
import { hubValuesCte } from './correlation.service';
import { FANOUT_CAP } from './correlation.constants';

/**
 * The fan-out cap must mean the same thing on an incremental scan as on a full
 * recompute.
 *
 * Both the staging aggregate and `loadAssetTotals` used to count how many
 * assets held a value *within their own working set*. On a full recompute that
 * set is the corpus, so the cap worked. On an incremental scan it is a handful
 * of touched assets, so a value held by 84,034 assets corpus-wide showed fifty
 * owners, sailed under the cap, and produced pairs joined on "is an active
 * company".
 *
 * Measured on firmenbuch-test-2 before the fix: 22 hub values spanning 333,622
 * rows were admissible incrementally and excluded by a full recompute. The
 * accumulated difference was 4.05M scored pairs against 574,419 — a review
 * queue that was 86% non-evidence, roughly 6 GB of storage, and a portfolio
 * endpoint at 122s instead of 3.8s.
 *
 * These tests pin the property that prevents that: the hub decision is taken
 * over the whole table, never over a scope.
 */
describe('scoring fan-out scope', () => {
  const sqlOf = (fragment: Prisma.Sql) => fragment.strings.join('?');

  it('decides hubs over the whole table, with no asset scope', () => {
    const sql = sqlOf(hubValuesCte());

    expect(sql).toContain('FROM asset_correlation_values');
    expect(sql).toContain('GROUP BY value_hash');
    // The bug in one assertion: any narrowing here makes the cap mean
    // something different on an incremental scan than on a full recompute.
    expect(sql).not.toMatch(/asset_id/i);
    expect(sql).not.toMatch(/\bWHERE\b/i);
  });

  it('compares owner count against the scoring cap', () => {
    const fragment = hubValuesCte();

    expect(sqlOf(fragment)).toMatch(/HAVING\s+COUNT\(\*\)\s*>/i);
    // Parameterised, not inlined — and it is the scoring cap, not the much
    // smaller graph-display fan-out.
    expect(fragment.values).toContain(FANOUT_CAP);
  });

  it('keeps the cap high enough to be about hubs, not ordinary sharing', () => {
    // A value held by a few thousand assets is a category, not an identifier.
    // Far below this and real identifiers start being discarded.
    expect(FANOUT_CAP).toBeGreaterThanOrEqual(500);
  });
});
