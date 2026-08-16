/**
 * The restart budget must not retire a service that demonstrably works.
 *
 * The budget is "3 crashes in 10 minutes", which is the right shape for a
 * crash-on-boot loop. The forgiveness rule used to be a 20-minute healthy-
 * uptime timer — twice the window — so it could never fire for a service
 * crashing more often than that, which is precisely the service that needs it.
 *
 * Observed on a real install: three crashes inside 90 seconds, then a
 * generation that served for eight minutes, and *its* death retired the API
 * permanently, because all three earlier timestamps were still inside the
 * 10-minute window. The user is shown "no longer being restarted
 * automatically" on a machine that had just run the service for eight minutes
 * straight, with a scan in flight.
 *
 * Judging by the dead generation's own uptime is what closes that gap.
 */
import assert from "node:assert/strict";

import {
  HEALTHY_RUN_MS,
  MAX_RESTARTS_PER_WINDOW,
  RESTART_WINDOW_MS,
  restartDecision,
} from "../src/main/process-manager";

const now = 1_000_000_000;
/** A death during boot — far below the healthy threshold. */
const bootCrash = 5_000;

// A first crash always earns a restart.
assert.equal(
  restartDecision({ now, crashes: [], uptimeMs: bootCrash }).restart,
  true,
);

// A genuine boot loop spends the budget and stops.
{
  let crashes: number[] = [];
  const attempts: number[] = [];
  for (let i = 0; i < MAX_RESTARTS_PER_WINDOW; i += 1) {
    const decision = restartDecision({
      now: now + i * 1000,
      crashes,
      uptimeMs: bootCrash,
    });
    assert.equal(decision.restart, true);
    attempts.push(decision.attempt);
    crashes = decision.crashes;
  }
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.equal(
    restartDecision({ now: now + 4000, crashes, uptimeMs: bootCrash }).restart,
    false,
    "a crash-on-boot loop must still degrade to a logged failure",
  );
}

// The install's exact scenario: a burst nine minutes ago, then eight minutes of
// service. The window has not expired and the old 20-minute timer never fired.
{
  const burst = [now - 9 * 60_000, now - 8.5 * 60_000, now - 8 * 60_000];
  const decision = restartDecision({
    now,
    crashes: burst,
    uptimeMs: 8 * 60_000,
  });

  assert.equal(
    decision.restart,
    true,
    "eight minutes of service is not a boot loop",
  );
  assert.equal(decision.attempt, 1);
  // Discarded, not carried forward — otherwise the very next crash retires it.
  assert.deepEqual(decision.crashes, [now]);
}

// Forgiveness is earned, not assumed: just short of the threshold still counts.
{
  const burst = [now - 3000, now - 2000, now - 1000];
  assert.equal(
    restartDecision({ now, crashes: burst, uptimeMs: HEALTHY_RUN_MS - 1 })
      .restart,
    false,
  );
  assert.equal(
    restartDecision({ now, crashes: burst, uptimeMs: HEALTHY_RUN_MS }).restart,
    true,
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
  assert.equal(decision.restart, true);
  assert.deepEqual(decision.crashes, [now]);
}

// A fault that kills the API every ~8 minutes must degrade to "restarts
// forever", not "dead until the user relaunches": the service is usable
// between crashes and the user has work in flight.
{
  let crashes: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const decision = restartDecision({
      now: now + i * 8 * 60_000,
      crashes,
      uptimeMs: 8 * 60_000,
    });
    assert.equal(decision.restart, true, `slow crash ${i} must be restarted`);
    crashes = decision.crashes;
  }
}

// …but once the restarts start dying on boot, the budget applies again.
{
  let crashes = [now];
  for (let i = 1; i <= MAX_RESTARTS_PER_WINDOW - 1; i += 1) {
    crashes = restartDecision({
      now: now + i * 1000,
      crashes,
      uptimeMs: bootCrash,
    }).crashes;
  }
  assert.equal(
    restartDecision({
      now: now + MAX_RESTARTS_PER_WINDOW * 1000,
      crashes,
      uptimeMs: bootCrash,
    }).restart,
    false,
  );
}

// The defect being fixed was a forgiveness threshold longer than the window,
// which made forgiveness unreachable for any service crashing often enough to
// need it.
assert.ok(
  HEALTHY_RUN_MS < RESTART_WINDOW_MS,
  "forgiveness must be reachable inside the crash window",
);

console.log("restart-budget: all assertions passed");
