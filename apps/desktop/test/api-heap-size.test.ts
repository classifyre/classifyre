/**
 * Unit test for the API process's V8 old-space budget.
 *
 * History matters here, because the obvious intuition is wrong twice over.
 * The original formula was `clamp(1024, RAM * 0.25, 2048)`, so every machine
 * with 8 GB or more got exactly 2 GB; a finding-dense scan hit that and the API
 * died with "Ineffective mark-compacts near heap limit". The fix raised the
 * ceiling to 6144 — and made things worse, in two ways that only show up on a
 * real machine:
 *
 *  1. Electron clamps --max-old-space-size to ~4 GB under ELECTRON_RUN_AS_NODE,
 *     so 6144 was never granted. Everything derived from it (the shed
 *     threshold) was therefore computed against a ceiling that did not exist.
 *  2. V8 schedules collection against the ceiling it is given, so the larger
 *     cap simply meant more garbage accumulated before a major GC. Measured
 *     mid-scan: old_space parked at ~3.1 GB while a forced full GC dropped the
 *     heap to 174 MB, and rss was 414 MB against a 3237 MB heap because the
 *     rest had been compressed and swapped out by the OS. The process then
 *     aborted on an allocation failure under that pressure.
 *
 * So these assertions pin the cap *down*, not up.
 *
 * Run with Node 22:
 *   npx tsx test/api-heap-size.test.ts
 */

import assert from "node:assert/strict";

import {
  computeApiHeapMb,
  namespaceJobConcurrency,
  DEFAULT_API_HEAP_MB,
  ELECTRON_MAX_OLD_SPACE_MB,
} from "../src/main/process-manager";

// Never request what the runtime will not grant: a returned value above the
// Electron clamp is silently reduced at spawn, which is how the ceiling and the
// guard drifted apart in the first place.
for (const [ram, workers] of [
  [4096, 2],
  [8192, 3],
  [16_384, 3],
  [34_359, 4],
  [131_072, 8],
] as const) {
  const heap = computeApiHeapMb(ram, workers);
  assert.ok(
    heap <= ELECTRON_MAX_OLD_SPACE_MB,
    `${heap} MB on a ${ram} MB machine exceeds what Electron grants`,
  );
}

// 34 GB / 4 detector workers: the configuration that crashed. A big machine
// must NOT translate into a big heap — that was the bug.
const large = computeApiHeapMb(34_359, 4);
assert.equal(large, DEFAULT_API_HEAP_MB, "large machines get the default cap");

// The cap does not scale with RAM at the top end: a 128 GB workstation and a
// 34 GB laptop get the same heap, because the live set is the same either way.
assert.equal(computeApiHeapMb(131_072, 8), computeApiHeapMb(34_359, 4));

// Mid-size machines are bounded by the same default, not by a fraction of RAM.
assert.equal(computeApiHeapMb(16_384, 3), DEFAULT_API_HEAP_MB);

// On a machine with little spare RAM the leftover budget binds instead of the
// default, so the renderer, Postgres and the Python detector workers keep their
// room rather than the API taking the whole machine.
assert.equal(computeApiHeapMb(7168, 3), 7168 - (2000 + 3 * 1200));
assert.ok(computeApiHeapMb(7168, 3) < DEFAULT_API_HEAP_MB);

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
assert.equal(computeApiHeapMb(1024, 4), 1024);

// More detector workers means less headroom for the API, not more — visible
// on machines small enough that the leftover budget is what binds.
assert.ok(computeApiHeapMb(8192, 4) < computeApiHeapMb(8192, 1));

// An explicit settings.json override wins over the default — that is the point
// of the escape hatch — but still cannot ask for more than Electron grants.
assert.equal(computeApiHeapMb(4096, 4, 3072), 3072);
assert.equal(computeApiHeapMb(34_359, 4, 1024), 1024);
assert.equal(computeApiHeapMb(34_359, 4, 8192), ELECTRON_MAX_OLD_SPACE_MB);

// 0 / undefined mean "automatic", not "no heap".
assert.equal(computeApiHeapMb(34_359, 4, 0), DEFAULT_API_HEAP_MB);
assert.equal(computeApiHeapMb(34_359, 4, undefined), DEFAULT_API_HEAP_MB);

console.log("api-heap-size: all assertions passed");

// Namespace job concurrency: the API default of 4 is sized for Kubernetes,
// where each worker is a pod with its own memory limit. On desktop one process
// serves every workspace, so four concurrent namespace jobs means four CLI
// processes with their own detector pools allocating into one shared heap.
assert.ok(
  namespaceJobConcurrency() >= 2,
  "one workspace must not block every other one",
);
assert.ok(
  namespaceJobConcurrency() < 4,
  "desktop must stay below the Kubernetes-sized default of 4",
);

console.log("namespace-job-concurrency: all assertions passed");
