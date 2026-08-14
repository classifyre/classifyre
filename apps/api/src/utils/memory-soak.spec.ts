/**
 * Memory soak: proves output capture is bounded, on any machine.
 *
 * The trick that makes this portable is the tiny heap. Run under
 * `--max-old-space-size=128`, code whose retention is proportional to input
 * cannot survive 200 MB of CLI output — it OOMs — while bounded code finishes
 * with room to spare. So the test asserts a *property* (retention does not
 * track input volume) rather than a megabyte figure tied to the machine that
 * happened to run it. It therefore means the same thing on a 64 GB CI runner,
 * an 8 GB Windows laptop, and a memory-capped container.
 *
 * This is the regression that took the desktop API down repeatedly: heap
 * exhaustion during a long scan of a large corpus.
 *
 * Two ways to run it, and only the first proves the portability claim:
 *   bun run test:soak   — standalone under a 128 MB heap (the real check)
 *   bun test            — as part of the unit suite, at the runner's heap size,
 *                         where the invariance assertions still hold but the
 *                         small-heap survival property is not exercised.
 */

import assert from 'node:assert/strict';

import { BoundedOutput } from './bounded-output';

const MB = 1024 * 1024;

/** Heap in use after a best-effort full collection. */
function settledHeapMb(): number {
  if (typeof global.gc === 'function') {
    global.gc();
    global.gc();
  }
  return process.memoryUsage().heapUsed / MB;
}

/** One CLI log line of roughly the shape a scan emits. */
function scanLine(i: number): string {
  return (
    `INFO:src.pipeline.detector_pipeline:   asset_${i} page 1: 14 findings ` +
    `in 102ms — snippet: ${'sample document text '.repeat(20)}\n`
  );
}

export function runSoak(totalLines: number): {
  retainedKb: number;
  heapGrowthMb: number;
  bytesFed: number;
} {
  const before = settledHeapMb();
  const out = new BoundedOutput({ mode: 'tail' });

  let bytesFed = 0;
  for (let i = 0; i < totalLines; i++) {
    const line = scanLine(i);
    bytesFed += line.length;
    out.append(line);
  }
  out.finish();

  const retained = out.toString();
  const heapGrowthMb = settledHeapMb() - before;
  return {
    retainedKb: retained.length / 1024,
    heapGrowthMb,
    bytesFed,
  };
}

// Registered only under a test runner: the same file doubles as a standalone
// script (see the bottom), which is how it gets run under a custom heap flag.
const suite = typeof describe === 'function' ? describe : () => undefined;

suite('memory soak: CLI output capture', () => {
  // Deliberately large: at ~500 bytes/line this feeds ~200 MB through, well
  // past what a 128 MB heap could retain.
  const HEAVY_LINES = 400_000;

  it('retains a bounded excerpt regardless of how much the CLI writes', () => {
    const light = runSoak(4_000);
    const heavy = runSoak(HEAVY_LINES);

    // Sanity: the heavy run really did push far more through.
    expect(heavy.bytesFed).toBeGreaterThan(50 * MB);
    expect(heavy.bytesFed / light.bytesFed).toBeGreaterThan(50);

    // The property under test: 50x the input, same retention.
    expect(heavy.retainedKb).toBeLessThan(300);
    expect(Math.abs(heavy.retainedKb - light.retainedKb)).toBeLessThan(4);
  });

  it('does not grow the heap in proportion to the output volume', () => {
    const { heapGrowthMb, bytesFed } = runSoak(HEAVY_LINES);

    expect(bytesFed).toBeGreaterThan(50 * MB);
    // Generous, because it must hold on every platform and GC schedule — but
    // far below the hundreds of MB that unbounded accumulation would need.
    expect(heapGrowthMb).toBeLessThan(32);
  });

  it('survives when the CLI never emits a newline', () => {
    const out = new BoundedOutput({ mode: 'tail' });
    for (let i = 0; i < 200_000; i++) out.append('x'.repeat(1000)); // ~200 MB
    out.finish();

    expect(out.toString().length).toBeLessThan(300 * 1024);
  });
});

// Standalone mode: `npx tsx test/memory-soak.test.ts` under a small heap.
if (require.main === module) {
  const light = runSoak(4_000);
  const heavy = runSoak(400_000);
  console.log(
    `light: fed ${(light.bytesFed / MB).toFixed(1)} MB, retained ${light.retainedKb.toFixed(1)} KB, heap +${light.heapGrowthMb.toFixed(1)} MB`,
  );
  console.log(
    `heavy: fed ${(heavy.bytesFed / MB).toFixed(1)} MB, retained ${heavy.retainedKb.toFixed(1)} KB, heap +${heavy.heapGrowthMb.toFixed(1)} MB`,
  );
  assert.ok(heavy.retainedKb < 300, 'retention must stay bounded');
  assert.ok(
    Math.abs(heavy.retainedKb - light.retainedKb) < 4,
    'retention must not track input volume',
  );
  console.log('memory-soak: all assertions passed');
}
