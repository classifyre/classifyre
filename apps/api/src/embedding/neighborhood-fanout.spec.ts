import { EmbeddingService } from './embedding.service';

/**
 * A neighbourhood is computed per (content hash, finding type), not per finding.
 *
 * The query used to read `FROM findings target`, returning one row per finding
 * per neighbour. A content hash is shared by many findings — measured on a real
 * corpus at 391 on average and 6,344 at the worst — so a batch of 500 findings
 * dissolved into roughly 156,000 targets and ~1.5M rows in a single result set.
 * That is how a bounded-looking batch allocated gigabytes and killed the API
 * with "Ineffective mark-compacts near heap limit" every few minutes.
 *
 * Nothing about the answer depends on which finding is asked: the candidate
 * filter is on finding_type, so all findings sharing a (hash, type) get the
 * same neighbours. Computing once and fanning out is identical output from
 * ~400 rows instead of ~1.5M.
 */
describe('neighbourhood fan-out', () => {
  function harness(seeds: unknown[], findingPages: unknown[][]) {
    const queryRaw = jest.fn((..._args: unknown[]) => Promise.resolve(seeds));
    const pages = [...findingPages];
    const findMany = jest.fn((..._args: unknown[]) =>
      Promise.resolve(pages.shift() ?? []),
    );
    const service = Object.create(EmbeddingService.prototype) as {
      calibrateNeighborhood: (
        space: { id: string; dim: number },
        hashes: string[],
      ) => Promise<void>;
      findingPagesForHashes: (hashes: string[]) => AsyncGenerator<unknown[]>;
    };
    const calibrated: string[][] = [];
    Object.assign(service, {
      config: { hnswEfSearch: 40 },
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      analysis: {},
      prisma: {
        finding: { findMany },
        findingEvidenceAnalysis: {
          // The ids reaching this call are exactly the findings the
          // neighbourhood was fanned out to.
          findMany: jest.fn((args: any) => {
            calibrated.push(args?.where?.findingId?.in ?? []);
            return Promise.resolve([]);
          }),
          upsert: jest.fn(() => Promise.resolve({})),
        },
        $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
          fn({ $executeRaw: jest.fn(), $queryRaw: queryRaw }),
        ),
      },
      spaceIdLiteral: (id: string) => id,
    });
    return { service, queryRaw, findMany, calibrated };
  }

  it('asks the database for distinct hash/type pairs, not per finding', async () => {
    const h = harness([], [[]]);

    await h.service.calibrateNeighborhood({ id: 'space-1', dim: 384 }, ['h1']);

    const sql = (
      h.queryRaw.mock.calls[0]?.[0] as { strings?: string[] }
    )?.strings?.join(' ');
    expect(sql).toMatch(/SELECT DISTINCT embed_content_hash, finding_type/);
    // The old shape — a row per finding — must not come back.
    expect(sql).not.toMatch(/FROM findings target/);
    expect(sql).not.toMatch(/target\.id AS "findingId"/);
  });

  it('gives every finding sharing a hash and type the same neighbours', async () => {
    // The case that used to multiply: one hash, many findings.
    const seeds = [
      {
        targetHash: 'h1',
        findingType: 'PERSON',
        neighborHash: 'n1',
        score: 0.9,
      },
      {
        targetHash: 'h1',
        findingType: 'PERSON',
        neighborHash: 'n2',
        score: 0.8,
      },
    ];
    const findings = Array.from({ length: 5 }, (_, i) => ({
      id: `finding-${i}`,
      embedContentHash: 'h1',
      findingType: 'PERSON',
    }));
    const h = harness(seeds, [findings, []]);

    await h.service.calibrateNeighborhood({ id: 'space-1', dim: 384 }, ['h1']);

    // Two rows fetched, five findings calibrated — the fan-out happens here,
    // not in the result set.
    expect(h.queryRaw).toHaveBeenCalledTimes(1);
    expect(h.calibrated[0]).toHaveLength(5);
  });

  it('does not mix neighbours between finding types on the same hash', async () => {
    const seeds = [
      {
        targetHash: 'h1',
        findingType: 'PERSON',
        neighborHash: 'n-person',
        score: 0.9,
      },
      {
        targetHash: 'h1',
        findingType: 'EMAIL',
        neighborHash: 'n-email',
        score: 0.9,
      },
    ];
    const findings = [
      { id: 'f-person', embedContentHash: 'h1', findingType: 'PERSON' },
      { id: 'f-email', embedContentHash: 'h1', findingType: 'EMAIL' },
    ];
    const h = harness(seeds, [findings, []]);

    await h.service.calibrateNeighborhood({ id: 'space-1', dim: 384 }, ['h1']);

    expect(h.calibrated[0]).toEqual(
      expect.arrayContaining(['f-person', 'f-email']),
    );
  });

  it('skips findings whose hash and type produced no neighbours', async () => {
    const seeds = [
      {
        targetHash: 'h1',
        findingType: 'PERSON',
        neighborHash: 'n1',
        score: 0.9,
      },
    ];
    const findings = [
      { id: 'has-neighbours', embedContentHash: 'h1', findingType: 'PERSON' },
      { id: 'no-neighbours', embedContentHash: 'h2', findingType: 'PERSON' },
    ];
    const h = harness(seeds, [findings, []]);

    await h.service.calibrateNeighborhood({ id: 'space-1', dim: 384 }, [
      'h1',
      'h2',
    ]);

    expect(h.calibrated[0]).toEqual(['has-neighbours']);
  });

  it('yields findings a page at a time and retains none of them', async () => {
    // 6,344 findings shared one hash on the corpus that triggered this. Paging
    // only the read was not enough — the rows were still accumulated into one
    // array, and a snapshot at the fatal moment showed 7.8M UUID strings live.
    // A generator hands each page over and keeps nothing.
    const page = Array.from({ length: 2000 }, (_, i) => ({
      id: `f-${i}`,
      embedContentHash: 'h1',
      findingType: 'PERSON',
    }));
    const h = harness([], [page, page, []]);

    let pages = 0;
    let biggestHeld = 0;
    for await (const yielded of h.service.findingPagesForHashes(['h1'])) {
      pages++;
      biggestHeld = Math.max(biggestHeld, yielded.length);
    }

    // Two pages of data; the third query comes back empty and ends the walk.
    expect(pages).toBe(2);
    expect(h.findMany).toHaveBeenCalledTimes(3);
    // Never more than one page in hand, whatever the total.
    expect(biggestHeld).toBe(2000);
    // Paged with a cursor rather than a growing offset.
    expect(
      (h.findMany.mock.calls[1]?.[0] as { cursor?: unknown })?.cursor,
    ).toBeDefined();
  });

  it('does nothing when given no hashes', async () => {
    const h = harness([], [[]]);

    await h.service.calibrateNeighborhood({ id: 'space-1', dim: 384 }, []);

    expect(h.queryRaw).not.toHaveBeenCalled();
  });
});
