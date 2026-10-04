/**
 * Queues of the entity layer (docs/prd/G5-entities.md). Registered per
 * namespace like every other queue, and held paused while the Entities feature
 * is switched off.
 */

/**
 * Candidate generation and counters. A coalesced wake-up: the work is described
 * by the job's payload (`{ runId }`, `{ termIds }` or `{ all: true }`).
 */
export const ENTITIES_RESOLVE_QUEUE = 'entities.resolve';
/** Nightly full counter recomputation. */
export const ENTITIES_RECOUNT_QUEUE = 'entities.recount';

export const ENTITIES_RESOLVE_COALESCE_SECONDS = 10;
export const ENTITIES_RECOUNT_CRON = '7 3 * * *';

/** Minimum Jaro-Winkler score inside a phonetic bucket to propose a value (R4). */
export const ENTITY_CANDIDATE_MIN_JW = 0.92;
/** Score given to a value that folds to the same letters and digits as an alias. */
export const ENTITY_FOLD_SCORE = 0.97;
/**
 * A name shorter than this never links by itself (SL0 §9): "AG", "Co" and
 * single-letter codes are everywhere, and names are data.
 */
export const ENTITY_MIN_ALIAS_CHARS = 4;
/** A fold key shorter than this is not a blocking key, for the same reason. */
export const ENTITY_MIN_FOLD_CHARS = 5;
/** At most this many entities are proposed for one value. */
export const ENTITY_CANDIDATES_PER_VALUE = 3;
/** At most this many candidates are written per resolution pass. */
export const ENTITY_CANDIDATES_PER_RUN = 5_000;
/** Assets read per page while resolving a run. */
export const ENTITY_RESOLVE_PAGE = 500;
/** Co-mentions start from this many of the entity's latest mention assets (§6.3). */
export const ENTITY_CO_MENTION_ASSETS = 5_000;
/** `entity.candidates_pending` names this many entities. */
export const ENTITY_EVENT_TOP = 5;
/** Limits on what one entity may carry. */
export const ENTITY_MAX_IDENTIFIERS = 100;
export const ENTITY_MAX_VALUE_CHARS = 512;
/** Rows per file of an access-request export (R20). */
export const ENTITY_EXPORT_CAP = 50_000;
