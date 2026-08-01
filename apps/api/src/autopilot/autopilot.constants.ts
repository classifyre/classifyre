import { AgentKind } from '@prisma/client';

/** pg-boss queue carrying "a source finished ingesting" jobs to the autopilot. */
export const AUTOPILOT_QUEUE = 'autopilot.cycle';

/**
 * Actor identifier stamped on every autopilot mutation (CaseActivity.actor,
 * Inquiry/Case.createdBy, thread entry author, evidence addedBy). The web UI
 * renders an AI badge wherever this value appears.
 */
export const AI_ACTOR = 'ai-autopilot';

/**
 * Delay (seconds) before an autopilot cycle starts. Keeps the agent "slow":
 * inquiry matching for the same source runs immediately on its own queue and
 * is expected to be done by the time the cycle begins.
 */
export const AUTOPILOT_START_AFTER_SECONDS = 120;

/** Re-check delay when inquiry matching for the source is still queued. */
export const AUTOPILOT_RETRY_AFTER_SECONDS = 60;

/** Give up resuming a run after this many worker attempts. */
export const AUTOPILOT_MAX_ATTEMPTS = 3;

// ── Cadence: coalescing many scan completions into one corpus cycle ──────────
/**
 * Scan completions used to fire one cycle each, debounced only per source
 * (`singletonKey: autopilot:<sourceId>`). Onboarding 151 sources therefore
 * produced 151 independent cycles of five agents apiece — each reasoning over
 * whatever fraction of the corpus had landed by then, and none of them able to
 * see the others. Instead, a completed scan now marks its source *dirty* and
 * enqueues a single job per window, and the cycle that eventually runs sees the
 * whole batch at once.
 *
 * This value doubles as the pg-boss `singletonSeconds` slot width, which is
 * what actually performs the coalescing — a bare `singletonKey` is inert on a
 * `standard` queue; see the note at the enqueue site. A backlog is neither
 * capped nor fast-tracked: a bigger batch is the intended outcome, and the
 * window is a fixed upper bound on how long a scan waits to be looked at.
 */
export const AUTOPILOT_COALESCE_WINDOW_SECONDS = 600;
/** pg-boss singleton key for the coalesced corpus-wide cycle. */
export const AUTOPILOT_CORPUS_SINGLETON_KEY = 'autopilot:corpus';

// ── Express lane: what may skip the window ──────────────────────────────────
/**
 * Batching must not mean a real hit waits. Three things bypass the window: a
 * finding the evidence analyzer scored this highly, a match on a detector the
 * operator authored themselves, and an operational failure. The last routes to
 * the config agent rather than the investigation agents — 60 of the first run's
 * 82 scans errored, and nothing in the system said so.
 */
export const EXPRESS_IMPORTANCE_SCORE = 0.75;
/** Consecutive failed scans before a source is escalated as an operator problem. */
export const EXPRESS_CONSECUTIVE_FAILURES = 3;

// ── Readiness ────────────────────────────────────────────────────────────────
/**
 * The cycle waits for inquiry matching AND evidence analysis to drain, so the
 * TRIAGE DOCTRINE ("start from findings.ranked") is not applied to findings
 * that have no importance score yet. Bounded: after this many requeues the
 * cycle proceeds anyway with `evidenceAnalysisPending` set on its context, so a
 * permanently-backed-up embedding queue degrades the run rather than
 * deadlocking the autopilot entirely.
 */
export const AUTOPILOT_MAX_READINESS_REQUEUES = 5;

// ── Evidence floor (enforced in code, not prose) ─────────────────────────────
/**
 * An inquiry is a saved monitor over findings. One whose matchers select
 * nothing is not a monitor, it is a guess — and the first real run produced
 * four of them ("Grand Cayman is a known offshore jurisdiction", 0 matches)
 * because the model was recalling the Enron scandal rather than reading the
 * corpus. Creation is refused below this many matched open findings.
 */
export const MIN_INQUIRY_MATCHES = 1;
/**
 * Two inquiries whose matchers select largely the same findings are one
 * inquiry. Above this Jaccard-style overlap with an existing ACTIVE inquiry,
 * creation is refused and the agent is pointed at inquiries.enrich — the first
 * run created five separate "HTML email artifact noise" inquiries, one per
 * mailbox, its own rationale reading "same pattern as 5 other sources".
 */
export const INQUIRY_DUPLICATE_OVERLAP = 0.6;
/** Candidate ACTIVE inquiries compared against a proposal before creating it. */
export const MAX_DUPLICATE_CANDIDATES = 40;
/**
 * Of those, how many get the expensive check. Comparing matchers structurally
 * is free; comparing what they actually select costs a preview that walks every
 * matching finding, and this runs inside a tool call — so only the most
 * structurally similar few are worth the query.
 */
export const MAX_DUPLICATE_PREVIEWS = 5;
/**
 * Findings whose evidence analysis says they are noise cannot substantiate a
 * new inquiry or case. Reason codes carry an explicit `impact`, so weakness is
 * read from that rather than from a hard-coded code list that would drift as
 * the analyzer gains reasons.
 */
export const WEAK_EVIDENCE_REASON_CODES = [
  'ocr_fragment',
  'duplicate_group',
  'common_value',
  'known_test_value',
  'repeated_digit_pattern',
] as const;

