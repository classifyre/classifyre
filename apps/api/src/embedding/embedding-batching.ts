/**
 * How many texts may be handed to one inference call.
 *
 * The queue and the model disagree about what a "batch" is, and the gap
 * between them is what OOMKilled the worker. `EMBEDDING_BATCH_SIZE` is
 * pg-boss's *fetch* size (jobs per handler invocation) and
 * `EMBEDDING_QUEUE_BATCH_SIZE` is how many chunks are packed into one job, so
 * a single handler call flattened 32 x 64 ~= 2000 chunks and passed all of
 * them to the model at once. Measured on classifyre-dev: every such batch was
 * still `active` when the container died, at 4Gi, 6Gi and 8Gi alike.
 *
 * Row count alone does not bound the cost. Transformers.js tokenizes a batch
 * with `padding: true`, so every row is padded to the LONGEST row present and
 * an attention tensor costs `rows x heads x seq x seq x 4` bytes — for 2000
 * rows of ~300 tokens on MiniLM-L6 that is 8.6 GB for one tensor. The cost is
 * the PRODUCT of rows and the longest text, which is why this plans against
 * both: a group of 32 short chunks and a group of 4 long ones are the same
 * amount of memory, and either is survivable where their product is not.
 */
export interface InferenceBatchLimits {
  /** Hard ceiling on rows in one call. */
  maxRows: number;
  /** Ceiling on `rows x longest text`, the padded-tensor proxy. */
  maxPaddedChars: number;
}

/**
 * Split texts into groups that respect both limits, preserving input order.
 *
 * Order is part of the contract: callers zip the returned vectors back
 * against their inputs by index, so regrouping must never reorder. A single
 * text longer than the whole budget still goes out on its own rather than
 * being dropped or truncated — one oversized row is bounded by the model's
 * own 512-token truncation, and refusing it would silently lose a chunk.
 */
/** Fallbacks for a caller that passed nothing usable. See {@link planInferenceBatches}. */
const DEFAULT_MAX_ROWS = 32;
const DEFAULT_MAX_PADDED_CHARS = 64_000;

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) >= 1
    ? Math.floor(value as number)
    : fallback;
}

export function planInferenceBatches(
  texts: readonly string[],
  limits: InferenceBatchLimits,
): string[][] {
  // Clamped defensively rather than trusted: there is no global ValidationPipe,
  // the limits arrive from a per-workspace settings row that may be partial,
  // and a NaN ceiling would silently plan one enormous batch — reinstating the
  // exact failure this function exists to prevent.
  const maxRows = positive(limits.maxRows, DEFAULT_MAX_ROWS);
  const maxPaddedChars = positive(
    limits.maxPaddedChars,
    DEFAULT_MAX_PADDED_CHARS,
  );
  const batches: string[][] = [];
  let current: string[] = [];
  let longest = 0;

  for (const text of texts) {
    const length = text.length;
    const nextLongest = Math.max(longest, length);
    const fits =
      current.length < maxRows &&
      (current.length + 1) * nextLongest <= maxPaddedChars;
    // `current.length === 0` is checked second on purpose: an oversized text
    // opens a fresh group and is emitted alone, never merged into one that is
    // already accumulating short rows.
    if (current.length > 0 && !fits) {
      batches.push(current);
      current = [];
      longest = 0;
    }
    current.push(text);
    longest = Math.max(longest, length);
  }
  if (current.length) batches.push(current);
  return batches;
}
