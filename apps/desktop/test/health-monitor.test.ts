/**
 * The watchdog exists for the failures that produce no process exit, which is
 * everything the crash supervisor cannot see: a postmaster killed by the OS
 * (the app still believes it started one) and an API that is up but no longer
 * serving. Both leave a "running" app that does nothing.
 *
 * What matters is that it does not over-react — one failed probe during a GC
 * pause must not restart a working service — and that it never stacks a
 * recovery on top of a recovery.
 */
import assert from "node:assert/strict";

import {
  API_FAILURES_BEFORE_RESTART,
  DB_FAILURES_BEFORE_RESTART,
  HealthMonitor,
} from "../src/main/health-monitor";

interface World {
  monitor: HealthMonitor;
  state: {
    db: boolean;
    api: boolean;
    watchable: boolean;
    now: number;
    dbRecoveries: number;
    apiRestarts: number;
    recoverError: Error | null;
  };
}

function world(): World {
  const state = {
    db: true,
    api: true,
    watchable: true,
    now: 1_000_000,
    dbRecoveries: 0,
    apiRestarts: 0,
    recoverError: null as Error | null,
  };
  const monitor = new HealthMonitor({
    apiBaseUrl: () => "http://127.0.0.1:8000",
    isWatchable: () => state.watchable,
    pingDatabase: () => Promise.resolve(state.db),
    probeApi: () => Promise.resolve(state.api),
    recoverDatabase: async () => {
      if (state.recoverError) throw state.recoverError;
      state.dbRecoveries += 1;
      state.db = true;
    },
    restartApi: async () => {
      state.apiRestarts += 1;
      state.api = true;
    },
    now: () => state.now,
    log: () => {},
  });
  return { monitor, state };
}

async function ticks(w: World, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await w.monitor.tick();
}

// tsx compiles these to CJS, where top-level await is unavailable.
async function main(): Promise<void> {

  // A healthy system is never touched.
  {
    const w = world();
    await ticks(w, 10);
    assert.equal(w.state.apiRestarts, 0);
    assert.equal(w.state.dbRecoveries, 0);
  }

  // A single failed API probe is not an outage; the threshold is.
  {
    const w = world();
    w.state.api = false;
    await ticks(w, API_FAILURES_BEFORE_RESTART - 1);
    assert.equal(w.state.apiRestarts, 0, "must tolerate transient probe failures");
    await w.monitor.tick();
    assert.equal(w.state.apiRestarts, 1);
  }

  // Recovering resets the count, so intermittent blips never accumulate into a
  // restart of a service that is working.
  {
    const w = world();
    for (let i = 0; i < 6; i += 1) {
      w.state.api = i % 2 === 0;
      await w.monitor.tick();
    }
    assert.equal(w.state.apiRestarts, 0);
  }

  // After acting, the monitor goes quiet: a cold API boot takes minutes and its
  // probes would otherwise trigger a restart on top of the restart.
  {
    const w = world();
    w.state.api = false;
    await ticks(w, API_FAILURES_BEFORE_RESTART);
    assert.equal(w.state.apiRestarts, 1);
    w.state.api = false; // still coming up
    await ticks(w, 20);
    assert.equal(w.state.apiRestarts, 1, "grace period must suppress probes");

    w.state.now += 5 * 60_000; // grace expired, still dead
    await ticks(w, API_FAILURES_BEFORE_RESTART);
    assert.equal(w.state.apiRestarts, 2, "…but not forever");
  }

  // A dead database is fixed at the database, not by restarting the API against
  // a database that is not there.
  {
    const w = world();
    w.state.db = false;
    w.state.api = false;
    await ticks(w, DB_FAILURES_BEFORE_RESTART);
    assert.equal(w.state.dbRecoveries, 1);
    assert.equal(w.state.apiRestarts, 0, "the API is not the fault here");
  }

  // A failed recovery retries on the slow loop instead of hammering.
  {
    const w = world();
    w.state.db = false;
    w.state.recoverError = new Error("port still held");
    await ticks(w, DB_FAILURES_BEFORE_RESTART + 10);
    assert.equal(w.state.dbRecoveries, 0);
    w.state.recoverError = null;
    w.state.now += 5 * 60_000;
    await ticks(w, DB_FAILURES_BEFORE_RESTART);
    assert.equal(w.state.dbRecoveries, 1, "and recovers once the cause clears");
  }

  // Nothing is probed while the app is starting, quitting, or already restarting
  // on the supervisor's own schedule.
  {
    const w = world();
    w.state.watchable = false;
    w.state.db = false;
    w.state.api = false;
    await ticks(w, 20);
    assert.equal(w.state.apiRestarts, 0);
    assert.equal(w.state.dbRecoveries, 0);

    // …and the failure count starts clean once it is watchable again.
    w.state.watchable = true;
    w.state.db = true;
    await ticks(w, API_FAILURES_BEFORE_RESTART - 1);
    assert.equal(w.state.apiRestarts, 0);
  }

  console.log("health-monitor: all assertions passed");
}

void main();
