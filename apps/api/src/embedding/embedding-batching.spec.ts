import { planInferenceBatches } from './embedding-batching';

/**
 * The worker was OOMKilled in a loop by one inference call.
 *
 * Measured on classifyre-dev (2026-09-07), a single namespace, one forked
 * onnxruntime: the cgroup went 729 MB -> 8192 MB in 85 seconds and was killed
 * at the ceiling, at 4Gi, 6Gi and 8Gi alike. The container held 32 pg-boss
 * jobs of 64 chunks each — ~2000 texts — and passed all of them to one
 * `extractor()` call. Every one of those batches was still `active` in
 * pg-boss when the container died; none ever completed.
 *
 * transformers.js tokenizes with `padding: true`, so a batch pads to its
 * longest row and one attention tensor costs `rows x heads x seq x seq x 4`.
 * At 2000 rows of ~300 tokens on MiniLM-L6 that is 8.6 GB — for one tensor,
 * natively, where `--max-old-space-size` cannot reach it.
 */
describe('planInferenceBatches', () => {
  const limits = { maxRows: 32, maxPaddedChars: 64_000 };

  it('splits the ~2000-text fetch that killed the worker', () => {
    const texts = Array.from({ length: 2000 }, () => 'x'.repeat(558));
    const batches = planInferenceBatches(texts, limits);

    expect(batches).toHaveLength(63);
    // Never the whole fetch, and never more than the row ceiling.
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(32);
    expect(batches.flat()).toHaveLength(2000);
  });

  it('narrows the batch as texts get longer, because padding is the cost', () => {
    const short = planInferenceBatches(
      Array.from({ length: 64 }, () => 'x'.repeat(100)),
      limits,
    );
    const long = planInferenceBatches(
      Array.from({ length: 64 }, () => 'x'.repeat(8000)),
      limits,
    );

    // A row-count limit alone would give both the same batch size while their
    // padded footprints differ by 80x.
    expect(short[0]).toHaveLength(32);
    expect(long[0]).toHaveLength(8);
    for (const batch of [...short, ...long]) {
      const longest = Math.max(...batch.map((text) => text.length));
      expect(batch.length * longest).toBeLessThanOrEqual(64_000);
    }
  });

  it('bounds a mixed batch by the longest text in it, not the average', () => {
    // One long chunk among short ones pads every row up to its length, so it
    // must not be allowed to ride along inside a full 32-row group.
    const texts = [
      ...Array.from({ length: 31 }, () => 'x'.repeat(50)),
      'x'.repeat(60_000),
      ...Array.from({ length: 31 }, () => 'x'.repeat(50)),
    ];
    const batches = planInferenceBatches(texts, limits);

    expect(batches[0]).toHaveLength(31);
    expect(batches[1]).toEqual(['x'.repeat(60_000)]);
    expect(batches.flat()).toEqual(texts);
  });

  it('preserves order so callers can zip vectors back by index', () => {
    const texts = Array.from({ length: 100 }, (_, index) => `chunk-${index}`);
    expect(planInferenceBatches(texts, limits).flat()).toEqual(texts);
  });

  it('emits an oversized text alone rather than dropping it', () => {
    // Bounded downstream by the model's own 512-token truncation. Refusing it
    // here would silently lose a chunk the corpus needs.
    const huge = 'x'.repeat(500_000);
    expect(planInferenceBatches([huge], limits)).toEqual([[huge]]);
  });

  it('returns nothing for no texts', () => {
    expect(planInferenceBatches([], limits)).toEqual([]);
  });
});
