/**
 * Cold-mode (sleep/wake) policy for namespace background workers.
 *
 * Scans define activity: a namespace whose sources are not scanning anything —
 * no runs in flight, nothing recently finished, and no schedule that would
 * start one on its own — has no work for its workers, only cron overhead (the
 * per-minute auto-schedule tick, the 5-minute orphan reaper, the 15-minute
 * autopilot heartbeat, the embedding queue). Putting such a namespace to sleep
 * stops its pg-boss instance (5 pooled connections plus maintenance polling),
 * releases its Prisma background client, and stops every per-namespace cron
 * job from contending for the instance's global worker slots.
 *
 * Sleeping never suppresses real work, because the sleep condition requires
 * all of these at once:
 *  - no runner or source mid-scan,
 *  - no sources marked dirty for the autopilot,
 *  - no CRON-enabled or AUTO (non-paused) source that could start a scan
 *    on its own,
 *  - no scan finished within the idle window.
 *
 * Anything that creates activity — an operator or schedule starting a scan,
 * re-enabling a schedule, a scan finishing — wakes the namespace at the next
 * idle evaluation, which re-runs the full worker startup. The decision itself
 * is a pure function of a small activity snapshot so it can be unit-tested
 * without a database.
 */

export interface NamespaceActivitySnapshot {
  /** Runners in PENDING/RUNNING. */
  inFlightRunners: number;
  /** Sources with runnerStatus PENDING/RUNNING. */
  inFlightSources: number;
  /** Sources with autopilotDirtyAt set. */
  dirtySources: number;
  /** CRON-enabled sources plus AUTO sources outside PAUSED. */
  plannedSources: number;
  /** Newest runner triggeredAt, or null when the namespace never scanned. */
  latestRunnerAt: Date | null;
}

export interface NamespaceIdleDecision {
  idle: boolean;
  reason: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Decide whether a namespace's workers may sleep, from one activity snapshot. */
export function decideNamespaceIdle(
  snapshot: NamespaceActivitySnapshot,
  now: Date,
  idleAfterDays: number,
): NamespaceIdleDecision {
  if (snapshot.inFlightRunners > 0 || snapshot.inFlightSources > 0) {
    return { idle: false, reason: 'scans in flight' };
  }
  if (snapshot.dirtySources > 0) {
    return { idle: false, reason: 'autopilot work pending' };
  }
  if (snapshot.plannedSources > 0) {
    return { idle: false, reason: 'scheduled scans planned' };
  }
  if (!snapshot.latestRunnerAt) {
    return { idle: true, reason: 'never scanned' };
  }
  const idleMs = now.getTime() - snapshot.latestRunnerAt.getTime();
  if (idleMs < 0) {
    // Clock skew or a manually adjusted timestamp. Fail closed: an unknown
    // state must never put workers to sleep.
    return { idle: false, reason: 'latest scan timestamp is in the future' };
  }
  const age = formatAge(idleMs);
  if (idleMs >= idleAfterDays * MS_PER_DAY) {
    return { idle: true, reason: `last scan ${age} ago` };
  }
  return { idle: false, reason: `last scan ${age} ago` };
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export interface ColdModeConfig {
  enabled: boolean;
  idleAfterDays: number;
  checkMs: number;
}

/**
 * Cold-mode tuning from the environment.
 *
 *   NAMESPACE_COLD_MODE_ENABLED — master switch, default true.
 *   NAMESPACE_IDLE_AFTER_DAYS   — days without a scan before workers sleep,
 *     default 7. Accepts fractions for testing (0.002 ≈ 3 minutes). Zero or
 *     negative disables cold mode.
 *   NAMESPACE_IDLE_CHECK_MS     — how often worker pods re-evaluate idleness
 *     and wake sleeping namespaces, default 60000. Floored at 1000ms so a
 *     typo cannot turn the evaluator into a hot loop.
 */
export function coldModeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ColdModeConfig {
  const flag = (env.NAMESPACE_COLD_MODE_ENABLED ?? 'true').trim().toLowerCase();
  const flagOn = !['false', '0', 'no', 'off'].includes(flag);
  const idleAfterDays = parseNumber(env.NAMESPACE_IDLE_AFTER_DAYS, 7);
  const checkMs = Math.max(
    1000,
    Math.round(parseNumber(env.NAMESPACE_IDLE_CHECK_MS, 60_000)),
  );
  const enabled = flagOn && idleAfterDays > 0;
  return { enabled, idleAfterDays, checkMs };
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
