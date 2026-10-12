import {
  embeddingContentHash,
  normalizeEmbeddingText,
  windowsOntoOnePassage,
} from './embedding-text';

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

/**
 * Evidence is the match with the words round it, so two findings in one
 * sentence carry nearly the same text. That is one passage read twice, not a
 * passage that occurs twice, and only the second is a near-duplicate.
 */
describe('one passage or a repeat', () => {
  const name = {
    before: 'Yours sincerely,',
    matched: 'Corwin Aldous',
    after: 'Drying technician, on Monday',
  };
  const day = {
    before: 'Yours sincerely, Corwin Aldous Drying technician, on',
    matched: 'Monday',
    after: null,
  };

  it('sees two findings a few words apart as one passage', () => {
    expect(windowsOntoOnePassage(name, day)).toBe(true);
    expect(windowsOntoOnePassage(day, name)).toBe(true);
  });

  it('sees the same notice in two letters as a repeat', () => {
    const first = {
      before: 'write to us or phone',
      matched: '020 7946 0143',
      after: 'and we will come the same day. Yours sincerely,',
    };
    const second = {
      before: 'email us or ring',
      matched: '020 7946 0143',
      after: 'Somebody will be with you before the day is out.',
    };

    expect(windowsOntoOnePassage(first, second)).toBe(false);
  });

  it('is not misled by white space, or by a match too short to mean anything', () => {
    expect(
      windowsOntoOnePassage(
        { before: 'phone  020\n7946 0143 today', matched: 'Corwin', after: '' },
        { before: '', matched: '020 7946 0143', after: 'x' },
      ),
    ).toBe(true);
    expect(
      windowsOntoOnePassage(
        { before: 'page 3 of 40', matched: 'Hollowmere', after: '' },
        { before: 'page', matched: '3', after: 'of 41' },
      ),
    ).toBe(false);
  });
});
