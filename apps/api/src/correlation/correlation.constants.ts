/**
 * pg-boss queue carrying "a source finished ingesting, correlate its assets"
 * jobs. The correlation step runs *before* the autopilot cycle (which it
 * enqueues on completion) so the inquiry/case agents can consider duplicates.
 */
export const CORRELATION_QUEUE = 'correlation.scan';

/**
 * Coalescing window for the per-scan correlation job.
 *
 * Must be passed as `singletonSeconds` alongside the source's `singletonKey`:
 * in pg-boss 12 `singleton_on` is only populated when `singletonSeconds` is
 * given, and the dedupe index (`job_i4`, partial on `singleton_on IS NOT NULL`)
 * therefore never applies to a bare `singletonKey`. Without it every completed
 * scan enqueued its own recompute — the "debounce" this queue documented did
 * not exist.
 *
 * Sized against the adaptive scheduler, which deliberately rescans a source
 * back-to-back while it is still ingesting. One minute collapses that burst
 * while staying well inside the autopilot's own 120s start-after, so the
 * handoff is not meaningfully delayed.
 */
export const CORRELATION_SCAN_COALESCE_SECONDS = 60;

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

/**
 * SHA-256 of zero bytes. Assets whose scanned payload was empty all share this
 * digest, and grouping every empty file in a corpus into one "duplicate" set is
 * noise, not evidence — excluded from exact-duplicate linking.
 */
export const EMPTY_CONTENT_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Largest byte-identical group that still gets linked. The claim stays true
 * past this size, but a group of thousands of identical stub files says nothing
 * about any individual member and would drag them all into one useless
 * mega-cluster. Same reasoning as FANOUT_CAP, applied to exact matches.
 */
export const IDENTICAL_GROUP_CAP = 500;

/** Content-hash groups pulled from Postgres per page while linking. */
export const IDENTICAL_GROUP_PAGE = 500;

/** Longest normalized value we index; longer values are skipped as noise. */
export const MAX_VALUE_LENGTH = 512;

/** How many common values to precompute into AssetCluster.topValues for the UI. */
export const MAX_CLUSTER_TOP_VALUES = 12;

/**
 * Maximum number of assets allowed in a single phonetic group
 * (a "label + phonetic_hash" bucket). Groups larger than this are skipped:
 * common phonetic codes (e.g. "JN" shared by all John/Jon/Jan documents) are
 * non-discriminating and would produce O(N²) pair comparisons.
 */
export const PHONETIC_FANOUT_CAP = 50;

/**
 * Minimum Jaro-Winkler score for a phonetic match to count as evidence.
 * Below this threshold the pair probably share a phonetic code by accident
 * (e.g. "john" ↔ "jane" both map to "JN") and should not contribute weight.
 */
export const PHONETIC_MIN_JW = 0.75;

/**
 * Labels for which phonetic matching is meaningful. Structured identifiers
 * (email, phone, SSN, IBAN, URLs, IPs …) are excluded: their normalised form
 * is already canonical and phonetics would produce false positives.
 * Custom/unknown labels are considered phonetic-eligible by default.
 */
export const NON_PHONETIC_LABELS = new Set([
  'email',
  'phone',
  'url',
  'domain',
  'ip',
  'credit_card',
  'iban',
  'ssn',
  'passport',
  'national_id',
  'api_key',
  'secret',
  'country',
]);
