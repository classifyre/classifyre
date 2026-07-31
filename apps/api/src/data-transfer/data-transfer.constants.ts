/**
 * pg-boss queue carrying "run this export/import job" work. Registered at
 * `localConcurrency: 1` per namespace: a transfer walks most of the tenant's
 * tables, so running two at once would double the load a namespace puts on the
 * shared database for no gain in wall-clock time.
 */
export const DATA_TRANSFER_QUEUE = 'data-transfer.run';

/**
 * Rows read (and written) per round trip. Small enough that one batch of wide
 * rows — assets carry extracted text — stays well inside a normal heap, large
 * enough that per-statement overhead disappears.
 */
export const TRANSFER_BATCH_SIZE = 500;

/** Smaller batch for tables whose rows carry file bytes. */
export const BINARY_BATCH_SIZE = 25;

/**
 * Pause between batches. A transfer is background work with no deadline, so it
 * yields the connection pool back to interactive requests and to any scan
 * running at the same time rather than saturating it.
 */
export const BATCH_PAUSE_MS = 25;

/**
 * Minimum gap between progress writes. Without it a fast export would issue one
 * UPDATE per batch and generate more database traffic reporting itself than
 * doing the work.
 */
export const PROGRESS_FLUSH_MS = 750;

/** Warnings kept on a job; the rest are summarised as a count. */
export const MAX_WARNINGS = 50;
