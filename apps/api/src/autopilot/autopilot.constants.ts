import { AgentKind } from '@prisma/client';

/** pg-boss queue carrying "a source finished ingesting" jobs to the autopilot. */
export const AUTOPILOT_QUEUE = 'autopilot.cycle';

/**
 * Actor identifier stamped on every autopilot mutation (CaseActivity.actor,
 * Inquiry/Case.createdBy, thread entry author, evidence addedBy). The web UI
 * renders an AI badge wherever this value appears.
 */
export const AI_ACTOR = 'ai-autopilot';

export type EntityOrigin = 'operator' | 'ai';

/** NULL createdBy means an operator: the web never stamps one. */
export function originOf(createdBy: string | null | undefined): EntityOrigin {
  return createdBy === AI_ACTOR ? 'ai' : 'operator';
}

/** Prisma `where` fragment for operator-created rows. `{ not: AI_ACTOR }` alone drops NULLs. */
export const OPERATOR_CREATED = {
  OR: [{ createdBy: null }, { createdBy: { not: AI_ACTOR } }],
} as const;

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

/**
 * Wall-clock budget for one agent run, checked between loop iterations.
 *
 * A run holds a pg-boss handler, and that handler holds one of the instance's
 * `MAX_CONCURRENT_NAMESPACE_JOBS` slots — which defaults to 1. So a run that
 * never returns does not merely fail itself: it freezes every queue in every
 * namespace behind it. Observed on a desktop instance as a CONFIG run stuck in
 * `reason-act` for nine and a half hours against an unresponsive local model,
 * holding the only slot; auto-schedule ticks piled up and timed out, scan
 * hand-offs never reached the autopilot, and the whole app looked idle. The
 * per-request timeout alone cannot bound this — a run makes many requests.
 *
 * Generous on purpose: this is a safety valve against a wedged provider, not a
 * performance target. A healthy run finishes in a minute or two.
 */
export const AGENT_RUN_BUDGET_MS = 20 * 60 * 1000;

/**
 * A RUNNING agent run older than this is presumed dead and reaped, so a run
 * wedged before a restart (or by a provider that never answered) does not need
 * an operator to notice it. Comfortably above the run budget: anything past it
 * is not slow, it is gone.
 */
export const AGENT_RUN_STALE_AFTER_MS = 60 * 60 * 1000;

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

/**
 * Wall-clock ceiling for one whole cycle, across every agent it runs.
 *
 * `AGENT_RUN_BUDGET_MS` bounds a single agent; nothing bounded the cycle, and
 * five agents in series could legitimately occupy 100 minutes. Measured on a
 * live instance mid-ingestion: cycle 1 took 29 minutes, cycle 2 took 69 — of
 * which a DETECTOR_AUTHOR run spent 18 minutes before failing on malformed
 * JSON, with ESCALATION queued behind it the whole time. Scans were completing
 * every two minutes throughout, so the harness saw roughly one cycle per thirty
 * scans.
 *
 * Past the deadline the remaining agents are skipped and the next cycle picks
 * the work up with fresher data, which is strictly better than finishing a
 * cycle whose premises are an hour stale.
 *
 * Checked before each agent starts, so a chain can overshoot by at most one
 * `AGENT_RUN_BUDGET_MS` — an effective ceiling of 50 minutes rather than a hard
 * 30. Interrupting an agent mid-run would cost its work and leave its decisions
 * half-applied; letting the last one finish does not.
 */
export const AUTOPILOT_CYCLE_BUDGET_MS = 30 * 60 * 1000;
/**
 * Below this fraction of OPEN findings carrying an importance score, the
 * missions are told their triage order is partial.
 *
 * A threshold, not a boolean on queue state. `evidenceAnalysisPending` was
 * previously set whenever the readiness gate had found *anything* queued, which
 * during a sustained ingest was every cycle — so "treat findings.ranked as
 * partial and prefer deferring to concluding" was in front of the agents
 * permanently, including when everything in scope was scored.
 */
export const EVIDENCE_ANALYSIS_MIN_COVERAGE = 0.8;

