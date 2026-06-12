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
