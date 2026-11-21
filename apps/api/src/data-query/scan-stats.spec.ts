import { scanStatsOf } from './scan-stats';

describe('scan stats of a connector query', () => {
  it('keeps what the job sent about each live table', () => {
    expect(
      scanStatsOf([
        {
          table: 'lab_meilisearch.indexes.movies',
          requests: 1,
          rows: 632,
          pushed: ["genre = 'Drama'", 'year >= 2015'],
          ms: 41,
          scans: 1,
        },
      ]),
    ).toEqual([
      {
        table: 'lab_meilisearch.indexes.movies',
        requests: 1,
        rows: 632,
        pushed: ["genre = 'Drama'", 'year >= 2015'],
        ms: 41,
        scans: 1,
      },
    ]);
  });

  it('drops what is not a table entry, and anything but counts and text', () => {
    expect(scanStatsOf(undefined)).toEqual([]);
    expect(scanStatsOf({ table: 'x' })).toEqual([]);
    expect(
      scanStatsOf([
        null,
        { rows: 3 },
        {
          table: 's.t',
          requests: -1,
          rows: 'many',
          pushed: [1, 'a = 1'],
          extra: true,
        },
      ]),
    ).toEqual([
      {
        table: 's.t',
        requests: 0,
        rows: 0,
        pushed: ['a = 1'],
        ms: 0,
        scans: 0,
      },
    ]);
  });
});