/**
 * Coverage below which a SMALL corpus is held back rather than run on unscored
 * data. Paired with `EVIDENCE_ANALYSIS_USABLE_FINDINGS` below — either one
 * being satisfied lets the cycle run.
 *
 * Distinct from `EVIDENCE_ANALYSIS_MIN_COVERAGE` above, and much lower. That
 * one decides whether the missions are WARNED that scores are partial; this one
 * decides whether the cycle runs at all.
 *
 * A quarter is where `findings.ranked` stops being mostly zeros on a corpus
 * small enough for the ratio to mean anything: below it the triage doctrine
 * reads unscored findings as unimportant ones, which is worse than waiting.
 */
export const EVIDENCE_ANALYSIS_USABLE_COVERAGE = 0.25;

/**
 * Scored findings that make a cycle worth running whatever the ratio says.
 *
 * A ratio has a growing denominator, so on a corpus where ingestion outpaces
 * analysis it falls over time — and the gate re-engages exactly when the corpus
 * is largest. Measured on a live 151-source namespace: 442,613 findings scored
 * against 1,914,477 open, which is 23% and blocked, while detection ran ~30k/h
 * and analysis ~20k/h so the ratio could only keep dropping. The harness stopped
 * investigating at 04:57 and had not run since.
 *
 * 442,613 scored findings is not "too little evidence to reason from" by any
 * reading — it is far more than a cycle can consume, given every retrieval the
 * agents have is bounded in the hundreds. So the absolute number is the honest
 * question and the ratio is the fallback for corpora too small for it to apply.
 *
 * Set well above what one cycle reads (`UNMONITORED_SCAN_LIMIT`,
 * `MAX_FINDING_GROUPS` and the ranked lists are all in the hundreds) and low
 * enough that a modest source clears it early.
 */
export const EVIDENCE_ANALYSIS_USABLE_FINDINGS = 2000;

// ── Monitored coverage: evidence with no inquiry watching it ─────────────────
/**
 * Importance at or above which an open finding ought to be watched by SOME
 * inquiry, and the ceiling on how many are examined per check.
 *
 * The harness reported coverage of SOURCES scanned and nothing at all about
 * findings monitored. On a live instance that gap showed plainly: 250 findings
 * scored above this bar while one inquiry matched anything, and the inquiry
 * agent spent every cycle re-reading its own two artifacts. The mission text
 * pushes hard toward "avoid duplicates, prefer enriching, wind down noise" and
 * nothing pushed the other way, so maintenance was the rational move. This is
 * the missing counterweight: evidence nobody is watching.
 */
export const UNMONITORED_MIN_IMPORTANCE = 0.75;

/**
 * Completed scans examined when asking "is this source still detecting
 * anything?". A source whose recent scans all processed assets and produced no
 * findings is blind, not quiet — and nothing said so, which is how one ran a
 * full sweep of its corpus every three hours for a night, finding nothing,
 * while the agents had no material to build anything from.
 */
export const DETECTION_YIELD_SCANS = 5;
/** Highest-importance findings examined per unmonitored-coverage check. */
export const UNMONITORED_SCAN_LIMIT = 500;

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
/**
 * Failed scans in a row, with no successful scan ever, before a source counts
 * as unavailable rather than merely unread.
 *
 * Coverage divided by every source row, which made the ratio a one-way ratchet:
 * a source that can never scan — dead credentials, a host that no longer exists,
 * one an operator switched off — sat in the denominator for good. Below 90% the
 * brief tells the agent it is looking at a sample and the coverage doctrine
 * tells it to defer rather than act, so a handful of permanently-broken sources
 * silently put the whole harness into "observe and defer" mode forever, and the
 * deferrals it wrote could never come back out.
 *
 * Unavailable sources are excluded from the ratio and reported on their own
 * line instead: the gap stays visible (it is the config agent's problem), it
 * just stops being counted as corpus the investigators are still waiting for.
 */
export const COVERAGE_UNAVAILABLE_FAILURE_STREAK = 3;
/**
 * A deferred item resurfaces after this long no matter what coverage says.
 * The coverage trigger alone is a promise the system cannot keep — if coverage
 * never reaches the threshold, "revisit later" means "never".
 */
export const DEFERRAL_MAX_AGE_DAYS = 14;

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
 * The primary guard is now the detection fingerprint (see
 * `computeDetectionFingerprint`): a re-scan is refused when nothing about what
 * the source detects has changed since the last autopilot re-scan, because that
 * scan would produce exactly the same findings. This is the daily backstop for
 * an agent that flaps a setting back and forth and so passes that test every
 * time.
 */
