import { CorrelationReviewService } from './correlation-review.service';

/**
 * A pair has no direction, so exactly one of (a,b) and (b,a) may be stored.
 *
 * The scorer writes an edge in whatever order its self-join produced, so
 * `from_id`/`to_id` are not sorted. Every reader canonicalises — it has to,
 * because a caller can name the two assets either way round — so a row stored
 * unsorted is a row no reader can find. That produced two failures from one
 * cause: the pair 404'd from the list it appeared in, and a verdict (keyed
 * canonically) never matched its signature, so a decided pair came back to be
 * decided again.
 *
 * refreshReviewIndex now stores LEAST/GREATEST. These pin the reader half.
 */
describe('pair identity is canonical', () => {
  const service = Object.create(
    CorrelationReviewService.prototype,
  ) as CorrelationReviewService;

  const canonical = (a: string, b: string) =>
    (
      service as unknown as {
        canonical: (a: string, b: string) => { aId: string; bId: string };
      }
    ).canonical(a, b);

  it('orders a pair the same way whichever side is named first', () => {
    expect(canonical('a', 'b')).toEqual({ aId: 'a', bId: 'b' });
    expect(canonical('b', 'a')).toEqual({ aId: 'a', bId: 'b' });
  });

  it('agrees with the SQL ordering the index writes', () => {
    // LEAST/GREATEST use byte order, and so does JS `<=` on these ids.
    const ids = [
      [
        '55524e69-6857-4b13-baf9-745d34273796',
        '2e5d3ab6-7bdd-40c0-b22a-5366e7f883de',
      ],
      [
        '0d73318b-24cf-4eb3-a234-c299ef376f67',
        '1bcdf8e6-dcba-4a0c-82a1-d8f1640513fc',
      ],
      ['zzz', 'aaa'],
    ];
    for (const [x, y] of ids) {
      const sqlOrder = { aId: x < y ? x : y, bId: x < y ? y : x };
      expect(canonical(x, y)).toEqual(sqlOrder);
      expect(canonical(y, x)).toEqual(sqlOrder);
    }
  });

  it('normalises a list of pairs, and dedupes the two spellings of one pair', () => {
    const clean = (
      service as unknown as {
        cleanPairs: (input: unknown) => Array<{ aId: string; bId: string }>;
      }
    ).cleanPairs([
      { aId: 'b', bId: 'a' },
      { aId: 'a', bId: 'b' },
      { aId: 'x', bId: 'x' }, // an asset is not a duplicate of itself
      { aId: 'c' },
      'nonsense',
    ]);

    expect(clean).toEqual([{ aId: 'a', bId: 'b' }]);
  });
});

/**
 * The verdict reaches a Postgres enum column directly.
 *
 * This application registers no global ValidationPipe, so the `@IsIn` on the
 * DTO never executes — a misspelled verdict used to arrive at Prisma and come
 * back as a 500 rather than a 400 naming the field.
 */
describe('verdict is validated before it reaches the enum column', () => {
  const service = Object.create(
    CorrelationReviewService.prototype,
  ) as CorrelationReviewService;

  const assertVerdict = (value: unknown) =>
    (
      service as unknown as { assertVerdict: (v: unknown) => string }
    ).assertVerdict(value);

  it('accepts every verdict the schema declares', () => {
    for (const v of ['CONFIRMED', 'REJECTED', 'UNSURE', 'SPLIT']) {
      expect(assertVerdict(v)).toBe(v);
    }
  });

  it('rejects a misspelling rather than passing it to Prisma', () => {
    expect(() => assertVerdict('CONFIRMD')).toThrow(/verdict must be one of/);
  });

  it('rejects lower case, which the enum would not accept either', () => {
    expect(() => assertVerdict('confirmed')).toThrow();
  });

  it('rejects a missing or non-string verdict', () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(() => assertVerdict(bad)).toThrow();
    }
  });
});
