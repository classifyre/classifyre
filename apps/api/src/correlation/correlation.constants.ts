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

// ── Review queue ────────────────────────────────────────────────────────────

/**
 * Number of histogram bins the review queue stores per pattern. Twenty bins
 * over [0,1] is a 0.05 resolution — fine enough to see the valley between the
 * duplicate and non-duplicate modes, coarse enough that every pattern's whole
 * distribution fits in one small array that ships to the browser. Dragging a
 * cutoff then costs no round trip, which is what makes the page feel live.
 */
export const SCORE_BUCKET_COUNT = 20;

/**
 * How many labels a pattern key names before it collapses to `+N`.
 *
 * Raw label sets explode combinatorially — 2^|labels| possible keys — and a
 * thousand-row pattern list would just be the cluster list with extra steps.
 * Truncating keeps the level-1 list to a screenful. The cost is that the key
 * is lossy, which is why CorrelationClusterPattern carries the full set.
 */
export const PATTERN_LABEL_CAP = 3;

/**
 * Patterns smaller than this collapse into `misc`. A pattern is a thing you
 * write one rule for; a pattern of two pairs is just two pairs.
 */
export const MIN_PATTERN_PAIRS = 5;

/**
 * Cap on asset pairs materialised per near-duplicate text group. These groups
 * are finding-level and projecting them onto asset pairs is quadratic — a
 * 50-asset group is 1,225 pairs. The pattern row stores the true size
 * alongside the capped count so the number on screen is not a lie.
 */
export const BOILERPLATE_PAIR_CAP = 200;

/**
 * How far upstream to walk when recording an asset's FLOW roots, and how many
 * to keep. Three hops is the same ceiling the lineage view uses; eight roots is
 * enough to test "do these two share an ancestor" without storing a subgraph.
 */
export const LINEAGE_ROOT_DEPTH = 3;
export const LINEAGE_ROOT_CAP = 8;

/**
 * Share of lineage-covered assets above which a connected component stops
 * counting as evidence.
 *
 * The 2x2 approximates "is there a path between these assets" with "are they in
 * the same connected component", which is O(E) instead of a breadth-first
 * search seeded at every asset. The approximation fails in one direction: a
 * single hairball component makes every pair look derived, and the queue would
 * quietly escalate nothing. Past this share we report UNKNOWN, which is honest
 * about the fact that we cannot tell.
 */
export const LINEAGE_HAIRBALL_SHARE = 0.4;

/**
 * Below this many lineage-covered assets the hairball share is meaningless — in
 * a corpus of four covered assets a component of two is 50% and would demote
 * every genuine derivation path to UNKNOWN. Small estates are exactly where
 * lineage coverage is sparse and each edge matters most, so the guard stays off
 * until there is enough of a graph for a share to describe anything.
 */
export const LINEAGE_HAIRBALL_MIN_ASSETS = 25;

/**
 * The band an agent may clear on its own.
 *
 * Only pairs at or above this score AND explained by lineage: a derived copy
 * with a near-perfect match is the case where a human adds nothing. Everything
 * else — anything unexplained, anything ambiguous — stays for a person, which
 * is the whole point of routing rather than automating.
 *
 * Agent decisions are stamped with AI_ACTOR and counted apart, so the queue's
 * headline stays a count of human work.
 */
export const AGENT_SAFE_BAND_MIN = 0.95;
