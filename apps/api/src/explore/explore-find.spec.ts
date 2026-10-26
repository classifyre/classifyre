import { rankFindHits } from './explore-find';

const meant = (id: string, score: number) => ({
  id,
  score,
  page: null,
  text: `${id} passage`,
});

describe('rankFindHits', () => {
  it('puts what was typed first: the name, then the words of a passage', () => {
    const hits = rankFindHits({
      named: ['invoice'],
      worded: [{ id: 'letter', page: 2, text: 'the invoice was late' }],
      meant: [meant('letter', 0.7), meant('invoice', 0.6), meant('memo', 0.65)],
    });
    expect(hits.map((h) => [h.id, h.how])).toEqual([
      ['invoice', 'name'],
      ['letter', 'words'],
      ['memo', 'meaning'],
    ]);
    // A word match keeps its meaning score, for the list.
    expect(hits[1]).toMatchObject({ score: 0.7, page: 2, lit: true });
  });

  it('lights only what stands out from the canvas by meaning', () => {
    const hits = rankFindHits({
      named: [],
      worded: [],
      meant: [
        meant('a', 0.82),
        meant('b', 0.8),
        meant('c', 0.41),
        meant('d', 0.4),
        meant('e', 0.39),
      ],
    });
    expect(hits.filter((h) => h.lit).map((h) => h.id)).toEqual(['a', 'b']);
    expect(hits).toHaveLength(5);
  });

  it('finds nothing in nothing', () => {
    expect(rankFindHits({ named: [], worded: [], meant: [] })).toEqual([]);
  });
});
