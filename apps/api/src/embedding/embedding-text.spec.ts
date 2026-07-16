import { embeddingContentHash, normalizeEmbeddingText } from './embedding-text';

describe('embedding text identity', () => {
  it('normalizes whitespace across context parts deterministically', () => {
    expect(normalizeEmbeddingText(' before\n', ' match ', '\tafter')).toBe(
      'before match after',
    );
    expect(embeddingContentHash(' before\n', ' match ', '\tafter')).toBe(
      '56e11ca0fe43cd8a8a9cca0827464992480a472f80eae078cffb0eb72e53e6be',
    );
  });

  it('includes context so repeated matched values remain distinguishable', () => {
    expect(embeddingContentHash('invoice', '1234', 'approved')).not.toBe(
      embeddingContentHash('ocr fragment', '1234', 'unreadable'),
    );
  });
});
