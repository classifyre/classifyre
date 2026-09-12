import { Prisma } from '@prisma/client';
import { hubValuesCte } from './correlation.service';
import {
  BOILERPLATE_GROUP_BREADTH_CAP,
  BOILERPLATE_PAIR_CAP,
  BOILERPLATE_RANK_CAP,
  FANOUT_CAP,
} from './correlation.constants';

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

  /**
   * The review queue has two halves and they must agree about what is too
   * common to be evidence.
   *
   * The label half refuses hub values above FANOUT_CAP. The text half capped
   * pairs per group and pre-ranked entrants, but never asked whether a group
   * was too broad to mean anything — so a sentence appearing in every filing
   * in the register still produced review pairs.
   *
   * Measured on firmenbuch-test-2: 24 groups spanned 2,000+ assets and carried
   * 341,057 of 591,106 memberships. Excluding them leaves 250,049 — the groups
   * of two to five assets that are actually worth looking at.
   */
  describe('boilerplate breadth', () => {
    it('refuses a text group that spans the corpus', () => {
      // Both halves of the queue now have a "too common" rule, which is the
      // point. The exact numbers may diverge — the mechanisms differ — but a
      // breadth cap has to exist at all.
      expect(BOILERPLATE_GROUP_BREADTH_CAP).toBeGreaterThan(0);
      expect(Number.isFinite(BOILERPLATE_GROUP_BREADTH_CAP)).toBe(true);
    });

    it('stays above the per-group caps it sits behind', () => {
      // Breadth excludes whole groups; rank and pair caps bound what survives
      // inside one. A breadth cap below them would make those unreachable.
      expect(BOILERPLATE_GROUP_BREADTH_CAP).toBeGreaterThanOrEqual(
        BOILERPLATE_RANK_CAP,
      );
      expect(BOILERPLATE_RANK_CAP).toBeGreaterThan(BOILERPLATE_PAIR_CAP);
    });

    it('is loose enough to keep real duplicate clusters', () => {
      // A genuine duplicated document set is tens or hundreds of assets, not
      // thousands. Far below this and real duplicates start being discarded.
      expect(BOILERPLATE_GROUP_BREADTH_CAP).toBeGreaterThanOrEqual(500);
    });
  });
});
