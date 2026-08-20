/**
 * The supervisor must never leave the app running with a dead backend.
 *
 * Two earlier designs failed the same install in opposite directions:
 *
 *  - A 20-minute healthy-uptime timer (twice the crash window) meant a service
 *    crashing every eight minutes never earned forgiveness, so the fourth
 *    crash retired it permanently on a machine that had just demonstrated it
 *    could serve for eight minutes at a stretch.
 *  - Even with forgiveness judged from the dead generation's own uptime, a
 *    three-crash burst (heap exhaustion during one heavy scan will produce
 *    exactly that) still retired the API and put up "no longer being restarted
 *    automatically" over a window the user was working in.
 *
 * So the budget no longer decides *whether* to restart — only how fast, and
 * when to call the service degraded. What is tested here is that no input
 * sequence stops the restarts, and that a hot boot loop still backs off.
 */
import assert from "node:assert/strict";

import {
  HEALTHY_RUN_MS,
  MAX_RESTART_DELAY_MS,
  MAX_RESTARTS_PER_WINDOW,
  RESTART_WINDOW_MS,
  restartBackoffMs,
  restartDecision,
} from "../src/main/process-manager";

const now = 1_000_000_000;
/** A death during boot — far below the healthy threshold. */
const bootCrash = 5_000;

// A first crash restarts immediately-ish, and is not degraded.
{
  const decision = restartDecision({ now, crashes: [], uptimeMs: bootCrash });
  assert.equal(decision.attempt, 1);
  assert.equal(decision.degraded, false);
  assert.equal(decision.delayMs, restartBackoffMs(1));
}

// A crash-on-boot loop keeps restarting forever, backing off to the ceiling.
{
  let crashes: number[] = [];
  let last = restartDecision({ now, crashes, uptimeMs: bootCrash });
  for (let i = 0; i < 40; i += 1) {
    crashes = last.crashes;
    last = restartDecision({
      now: now + (i + 1) * 60_000,
      crashes,
      uptimeMs: bootCrash,
    });
    assert.ok(
      last.delayMs <= MAX_RESTART_DELAY_MS,
      "backoff must stay bounded so recovery is never hours away",
    );
  }
  assert.equal(
    last.delayMs,
    MAX_RESTART_DELAY_MS,
    "a sustained boot loop settles at the ceiling",
  );
  assert.equal(last.degraded, true, "and is reported as degraded");
}

// Degraded starts exactly one crash past the window's allowance — before that
// a short burst is routine and must not raise anything with the user.
{
  let crashes: number[] = [];
  for (let i = 0; i < MAX_RESTARTS_PER_WINDOW; i += 1) {
    const decision = restartDecision({
      now: now + i * 1000,
      crashes,
      uptimeMs: bootCrash,
    });
    assert.equal(decision.degraded, false, `attempt ${decision.attempt}`);
    crashes = decision.crashes;
  }
  assert.equal(
    restartDecision({ now: now + 4000, crashes, uptimeMs: bootCrash }).degraded,
    true,
  );
}

// The install's exact scenario: a burst nine minutes ago, then eight minutes of
// service. That generation's death is judged on its own.
{
  const burst = [now - 9 * 60_000, now - 8.5 * 60_000, now - 8 * 60_000];
  const decision = restartDecision({
    now,
    crashes: burst,
    uptimeMs: 8 * 60_000,
  });

  assert.equal(decision.attempt, 1, "eight minutes of service is not a loop");
  assert.equal(decision.degraded, false);
  assert.equal(decision.delayMs, restartBackoffMs(1), "and no penalty delay");
  // Discarded, not carried forward — otherwise the next crash reads as a burst.
  assert.deepEqual(decision.crashes, [now]);
}

// Forgiveness is earned, not assumed: just short of the threshold still counts.
{
  const burst = [now - 3000, now - 2000, now - 1000];
  assert.equal(
    restartDecision({ now, crashes: burst, uptimeMs: HEALTHY_RUN_MS - 1 })
      .attempt,
    4,
  );
  assert.equal(
    restartDecision({ now, crashes: burst, uptimeMs: HEALTHY_RUN_MS }).attempt,
    1,
  );
}

// Crashes older than the window stop counting.
{
  const old = [
    now - RESTART_WINDOW_MS - 1,
    now - RESTART_WINDOW_MS - 2,
    now - RESTART_WINDOW_MS - 3,
  ];
  const decision = restartDecision({ now, crashes: old, uptimeMs: bootCrash });
  assert.equal(decision.attempt, 1);
  assert.deepEqual(decision.crashes, [now]);
}

// The observed fault — OOM every ~20-90 minutes under a scan — must look like
// routine self-healing, never a degraded episode the user is told about.
{
  let crashes: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    const decision = restartDecision({
      now: now + i * 25 * 60_000,
      crashes,
      uptimeMs: 25 * 60_000,
    });
    assert.equal(decision.degraded, false, `slow crash ${i}`);
    assert.equal(decision.delayMs, restartBackoffMs(1));
    crashes = decision.crashes;
  }
}

// Backoff shape: doubling from the base, capped, and never zero.
{
  assert.ok(restartBackoffMs(1) > 0);
  assert.equal(restartBackoffMs(2), restartBackoffMs(1) * 2);
  assert.equal(restartBackoffMs(99), MAX_RESTART_DELAY_MS);
}

assert.ok(
  HEALTHY_RUN_MS < RESTART_WINDOW_MS,
  "forgiveness must be reachable inside the crash window",
);

console.log("restart-budget: all assertions passed");
