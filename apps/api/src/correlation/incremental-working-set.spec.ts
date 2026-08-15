import { CorrelationService } from './correlation.service';

/**
 * The working-set expansion must de-duplicate in SQL, not in JS.
 *
 * Prisma applies `distinct` after the rows arrive, so `distinct: ['assetId']`
 * over a chunk of value hashes fetched every matching row and discarded the
 * duplicates in memory. On a corpus with hub values — one had values bound to
 * 4,872 assets apiece — a single chunk of 1,000 hashes pulled 803,341 rows to
 * yield 15,321 distinct assets, and every row became a UUID string on the
 * heap. A snapshot of the API taken mid-climb held 1.93 million UUID strings,
 * 550 MB of 731 MB, accumulated in about twenty seconds before it died of
 * "Ineffective mark-compacts near heap limit".
 *
 * The amplification is a property of the data, not of the code path's
 * frequency, so it cannot be tuned away — the de-duplication has to happen
 * where the rows are.
 */
describe('incrementalWorkingSet', () => {
  function harness() {
    const queries: string[] = [];
    const prisma = {
      $queryRaw: jest.fn((sql: { strings?: string[]; sql?: string }) => {
        const text = (sql.strings ?? [sql.sql ?? '']).join(' ');
        queries.push(text.replace(/\s+/g, ' ').trim());
        return Promise.resolve(
          /value_hash\s*$|SELECT DISTINCT value_hash/i.test(text) ||
            text.includes('DISTINCT value_hash')
            ? [{ value_hash: 'h1' }, { value_hash: 'h2' }]
            : [{ asset_id: 'a1' }, { asset_id: 'neighbour' }],
        );
      }),
      assetCorrelationValue: {
        findMany: jest.fn(() => {
          throw new Error(
            'must not use Prisma findMany+distinct: it de-duplicates in JS',
          );
        }),
      },
    };

    const service = Object.create(CorrelationService.prototype) as {
      incrementalWorkingSet: (ids: string[]) => Promise<string[]>;
    };
    Object.assign(service, { prisma });
    return { service, prisma, queries };
  }

  it('expands through shared values without a JS-side distinct', async () => {
    const h = harness();

    const working = await h.service['incrementalWorkingSet'](['a1']);

    // The touched asset plus everything sharing a value with it.
    expect(working).toEqual(expect.arrayContaining(['a1', 'neighbour']));
    expect(h.prisma.assetCorrelationValue.findMany).not.toHaveBeenCalled();
  });

  it('asks Postgres for distinct rows in both directions', async () => {
    const h = harness();

    await h.service['incrementalWorkingSet'](['a1']);

    // hashes for the touched assets, then owners of those hashes — both
    // de-duplicated by the database.
    expect(h.queries.some((q) => /SELECT DISTINCT value_hash/i.test(q))).toBe(
      true,
    );
    expect(h.queries.some((q) => /SELECT DISTINCT asset_id/i.test(q))).toBe(
      true,
    );
    expect(h.queries.every((q) => /SELECT DISTINCT/i.test(q))).toBe(true);
  });

  it('always includes the touched assets, even with no shared values', async () => {
    const h = harness();
    h.prisma.$queryRaw.mockImplementation(() => Promise.resolve([]));

    await expect(
      h.service['incrementalWorkingSet'](['a1', 'a2']),
    ).resolves.toEqual(expect.arrayContaining(['a1', 'a2']));
  });

  it('skips the owner query when an asset has no values', async () => {
    // An empty IN list is both pointless and invalid SQL.
    const h = harness();
    h.prisma.$queryRaw.mockImplementation((sql: { strings?: string[] }) => {
      const text = (sql.strings ?? []).join(' ');
      if (/value_hash/i.test(text) && /DISTINCT value_hash/i.test(text)) {
        return Promise.resolve([]);
      }
      throw new Error('owner query must not run for an empty hash list');
    });

    await expect(
      h.service['incrementalWorkingSet'](['lonely']),
    ).resolves.toEqual(['lonely']);
  });
});
