import { BadRequestException } from '@nestjs/common';
import {
  activityTypes,
  afterAnchor,
  pageSize,
  upToAnchor,
} from './activity-page';

const KNOWN = { A: 'A', B: 'B', C: 'C' } as const;

/** The feed's order, newest first by (createdAt, id). */
function newestFirst(
  rows: Array<{ id: string; createdAt: Date }>,
): Array<{ id: string; createdAt: Date }> {
  return [...rows].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
}

/** Evaluate an OR-of-conditions where clause the way Postgres would. */
function matches(
  where: ReturnType<typeof afterAnchor> | ReturnType<typeof upToAnchor>,
  row: { id: string; createdAt: Date },
): boolean {
  return where.OR.some((cond) => {
    const c = cond as {
      createdAt: Date | { lt?: Date; gt?: Date };
      id?: { lt?: string; gte?: string };
    };
    const t = row.createdAt.getTime();
    const created =
      c.createdAt instanceof Date
        ? t === c.createdAt.getTime()
        : (c.createdAt.lt === undefined || t < c.createdAt.lt.getTime()) &&
          (c.createdAt.gt === undefined || t > c.createdAt.gt.getTime());
    const id =
      !c.id ||
      ((c.id.lt === undefined || row.id < c.id.lt) &&
        (c.id.gte === undefined || row.id >= c.id.gte));
    return created && id;
  });
}

describe('activity paging', () => {
  // Same timestamps on purpose: ids are random UUIDs, not a time order.
  const t0 = new Date('2026-09-28T10:00:00Z');
  const t1 = new Date('2026-09-28T11:00:00Z');
  const rows = newestFirst([
    { id: 'f3', createdAt: t1 },
    { id: '0a', createdAt: t1 },
    { id: 'zz', createdAt: t0 },
    { id: '11', createdAt: t0 },
    { id: '99', createdAt: t0 },
  ]);

  it('pages through every row exactly once', () => {
    const seen: string[] = [];
    let anchor: { id: string; createdAt: Date } | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = rows
        .filter((r) => (anchor ? matches(afterAnchor(anchor), r) : true))
        .slice(0, 2);
      if (page.length === 0) break;
      seen.push(...page.map((r) => r.id));
      anchor = page[page.length - 1]!;
    }
    expect(seen).toEqual(rows.map((r) => r.id));
  });

  it('counts the rows up to and including an entry', () => {
    const target = rows[3];
    expect(rows.filter((r) => matches(upToAnchor(target), r))).toEqual(
      rows.slice(0, 4),
    );
  });

  it('bounds the page size', () => {
    expect(pageSize(undefined)).toBe(50);
    expect(pageSize(0)).toBe(1);
    expect(pageSize(500)).toBe(100);
    expect(pageSize(Number.NaN)).toBe(50);
  });

  it('reads a comma-separated type list and refuses unknown types', () => {
    expect(activityTypes(undefined, KNOWN)).toBeUndefined();
    expect(activityTypes('A, B,A', KNOWN)).toEqual(['A', 'B']);
    expect(activityTypes(['A', 'C'], KNOWN)).toEqual(['A', 'C']);
    expect(() => activityTypes('A,NOPE', KNOWN)).toThrow(BadRequestException);
  });
});
