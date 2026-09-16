/** pg-boss queue carrying "run the next chunk of this bulk operation". */
export const FINDING_BULK_OPERATION_QUEUE = 'findings.bulk-operation';

/**
 * A filter-mode bulk update matching at most this many findings still runs
 * inside the request, as before. Above it, the request queues an operation and
 * returns its id. Sized so the synchronous path stays one page of the walk.
 */
export const BULK_UPDATE_SYNC_LIMIT = 2000;

/**
 * Findings read per page. Read pages stay large: the scan is sequential and
 * cheap, and fewer pages means fewer round trips.
 */
export const BULK_OPERATION_PAGE_SIZE = 2000;

/**
 * Findings written per transaction. The write — not the scan — is what must
 * fit the transaction budget.
 *
 * Field-measured on a 2,743 MB `findings` heap (18 indexes, four including
 * `status`, so no HOT updates) against 768 MB of `shared_buffers`: a 2,000-row
 * UPDATE took 11.1 s / 33.4 s / 43.4 s across three identical runs, so two of
 * three exceeded the 30 s budget. The spread is the point — cache residency
 * varies run to run — which is why this is a much smaller batch rather than a
 * larger timeout: any timeout derived from one measurement fails on a colder
 * cache. 250 rows measured ~6–7 s, leaving ~4× margin inside the budget.
 */
export const BULK_OPERATION_WRITE_BATCH_SIZE = 250;

/**
 * Budget for one write-batch transaction. Do NOT raise this to fit a slow
 * page: shrink the write batch instead (see above). A fixed timeout can only
 * ever fit the runs already measured, never the next colder cache.
 */
export const BULK_OPERATION_TX_TIMEOUT_MS = 30_000;

/**
 * How long one handler invocation works before handing the rest to a new job.
 * Every background handler holds one of the few global worker slots for its
 * whole duration; a corpus-sized operation in one handler starved embeddings,
 * correlation and the autopilot behind it.
 */
export const BULK_OPERATION_CHUNK_BUDGET_MS = 60_000;

/** A lease this long outlives any single page, so only a dead handler lets it expire. */
export const BULK_OPERATION_LEASE_MS = 3 * 60_000;

/** Breathing room between pages, so autovacuum and live scans keep pace. */
export const BULK_OPERATION_PAGE_PAUSE_MS = 50;

/**
 * Physical blocks of `findings` per retire page (64 MB at the default 8 KB).
 * Measured on an I/O-bound instance: 10,000 blocks in 4.9 s. Pages vary in
 * rows with how densely one detector's findings sit in the heap.
 */
export const RETIRE_SCAN_BLOCKS = 8192;

/** A retire must follow a dry run this recent; older counts are not a review. */
export const RETIRE_DRY_RUN_MAX_AGE_MS = 24 * 60 * 60_000;

/** Would-retire finding ids a dry run keeps for spot checks. */
export const RETIRE_SAMPLE_IDS = 20;
