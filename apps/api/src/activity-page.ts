import { BadRequestException } from '@nestjs/common';

/**
 * Keyset paging for the activity feeds (a case's timeline, a watch's
 * history), which list newest first by `(createdAt, id)`.
 *
 * The cursor stays what it always was — the id of the last row a page
 * returned — but the next page now starts strictly after that row *in the
 * feed's order*. It used to be `id < cursor`, which compared random UUIDs
 * against a time order: pages skipped rows and repeated others, and a deep
 * link to an older entry could never be paged to.
 */

/** Rows at most one page may hold when a page is asked to reach an entry. */
export const UNTIL_MAX = 1_000;

export interface ActivityAnchor {
  id: string;
  createdAt: Date;
}

/** Rows that come after `anchor` in newest-first order. */
export function afterAnchor(anchor: ActivityAnchor) {
  return {
    OR: [
      { createdAt: { lt: anchor.createdAt } },
      { createdAt: anchor.createdAt, id: { lt: anchor.id } },
    ],
  };
}

/** Rows that come before `anchor` in newest-first order, and the anchor itself. */
export function upToAnchor(anchor: ActivityAnchor) {
  return {
    OR: [
      { createdAt: { gt: anchor.createdAt } },
      { createdAt: anchor.createdAt, id: { gte: anchor.id } },
    ],
  };
}

export function pageSize(limit: number | undefined, fallback = 50): number {
  const n = Number(limit);
  return Math.min(
    Math.max(1, Number.isFinite(n) ? Math.floor(n) : fallback),
    100,
  );
}

/**
 * A comma-separated list of activity types (a query parameter), checked
 * against the enum: an unknown type is a caller's mistake, not "no rows".
 */
export function activityTypes<T extends string>(
  raw: string | string[] | undefined,
  known: Record<string, T>,
): T[] | undefined {
  const values = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  if (values.length === 0) return undefined;
  const allowed = new Set(Object.values(known));
  const unknown = values.filter((v) => !allowed.has(v as T));
  if (unknown.length > 0) {
    throw new BadRequestException(
      `Unknown activity type(s): ${unknown.join(', ')}`,
    );
  }
  return [...new Set(values)] as T[];
}
