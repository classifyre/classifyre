import {
  MAX_INDEXED_DIMENSIONS,
  MAX_VECTOR_DIMENSIONS,
  vectorCast,
} from './embedding-vector';

/**
 * Two rules have to hold here.
 *
 * The index expression and the query expression must agree for every dimension
 * count, because a silent disagreement means the planner ignores the index and
 * similarity search degrades to a sequential scan that nobody is told about.
 *
 * And the dimension cap must stay a statement about *indexing*, not about what
 * the product will accept. It was once used as a validation rule, so a live
 * instance answered `PUT /embeddings/settings` with nemotron-3-embed-1b (2,048)
 * as "dimensions must be between 1 and 2000" -- a 400 on a configuration
 * pgvector stores and searches without complaint.
 */
describe('vectorCast', () => {
  it('stores every space at half precision', () => {
    // Two bytes a dimension instead of four, across the whole range. Measured
    // at 384 dimensions: 776 bytes a row against 1,544.
    for (const dim of [1, 384, 1536, 2000, 2048, 3072, 4000]) {
      expect(vectorCast(dim).type).toBe('halfvec');
    }
  });

  it('indexes ordinary models', () => {
    expect(vectorCast(384)).toEqual({
      type: 'halfvec',
      ops: 'public.halfvec_cosine_ops',
      indexed: true,
    });
    expect(vectorCast(2000).indexed).toBe(true);
  });

  it('indexes the models the old cap rejected', () => {
    // The exact case from the bug report, and text-embedding-3-large.
    expect(vectorCast(2048).indexed).toBe(true);
    expect(vectorCast(3072).indexed).toBe(true);
    expect(vectorCast(MAX_INDEXED_DIMENSIONS).indexed).toBe(true);
  });

  it('stores but does not index beyond the halfvec ceiling', () => {
    const cast = vectorCast(MAX_INDEXED_DIMENSIONS + 1);
    expect(cast.indexed).toBe(false);
    // Still a usable cast: the query has to run, just without an index.
    expect(cast.type).toBe('halfvec');
  });

  it('pairs every type with its own operator class', () => {
    for (const dim of [1, 384, 1536, 2000, 2001, 2048, 3072, 4000, 8000]) {
      const cast = vectorCast(dim);
      expect(cast.ops).toBe(`public.${cast.type}_cosine_ops`);
    }
  });

  it('keeps the storage ceiling above the index ceiling', () => {
    expect(MAX_VECTOR_DIMENSIONS).toBeGreaterThan(MAX_INDEXED_DIMENSIONS);
  });
});