export const AUTOPILOT_RESCANS_PER_DAY = 4;

/**
 * Detection-change budget: how many times the autopilot may change ONE source's
 * detection in 24 hours.
 *
 * `AUTOPILOT_RESCANS_PER_DAY` above bounds how often a source is re-read; this
 * bounds how often what it detects is redefined, which is the more expensive of
 * the two. Removing a detector resolves every open finding it produced, so a
 * source whose detector set keeps moving never accumulates an evidence base for
 * anything to be investigated from. On the live instance that produced this
 * constant, one source took 22 TUNE_SOURCE writes across three days and ended
 * with every built-in detector disabled and 96% of its findings resolved.
 */
export const AUTOPILOT_TUNES_PER_DAY = 4;

/**
 * Completed scans a source's detection fingerprint must survive unchanged
 * before its detection counts as settled. Two would be satisfied by a pair of
 * back-to-back catch-up runs minutes apart; three means the set has actually
 * been exercised.
 */
export const DETECTION_STABLE_RUNS = 3;

/**
 * Open findings a source needs before its detection can be judged at all.
 * Below this it is EXPLORING: there is nothing yet to be right or wrong about,
 * and the agent should be free to experiment without any of the brakes.
 */
export const DETECTION_POSTURE_MIN_FINDINGS = 50;

/**
 * Rows a detection-impact preview will pull before reporting itself capped.
 *
 * The count of what a change resolves comes from an aggregate and is always
 * exact; this bounds only the per-row pass that decides which of them a case
 * cites or an inquiry watches. Sized well above any plausible number of cited
 * findings and far below the 44k a single detector can hold.
 */
export const DETECTION_IMPACT_SCAN_LIMIT = 5000;

/**
 * Findings `detectors.value` inspects row-by-row to decide what is watched,
 * cited or high-importance. The volume column is an aggregate and always exact;
 * this bounds only the value columns, and the scan is ordered by importance so
 * a capped answer still describes the part of the output that matters.
 */
export const DETECTOR_VALUE_SCAN_LIMIT = 5000;

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
/** Whole ranked items per tool call; sized to stay below the 8k observation cap. */
export const RANKED_LIST_PAGE_SIZE = 5;
export const MAX_CASE_SUMMARY_DESCRIPTION = 240;
export const MAX_INQUIRY_SUMMARY_DESCRIPTION = 240;
export const MAX_SUMMARY_TITLE = 160;
export const MAX_HYPOTHESIS_SUMMARY_TITLE = 100;
export const MAX_HYPOTHESIS_TITLES_PER_CASE = 6;
export const MAX_OPEN_HYPOTHESES = 20;
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
 * The scan-cycle agents, in canonical order.
 *
 * Shared by the trigger endpoint and the worker so "which agents make up a
 * cycle" has exactly one definition — the worker's own list used to be
 * implicit in a chain of per-agent flag checks, which is how the cycle gate
 * came to test only two of the five.
 *
 * The worker no longer runs them as one series; see the two chains below.
 */
export const PIPELINE_KINDS = [
  AgentKind.INQUIRY,
  AgentKind.CASE,
  AgentKind.CONFIG,
  AgentKind.DETECTOR_AUTHOR,
  AgentKind.ESCALATION,
] as const;

/**
 * The investigation chain. Ordering here is a real data dependency: CASE
 * consumes the inquiries INQUIRY just created or widened, and ESCALATION
 * alerts on the final state of the cases CASE mutated.
 */
export const INVESTIGATION_CHAIN = [
  AgentKind.INQUIRY,
  AgentKind.CASE,
  AgentKind.ESCALATION,
] as const;

/**
 * The detection chain. DETECTOR_AUTHOR reacts to what CONFIG left unaddressed,
 * and both write the same source config — serialising them keeps them off each
 * other's optimistic-concurrency token.
 *
 * Independent of the investigation chain: it reads the finding landscape from
 * the database, not from what those agents produced, so the two run
 * concurrently. Keeping all five in one series cost a live instance roughly an
 * order of magnitude in cycle throughput.
 */
export const DETECTION_CHAIN = [
  AgentKind.CONFIG,
  AgentKind.DETECTOR_AUTHOR,
] as const;
