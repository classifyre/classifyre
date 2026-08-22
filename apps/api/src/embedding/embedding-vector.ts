/**
 * How a space's vectors are cast for indexing and for distance queries.
 *
 * pgvector stores up to 16,000 dimensions in a `vector`, but its HNSW index
 * covers only the first 2,000 — and `halfvec` (half precision, added in
 * pgvector 0.7) raises that index ceiling to 4,000. The product previously
 * refused anything above 2,000 outright, which rejected perfectly ordinary
 * modern models: nemotron-3-embed-1b is 2,048, text-embedding-3-large is
 * 3,072. Those are storable and searchable; they just need the halfvec index.
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
  if (dim <= 2000) {
    return { type: 'vector', ops: 'public.vector_cosine_ops', indexed: true };
  }
  if (dim <= 4000) {
    return { type: 'halfvec', ops: 'public.halfvec_cosine_ops', indexed: true };
  }
  return { type: 'vector', ops: 'public.vector_cosine_ops', indexed: false };
}

/** pgvector's hard storage ceiling for a single vector. */
export const MAX_VECTOR_DIMENSIONS = 16000;
/** Largest dimension count an HNSW index can cover (via halfvec). */
export const MAX_INDEXED_DIMENSIONS = 4000;