// ── Coverage (calibration, not a gate) ───────────────────────────────────────
/**
 * Below this scanned-source fraction the brief tells the agent in plain terms
 * that it is looking at a sample, and the coverage doctrine applies. It never
 * blocks a run — a genuine finding in the first source still deserves action;
 * what it blocks is presenting a sample as if it were the corpus.
 */
export const CORPUS_SAMPLE_COVERAGE_THRESHOLD = 0.9;
/** Per-source scan rows returned by the corpus.coverage tool. */
export const MAX_COVERAGE_SOURCE_ROWS = 200;

// ── Deferral ────────────────────────────────────────────────────────────────
/**
 * An agent had no way to say "not yet". Its only terminal moves were `finish`
 * or exhausting its iteration budget, and the `pending-verification` memory tag
 * was pure convention with nothing tracking it — so "I expect this pattern to
 * recur in the sources still to be scanned" had no expression except creating
 * the inquiry anyway. `agenda.defer` writes a tagged memory the brief surfaces
 * back once coverage reaches the recorded threshold.
 */
export const DEFERRED_TAG = 'deferred';
export const DEFERRED_KEY_PREFIX = 'deferred:';
/** Deferred items shown in the brief's "Deferred until more coverage" section. */
export const MAX_DEFERRED_ENTRIES = 10;

// ── Autopilot-triggered re-scans ────────────────────────────────────────────
/**
 * The `sources.rescan` depth-1 guard refuses to re-scan from inside a cycle
 * that was itself triggered by an autopilot re-scan. That guard reads the
 * triggering runner — and a COALESCED CORPUS CYCLE HAS NO RUNNER, so it was
 * inert for exactly the cycles that now do most of the work: config agent
 * re-scans → scan completes → source goes dirty → next corpus cycle → config
 * agent re-scans again, with nothing but prose in the mission telling it to
 * stop.
 *
 * These bound it in code instead. A source may be re-scanned by the autopilot
 * at most once per cooldown, and at most this many times a day, whatever the
 * cycle shape.
 */
export const AUTOPILOT_RESCAN_COOLDOWN_SECONDS = 2 * 3600;
export const AUTOPILOT_RESCANS_PER_DAY = 4;

/**
 * "Dreaming" cadence: every other day at 03:10 the agent consolidates its
 * memory (dedupe, prune noise, distill important notes). Registered as a
 * pg-boss schedule on the autopilot queue.
 */
export const AUTOPILOT_DREAM_CRON = '10 3 */2 * *';

// ── Context bounds (token budget guards) ─────────────────────────────────────
export const MAX_FINDING_GROUPS = 40;
export const MAX_SAMPLE_VALUES_PER_GROUP = 15;
export const MAX_SAMPLE_VALUE_LENGTH = 120;
export const MAX_CANDIDATE_INQUIRIES = 60;
export const MAX_CASE_SUMMARIES = 40;
export const MAX_FINDINGS_PER_INQUIRY = 25;
export const MAX_CASE_CLUSTERS_PER_CYCLE = 5;
export const MAX_GLOSSARY_ENTRIES = 20;
export const MAX_RECALLED_MEMORIES = 30;
// Duplicate/cluster context handed to the inquiry/case agents per cycle.
export const MAX_DUPLICATE_CLUSTERS = 15;
export const MAX_DUPLICATE_PAIRS = 20;
// Asset observation (cold-start signal): how much raw asset shape the harness
// may inspect when a source has produced no findings yet.
export const MAX_ASSET_SAMPLES = 25;
export const MAX_ASSET_METADATA_PREVIEW_KEYS = 12;
export const MAX_ASSET_METADATA_PREVIEW_LENGTH = 80;
export const MAX_ASSET_TYPE_BUCKETS = 15;
export const MAX_ASSET_METADATA_KEY_BUCKETS = 25;
export const ASSET_PROFILE_SCAN_LIMIT = 5000;

// ── Detector precision signal (operator dismissals → false-positive rate) ─────
/**
 * Below this many operator-triaged findings the false-positive rate is too
 * small a sample to trust — the detector is reported "unproven" rather than
 * judged noisy or clean, so the author neither retires a promising detector on
 * one dismissal nor trusts a clean streak of two.
 */
export const MIN_FEEDBACK_FOR_PRECISION = 5;
/** At/above this dismissal rate (with enough samples) a detector is "noisy". */
export const NOISY_FALSE_POSITIVE_RATE = 0.5;
/** At/below this dismissal rate (with enough samples) a detector is "clean". */
export const CLEAN_FALSE_POSITIVE_RATE = 0.2;

/**
 * The scan-cycle agents, in the order a cycle runs them. Each reacts to what
 * the previous ones observed, so the order is meaningful, not cosmetic.
 *
 * Shared by the trigger endpoint and the worker so "which agents make up a
 * cycle" has exactly one definition — the worker's own list used to be
 * implicit in a chain of per-agent flag checks, which is how the cycle gate
 * came to test only two of the five.
 */
export const PIPELINE_KINDS = [
  AgentKind.INQUIRY,
  AgentKind.CASE,
  AgentKind.CONFIG,
  AgentKind.DETECTOR_AUTHOR,
  AgentKind.ESCALATION,
] as const;
