import { AgentTriggerMode } from '@prisma/client';
import type { AgentPolicy } from './missions';

/** What kicked this evaluation off. */
export type CycleTrigger =
  | 'scan'
  | 'express'
  | 'manual'
  | 'schedule'
  /**
   * The supervisor decided this agent should run now.
   *
   * Treated like a manual trigger by the policy and only by the policy: timing
   * is precisely what the supervisor is for, so gates and guardrails yield to
   * it. What does NOT yield is the operator's enable switch — that is checked
   * separately, and a commanded run of a disabled agent still does nothing.
   * Keeping the two apart is the whole reason this is not just `manual`.
   */
  | 'commanded';

/**
 * The state of the instance, gathered once per cycle and shared by every agent.
 *
 * Gathered once on purpose: each of these is a query, and asking per agent
 * turned a five-agent cycle into fifteen round trips for facts that cannot
 * meaningfully change between two agents starting a second apart.
 */
export interface ReadinessSignals {
  /** Inquiry matching has queued, active or deferred work. */
  matchingBusy: boolean;
  /** At least one source is currently scanning. */
  scansActive: boolean;
  /** OPEN findings, and how many of them carry an importance score. */
  coverage: { open: number; analyzed: number };
  /** Floor/ratio the evidence gate is judged against. */
  evidence: { usableFindings: number; usableCoverage: number };
}

export interface PolicyInput {
  policy: AgentPolicy;
  signals: ReadinessSignals;
  trigger: CycleTrigger;
  /** When this agent last started, or null if never. */
  lastTriggeredAt: Date | null;
  now: Date;
}

export interface PolicyDecision {
  run: boolean;
  /** Why, in operator-readable words. Surfaced in logs and the audit trail. */
  reason: string;
}

/**
 * Whether the evidence base is solid enough to reason from.
 *
 * Two thresholds, either of which suffices. The absolute floor is the honest
 * question — a corpus with two thousand scored findings has a real ranking
 * regardless of how many more are pending — and the ratio is the fallback for
 * corpora too small to reach it. Judged before the gate rather than inside it
 * so the numbers can be reported either way.
 */
export function evidenceUsable(signals: ReadinessSignals): boolean {
  const { open, analyzed } = signals.coverage;
  // Nothing to score is not the same as nothing scored: an instance with no
  // semantic stack still needs its agents to run.
  if (open === 0) return true;
  if (analyzed >= signals.evidence.usableFindings) return true;
  return analyzed / open >= signals.evidence.usableCoverage;
}

/** Minutes since `since`, or null when it never happened. */
function minutesSince(now: Date, since: Date | null): number | null {
  if (!since) return null;
  return (now.getTime() - since.getTime()) / 60_000;
}

/**
 * Decide whether one agent may start.
 *
 * Pure, and deliberately so: the behaviour that matters here only shows up
 * across combinations of queue state, corpus coverage and elapsed time, and
 * pinning that with a database in the loop would be slow enough that nobody
 * would pin all of it.
 *
 * Order is load-bearing:
 *
 *  1. A manual trigger runs, always. An operator pressing the button and
 *     watching nothing happen is worse than any resource this protects.
 *  2. The minimum-gap floor, which even an express event does not pierce —
 *     otherwise a burst of source completions spawns a run apiece, which on
 *     184 completions a day is the stampede the floor exists to stop.
 *  3. The staleness backstop, which overrides the gates below. This is the
 *     liveness guarantee: without it, an agent gated on a queue that never
 *     drains simply never runs. The mechanism it replaces — a requeue counter
 *     that had to reach five — never once fired on a live instance, because a
 *     fresh cycle landing in the same coalescing slot reset the count.
 *  4. The trigger mode, then the gates.
 */
export function shouldRun(input: PolicyInput): PolicyDecision {
  const { policy, signals, trigger, lastTriggeredAt, now } = input;

  if (trigger === 'manual') return { run: true, reason: 'triggered manually' };
  if (trigger === 'commanded') {
    return { run: true, reason: 'commanded by the supervisor' };
  }

  const idleMinutes = minutesSince(now, lastTriggeredAt);

  if (
    policy.minIntervalMinutes > 0 &&
    idleMinutes !== null &&
    idleMinutes < policy.minIntervalMinutes
  ) {
    return {
      run: false,
      reason: `ran ${Math.floor(idleMinutes)}m ago, below the ${policy.minIntervalMinutes}m minimum gap`,
    };
  }

  const stale =
    policy.maxStalenessHours > 0 &&
    (idleMinutes === null || idleMinutes >= policy.maxStalenessHours * 60);

  if (policy.triggerMode === AgentTriggerMode.MANUAL) {
    return { run: false, reason: 'set to run only when triggered manually' };
  }

  if (policy.triggerMode === AgentTriggerMode.SCHEDULED) {
    // Its own schedule enqueues it; a scan cycle is not its trigger. The
    // backstop still applies so a broken schedule cannot silence it forever.
    if (trigger === 'schedule') return { run: true, reason: 'on schedule' };
    if (stale) {
      return { run: true, reason: 'has not run within its staleness window' };
    }
    return { run: false, reason: 'runs on its own schedule' };
  }

  if (stale) {
    return {
      run: true,
      reason:
        idleMinutes === null
          ? 'has never run'
          : `has not run for ${Math.floor(idleMinutes / 60)}h, past its staleness window`,
    };
  }

  const blocked = closedGate(policy, signals);
  if (blocked) return { run: false, reason: blocked };

  if (
    policy.triggerMode === AgentTriggerMode.SETTLED &&
    trigger === 'express'
  ) {
    // An express event is by definition a single new signal, which is the
    // opposite of the settled whole-corpus view this mode exists to wait for.
    return { run: false, reason: 'waits for a settled corpus, not one event' };
  }

  return { run: true, reason: 'ready' };
}

/** The first gate holding this agent back, or null when all are satisfied. */
function closedGate(
  policy: AgentPolicy,
  signals: ReadinessSignals,
): string | null {
  if (policy.waitForScans && signals.scansActive) {
    return 'waiting for scans in progress to finish';
  }
  if (policy.waitForMatching && signals.matchingBusy) {
    return 'waiting for inquiry matching to drain';
  }
  if (policy.waitForEvidence && !evidenceUsable(signals)) {
    const { analyzed, open } = signals.coverage;
    return `waiting for evidence analysis (${analyzed} of ${open} findings scored)`;
  }
  return null;
}
