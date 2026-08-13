/** pg-boss queue that owns every rollup refresh for a namespace. */
export const FINDING_STATS_QUEUE = 'finding-stats-refresh';

/**
 * Coalescing window. Requests arriving inside it collapse onto one job, and
 * `singletonNextSlot` pushes anything that arrives while that job is queued
 * into the *next* slot rather than dropping it — so a scan writing findings
 * for an hour produces a steady trickle of refreshes instead of one per batch,
 * and an idle workspace produces none at all.
 */
export const FINDING_STATS_COALESCE_SECONDS = 20;

/** Singleton keys: incremental and full refreshes coalesce independently. */
export const FINDING_STATS_INCREMENTAL_KEY = 'finding-stats:incremental';
export const FINDING_STATS_FULL_KEY = 'finding-stats:full';

/**
 * Ceiling on the `total` reported for a filtered search whose predicate the
 * rollup cannot answer. Counting every match of a broad text search is the
 * same full-table `count(*)` the rollup exists to avoid (2.0 s measured), and
 * no one paginates to row 900,000 — so stop counting once the number stops
 * being actionable and tell the client the value is a floor.
 */
export const FINDING_TOTAL_CAP = 10_000;

/** Payload for a {@link FINDING_STATS_QUEUE} job. */
export interface FindingStatsJobPayload {
  /** Rebuild every day from scratch rather than draining the dirty list. */
  full?: boolean;
  /** Human-readable trigger, for logs. */
  reason?: string;
}
