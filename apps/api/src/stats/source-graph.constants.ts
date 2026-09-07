/** pg-boss queue that owns the source connection map's rebuild. */
export const SOURCE_GRAPH_QUEUE = 'source-graph-refresh';

/**
 * Coalescing window, matching the finding-stats rollup's.
 *
 * Edges arrive in batches during a scan — a connector emitting relationships
 * can ask for a rebuild hundreds of times in a minute. `singletonSeconds`
 * collapses those onto one job and `singletonNextSlot` moves anything that
 * arrives while a job is already queued into the next slot rather than dropping
 * it, so the last batch before a workspace goes quiet is still reflected.
 */
export const SOURCE_GRAPH_COALESCE_SECONDS = 20;

export const SOURCE_GRAPH_SINGLETON_KEY = 'source-graph:rebuild';

/**
 * `peer_source_id` for a boundary asset whose far end is an `external`
 * endpoint — a URN nothing has scanned yet. A sentinel rather than NULL because
 * the column is part of the primary key and Postgres treats NULLs as distinct.
 * Source ids are UUIDs, so this cannot collide with one.
 */
export const EXTERNAL_PEER = 'external';

export interface SourceGraphJobPayload {
  /** Human-readable trigger, for logs. */
  reason?: string;
}
