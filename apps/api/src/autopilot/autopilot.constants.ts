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
