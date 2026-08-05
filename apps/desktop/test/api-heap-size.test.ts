/**
 * Unit test for the API process's V8 old-space budget.
 *
 * The previous formula was `clamp(1024, RAM * 0.25, 2048)`, so every machine
 * with 8 GB or more got exactly 2 GB and the RAM term never mattered. A
 * finding-dense scan hit that ceiling on a 34 GB laptop and the API died with
 * "Ineffective mark-compacts near heap limit", repeatedly. These assertions
 * exist so the ceiling cannot silently collapse back onto small machines.
 *
 * Run with Node 22:
 *   npx tsx test/api-heap-size.test.ts
 */

import assert from "node:assert/strict";

import { computeApiHeapMb } from "../src/main/process-manager";

// 34 GB / 4 detector workers: the configuration that crashed. Must land well
// above the old flat 2048 ceiling.
const large = computeApiHeapMb(34_359, 4);
assert.ok(large > 2048, `expected > 2048 MB on a 34 GB machine, got ${large}`);
assert.equal(large, 6144, "large machines are capped at the 6 GB ceiling");

// Mid-size machines scale between the floor and the ceiling rather than
// jumping straight to it — 35% of RAM binds here, not the 6 GB ceiling.
const mid = computeApiHeapMb(16_384, 3);
assert.ok(mid > 1024 && mid < 6144, `expected a scaled value, got ${mid}`);
assert.equal(mid, Math.floor(16_384 * 0.35));

// On a machine with little spare RAM the leftover budget binds instead.
assert.equal(computeApiHeapMb(8192, 3), 8192 - (2000 + 3 * 1200));

// Whatever binds, the API never gets more than a third of the machine.
for (const [ram, workers] of [
  [8192, 3],
  [16_384, 3],
  [34_359, 4],
] as const) {
  assert.ok(computeApiHeapMb(ram, workers) <= Math.floor(ram * 0.35));
}

// Small machines still get a bootable heap: the reservation must never push
// the result to zero or negative.
assert.equal(computeApiHeapMb(4096, 2), 1024);
assert.equal(computeApiHeapMb(2048, 1), 1024);

// More detector workers means less headroom for the API, not more — visible
// on machines small enough that the leftover budget is what binds.
assert.ok(computeApiHeapMb(8192, 4) < computeApiHeapMb(8192, 1));

// An explicit settings.json override wins outright, including above the
// automatic ceiling — that is the point of the escape hatch.
assert.equal(computeApiHeapMb(4096, 4, 8192), 8192);
assert.equal(computeApiHeapMb(34_359, 4, 3000), 3000);

// 0 / undefined mean "automatic", not "no heap".
assert.equal(computeApiHeapMb(34_359, 4, 0), 6144);
assert.equal(computeApiHeapMb(34_359, 4, undefined), 6144);

console.log("api-heap-size: all assertions passed");
