/**
 * How a space's vectors are stored, indexed, and compared.
 *
 * Everything is `halfvec` — half precision, two bytes a dimension instead of
 * four. pgvector stores up to 16,000 dimensions either way; what differs is
 * size. Measured on a 879,135-row space at 384 dimensions:
 * `pg_column_size(vec)` was 1,544 bytes against 776 for the same vector as
 * `halfvec`, and the table and its HNSW index together were 3,757 MB.
 *
 * This is the one deliberately lossy trade in the storage work, so it is worth
 * being precise about the cost. float16 carries about three decimal digits.
 * Embedding components live in [-1, 1] and the metric is cosine, so the
 * ordering of neighbours is effectively unchanged — but it *is* an
 * approximation, not a free win, and a space that needs exact float32
 * reconstruction is not served by this.
 *
 * Half precision was already the path for 2,001–4,000 dimensions, because
 * that is the only way pgvector can index them at all (the `vector` HNSW
 * ceiling is 2,000; halfvec raises it to 4,000). Using one representation
 * everywhere removes the branch rather than adding one.
 *
 * Above 4,000 nothing can be indexed. Vectors are still stored and still
 * searched correctly, but by sequential scan — so the space reports itself as
 * unindexed rather than pretending the search will be fast.
 *
 * The index expression and every ORDER BY expression must agree exactly, or
 * the planner silently ignores the index — hence one function, used by both.
 */
export function vectorCast(dim: number): {
  type: 'vector' | 'halfvec';
  ops: string;
  indexed: boolean;
} {
  return {
    type: 'halfvec',
    ops: 'public.halfvec_cosine_ops',
    indexed: dim <= MAX_INDEXED_DIMENSIONS,
  };
}

/** pgvector's hard storage ceiling for a single vector. */
export const MAX_VECTOR_DIMENSIONS = 16000;
/** Largest dimension count an HNSW index can cover (via halfvec). */
export const MAX_INDEXED_DIMENSIONS = 4000;
