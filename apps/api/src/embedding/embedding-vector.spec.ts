import {
  MAX_INDEXED_DIMENSIONS,
  MAX_VECTOR_DIMENSIONS,
  vectorCast,
} from './embedding-vector';

/**
 * The dimension cap was pgvector's *index* limit used as a validation rule, so
 * the product rejected models it could serve perfectly well. Reported from a
 * live instance: `PUT /embeddings/settings` with nemotron-3-embed-1b (2,048)
 * answered "dimensions must be between 1 and 2000" — a 400 on a configuration
 * that pgvector stores and searches without complaint.
 *
 * The rule that has to hold: the index expression and the query expression
 * agree for every dimension count, because a silent disagreement means the
 * planner ignores the index and similarity search degrades to a sequential
 * scan that nobody is told about.
 */
describe('vectorCast', () => {
  it('indexes ordinary models as vector', () => {
    expect(vectorCast(384)).toEqual({
      type: 'vector',
      ops: 'public.vector_cosine_ops',
      indexed: true,
    });
    expect(vectorCast(2000).type).toBe('vector');
    expect(vectorCast(2000).indexed).toBe(true);
  });

  it('indexes the models the old cap rejected, via halfvec', () => {
    // The exact case from the bug report.
    expect(vectorCast(2048)).toEqual({
      type: 'halfvec',
      ops: 'public.halfvec_cosine_ops',
      indexed: true,
    });
    // text-embedding-3-large.
    expect(vectorCast(3072).type).toBe('halfvec');
    expect(vectorCast(MAX_INDEXED_DIMENSIONS).indexed).toBe(true);
  });

  it('stores but does not index beyond the halfvec ceiling', () => {
    const cast = vectorCast(MAX_INDEXED_DIMENSIONS + 1);
    expect(cast.indexed).toBe(false);
    // Still a usable cast: the query has to run, just without an index.
    expect(cast.type).toBe('vector');
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
