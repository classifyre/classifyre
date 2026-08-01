/**
 * Tuning for the adaptive ("automatic") source scheduler.
 *
 * Every value here is a bound on cost, not a target: the loop is driven by what
 * the last run actually ingested, and these only decide how eagerly it chases
 * more and how patiently it waits once there is none.
 */

/** pg-boss queue carrying auto-scheduler ticks (cron + post-run kicks). */
export const AUTO_SCHEDULE_QUEUE = 'auto-schedule.tick';

/**
 * The reconciliation heartbeat. The post-run kick is what makes the loop
 * responsive; this is what makes it *correct* — a lost kick (pod killed between
 * finishing a run and enqueuing) would otherwise strand a source forever.
 */
export const AUTO_SCHEDULE_TICK_CRON = '* * * * *';

/** `triggeredBy` stamped on runs the adaptive scheduler starts. */
export const AUTO_SCHEDULE_ACTOR = 'Auto-scheduler';

// ── CATCH_UP: still ingesting ────────────────────────────────────────────────
/**
 * Gap between back-to-back catch-up runs. Not zero on purpose: a completed scan
 * fans out into inquiry matching, correlation, embeddings and an autopilot
 * cycle, and starting the next scan the same instant would let ingestion
 * permanently outrun everything that reads its output.
 */
export const CATCH_UP_COOLDOWN_SECONDS = 60;

// ── STEADY: converged, re-checking for new data ──────────────────────────────
/** Floor for the steady-state interval, and the value it resets to. */
export const STEADY_MIN_SECONDS = 15 * 60;
/** Ceiling. A source with nothing new for days still gets a daily look. */
export const STEADY_MAX_SECONDS = 24 * 60 * 60;
/** The steady interval multiplies by this after each no-progress run. */
export const STEADY_GROWTH_FACTOR = 2;
/**
 * Consecutive no-progress runs before CATCH_UP is promoted to STEADY.
 *
 * Two, not one: a single empty run is a weak signal. A paginating source can
 * legitimately return one empty page (a filtered slice, a transient permission
 * error on a subtree) and still have plenty left, and dropping straight to a
 * 15-minute cadence there would stall an ingest that was nearly done.
 */
export const NO_PROGRESS_RUNS_TO_CONVERGE = 2;

/**
 * Hard cap on consecutive catch-up runs before the source is forced to STEADY.
 *
 * "Ingested something" is the right convergence signal for a sweep, but it
 * never goes quiet on a source whose content legitimately changes on every
 * scan — a busy chat workspace, a mailbox, a table with a timestamp column.
 * Those would sit at the one-minute cadence indefinitely. This is the bound
 * that makes the loop's worst case finite regardless of what the source does;
 * a config change or an operator resets it.
 */
export const MAX_CONSECUTIVE_CATCH_UP_RUNS = 200;

// ── BACKOFF / PAUSED: failure paths ──────────────────────────────────────────
/** First retry delay after a failed run; doubles per consecutive failure. */
export const BACKOFF_BASE_SECONDS = 5 * 60;
/** Backoff ceiling. */
export const BACKOFF_MAX_SECONDS = 6 * 60 * 60;
/**
 * Consecutive failures before the source is PAUSED and an operator is notified.
 * A source that cannot scan is an operator problem, and retrying it every six
 * hours forever is how a broken credential stays broken and invisible.
 */
export const CIRCUIT_BREAK_FAILURES = 8;

// ── Global bounds ────────────────────────────────────────────────────────────
/**
 * How many auto-scheduled scans may be in flight per namespace. The
 * NamespaceJobConcurrencyService caps worker slots globally, but nothing
 * stopped one namespace from filling every one of them with its own catch-up
 * runs — this is the per-tenant fair share.
 */
export const DEFAULT_MAX_CONCURRENT_AUTO_SCANS = 2;

/** Sources considered per tick. Bounded so one tick cannot walk a huge corpus. */
export const MAX_DUE_SOURCES_PER_TICK = 50;

/**
 * Floor an agent (or operator) may set for a STEADY interval. Guards against a
 * tuning agent writing `intervalSeconds: 30` and turning the adaptive scheduler
 * into a hot loop.
 */
export const MIN_AGENT_INTERVAL_SECONDS = 5 * 60;

export function maxConcurrentAutoScans(): number {
  const raw = process.env.AUTO_SCHEDULE_MAX_CONCURRENT;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_MAX_CONCURRENT_AUTO_SCANS;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `AUTO_SCHEDULE_MAX_CONCURRENT must be an integer >= 0 (got ${JSON.stringify(raw)})`,
    );
  }
  return value;
}
