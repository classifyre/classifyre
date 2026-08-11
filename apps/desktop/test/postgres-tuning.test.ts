/**
 * Unit test for the embedded Postgres memory budget.
 *
 * `shared_buffers` was a hardcoded 256MB regardless of machine size. On a 57 GB
 * corpus that gave the hottest findings index a 4% cache hit ratio — a single
 * dashboard count re-read 266 MB from disk on every execution because the
 * buffer pool could not hold one index — and evicted the system catalog often
 * enough that cold planning of a trivial count measured 13.3 s against 0.068 ms
 * warm. These assertions exist so the value cannot silently collapse back to a
 * constant, and so it can never grow large enough to starve the API heap it
 * shares a machine with.
 *
 * Run with Node 22:
 *   npx tsx test/postgres-tuning.test.ts
 */

import assert from "node:assert/strict";

import { computePostgresTuning } from "../src/main/postgres-manager";
import { computeApiHeapMb } from "../src/main/process-manager";

// 34 GB / 4 detector workers: the machine the slow-query investigation ran on.
// Must be dramatically above the old flat 256MB.
const large = computePostgresTuning(34_359, 4);
assert.ok(
  large.sharedBuffersMb > 256,
  `expected > 256 MB on a 34 GB machine, got ${large.sharedBuffersMb}`,
);
assert.equal(
  large.sharedBuffersMb,
  4096,
  "large machines are capped at the 4 GB ceiling",
);

// Mid-size machines scale rather than jumping straight to the ceiling.
const mid = computePostgresTuning(16_384, 3);
assert.ok(
  mid.sharedBuffersMb > 256 && mid.sharedBuffersMb < 4096,
  `expected a scaled value, got ${mid.sharedBuffersMb}`,
);

// Never more than an eighth of the machine, whichever term binds.
for (const [ram, workers] of [
  [8192, 3],
  [16_384, 3],
  [34_359, 4],
] as const) {
  const { sharedBuffersMb } = computePostgresTuning(ram, workers);
  assert.ok(
    sharedBuffersMb <= Math.floor(ram * 0.12),
    `${sharedBuffersMb} MB exceeds 12% of ${ram} MB`,
  );
}

// Small machines never regress below the previous fixed value, even when the
// reservation for the API and detector workers consumes everything.
assert.equal(computePostgresTuning(4096, 2).sharedBuffersMb, 256);
assert.equal(computePostgresTuning(2048, 1).sharedBuffersMb, 256);

// More detector workers means less headroom for Postgres, not more.
assert.ok(
  computePostgresTuning(16_384, 4).sharedBuffersMb <=
    computePostgresTuning(16_384, 1).sharedBuffersMb,
);

// effective_cache_size is a planner hint about total cache (PG + OS), so it
// must always exceed what PG itself reserves or the planner under-estimates
// caching and abandons index plans on the large findings tables.
for (const [ram, workers] of [
  [4096, 2],
  [8192, 3],
  [16_384, 3],
  [34_359, 4],
] as const) {
  const { sharedBuffersMb, effectiveCacheSizeMb } = computePostgresTuning(
    ram,
    workers,
  );
  assert.ok(
    effectiveCacheSizeMb >= sharedBuffersMb,
    `effective_cache_size ${effectiveCacheSizeMb} < shared_buffers ${sharedBuffersMb}`,
  );
}

// The two budgets share one machine and must not jointly over-commit it.
// Postgres reserves shared_buffers up front and the API can reach its heap cap,
// so their sum has to leave room for the OS, the UI and the detector workers.
for (const [ram, workers] of [
  [8192, 3],
  [16_384, 3],
  [34_359, 4],
] as const) {
  const pg = computePostgresTuning(ram, workers).sharedBuffersMb;
  const api = computeApiHeapMb(ram, workers);
  assert.ok(
    pg + api <= Math.floor(ram * 0.5),
    `pg ${pg} + api ${api} exceeds half of ${ram} MB`,
  );
}

console.log("postgres-tuning: all assertions passed");
