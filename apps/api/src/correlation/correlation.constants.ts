/**
 * pg-boss queue carrying "a source finished ingesting, correlate its assets"
 * jobs. The correlation step runs *before* the autopilot cycle (which it
 * enqueues on completion) so the inquiry/case agents can consider duplicates.
 */
export const CORRELATION_QUEUE = 'correlation.scan';

/**
 * Default per-label weights for the weighted-overlap score. Concrete
 * identifiers dominate; every unknown/custom label falls back to
 * DEFAULT_LABEL_WEIGHT, keeping the engine fully label-agnostic and free of
 * any user-facing configuration. Keys are matched case-insensitively against a
 * normalized form of the finding label (see weightForLabel).
 */
export const LABEL_WEIGHTS: Record<string, number> = {
  credit_card: 6,
  iban: 6,
  ssn: 6,
  passport: 6,
  national_id: 5,
  email: 5,
  phone: 4,
  api_key: 5,
  secret: 5,
  address: 3,
  person: 2,
  name: 2,
  url: 1,
  domain: 1,
  ip: 1,
  country: 1,
};

/** Weight for any label not present in LABEL_WEIGHTS. */
export const DEFAULT_LABEL_WEIGHT = 1;

/** Minimum weighted match to record a "related" Edge between two assets. */
export const RELATED_MIN = 0.3;

/**
 * Minimum weighted match (or an exact all-values match) to treat a pair as a
 * likely duplicate — these edges drive cluster union.
 */
export const DUPLICATE_MIN = 0.6;

/** Cap on candidate assets scored against one asset (guards pathological hubs). */
export const CANDIDATE_CAP = 200;

/**
 * A value shared by more than this many assets is a "hub" (e.g. a common,
 * non-discriminating token like a country code) and is excluded from the
 * pairwise self-join entirely — not for memory (the join now runs in
 * Postgres, not Node), but because pairing every owner of a non-discriminating
 * value produces spurious "exact duplicate" edges between otherwise-unrelated
 * assets. Enforced as a SQL filter, so it costs nothing in API memory and can
 * be set much higher than the old in-memory cap.
 */
export const FANOUT_CAP = 2000;

/** Flush correlation edges to the DB in batches of this size (memory guard). */
export const EDGE_BATCH = 2000;

/** Rows fetched per page when streaming the value index / edges. */
export const STREAM_PAGE = 50000;

/** Longest normalized value we index; longer values are skipped as noise. */
export const MAX_VALUE_LENGTH = 512;

/** How many common values to precompute into AssetCluster.topValues for the UI. */
export const MAX_CLUSTER_TOP_VALUES = 12;
