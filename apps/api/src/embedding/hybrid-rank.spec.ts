import { fuseHybridRanks } from './hybrid-rank';

const order = (ranked: Array<[string, number]>) => ranked.map(([id]) => id);

describe('fuseHybridRanks', () => {
  it('puts an asset both halves found above one only the meaning search found', () => {
    expect(
      order(
        fuseHybridRanks(
          [{ id: 'only-meaning' }, { id: 'both' }],
          [{ id: 'both' }],
          [],
        ),
      ),
    ).toEqual(['both', 'only-meaning']);
  });

  // The photograph Gemini Embedding 2 put first fell out of the first twelve
  // results: every passage sharing a word with the question had two terms.
  it('does not hold it against a picture that it has no words', () => {
    expect(
      order(
        fuseHybridRanks(
          [
            { id: 'ceiling-photo', media: true },
            { id: 'report' },
            { id: 'readings' },
          ],
          [{ id: 'readings' }, { id: 'report' }],
          [],
        ),
      ),
    ).toEqual(['ceiling-photo', 'readings', 'report']);
  });

  it('leaves a picture behind a passage both halves put near the top', () => {
    expect(
      order(
        fuseHybridRanks(
          [{ id: 'report' }, { id: 'photo', media: true }],
          [{ id: 'report' }],
          [],
        ),
      ),
    ).toEqual(['report', 'photo']);
  });

  it('counts a picture whose words did match only once for them', () => {
    // A whiteboard: found by its pixels and by the words OCR read on it.
    const [[, whiteboard]] = fuseHybridRanks(
      [{ id: 'whiteboard', media: true }],
      [{ id: 'whiteboard' }],
      [],
    );
    expect(whiteboard).toBeCloseTo(2 / 61);
  });

  it('adds a match on the name as a list of its own', () => {
    expect(
      order(fuseHybridRanks([{ id: 'a' }, { id: 'b' }], [], [{ id: 'b' }])),
    ).toEqual(['b', 'a']);
  });
});
