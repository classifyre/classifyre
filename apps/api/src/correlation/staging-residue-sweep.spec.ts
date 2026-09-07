import { CorrelationService } from './correlation.service';

/**
 * `correlation_pair_staging` is scratch: `stagePairAggregates` fills it with
 * the pairwise-overlap aggregation, the scoring loop streams it back into
 * edges, and it is cleared again before the recompute returns. Nothing else in
 * the codebase reads it, and it is excluded from namespace export.
 *
 * The clearing used to live only in a `finally`, keyed on a `runId` generated
 * per invocation. That is enough for a thrown error and not enough for a
 * SIGKILL: an OOM kill takes the process down without running `finally`, and
 * the `runId` that would have matched those rows died with it. The rows become
 * unreachable and permanent. On a worker stuck in an OOM-restart loop this
 * stranded 37 runs and 50M rows — 17 GB, two thirds of the database — behind a
 * correlation output of a few hundred MB.
 *
 * These tests pin the recovery: the next recompute sweeps whatever the last
 * one left behind, and the happy path releases its space rather than leaving
 * dead tuples for autovacuum.
 */
describe('correlation staging residue', () => {
  function harness(stranded: { runId: string } | null) {
    const executed: string[] = [];
    const order: string[] = [];
    const warnings: string[] = [];

    const prisma = {
      correlationPairStaging: {
        findFirst: jest.fn(() => Promise.resolve(stranded)),
        findMany: jest.fn(() => Promise.resolve([])),
        deleteMany: jest.fn(() => {
          throw new Error(
            'DELETE leaves millions of dead tuples behind; use TRUNCATE',
          );
        }),
      },
      edge: {
        deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
        createMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      $queryRaw: jest.fn(() => Promise.resolve([{ estimate: 50386248n }])),
      $executeRaw: jest.fn(
        (sql: TemplateStringsArray | { strings?: string[] }) => {
          // A tagged-template call hands the mock the TemplateStringsArray
          // itself, not a Prisma.Sql object.
          const parts = Array.isArray(sql)
            ? Array.from(sql as ArrayLike<string>)
            : ((sql as { strings?: string[] }).strings ?? []);
          const text = parts.join(' ').replace(/\s+/g, ' ').trim();
          executed.push(text);
          order.push('truncate');
          return Promise.resolve(1);
        },
      ),
    };

    const service = Object.create(CorrelationService.prototype);
    Object.assign(service, {
      prisma,
      batches: { streamPage: 2000 },
      logger: { warn: (m: string) => warnings.push(m), log: () => undefined },
      incrementalWorkingSet: () => Promise.resolve([]),
      loadAssetTotals: () => Promise.resolve(new Map()),
      stagePairAggregates: jest.fn(() => {
        order.push('stage');
        return Promise.resolve();
      }),
      scorePhoneticCandidates: () =>
        Promise.resolve({
          relatedPairs: 0,
          duplicatePairs: 0,
          topMatch: null,
          affectedAssetIds: [],
        }),
    });

    const cfg = {
      relatedMin: 0.3,
      duplicateMin: 0.6,
      defaultWeight: 1,
      rawWeights: {},
      weightOf: () => 1,
    };
    return { service, prisma, executed, order, warnings, cfg };
  }

  it('truncates rows stranded by a recompute that was killed mid-pass', async () => {
    const h = harness({ runId: '2276adbd-3a9a-466a-8c54-538510b1bc02' });

    await h.service['sweepStagingResidue']();

    expect(
      h.executed.some((q) =>
        /TRUNCATE TABLE correlation_pair_staging/i.test(q),
      ),
    ).toBe(true);
    // The operator has to be able to see this happening: a sweep that keeps
    // firing means recomputes keep dying, which is the actual defect.
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toContain('50386248');
    expect(h.warnings[0]).toContain('2276adbd-3a9a-466a-8c54-538510b1bc02');
  });

  it('does nothing, and stays silent, when the scratch table is already empty', async () => {
    const h = harness(null);

    await h.service['sweepStagingResidue']();

    expect(h.executed).toEqual([]);
    expect(h.warnings).toEqual([]);
    // COUNT(*) here would scan the very table whose size is the problem.
    expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("sweeps before staging, so a run never scores a dead run's pairs", async () => {
    const h = harness({ runId: 'stale-run' });

    await h.service['scoreAndLink']([], h.cfg, true);

    expect(h.order.indexOf('truncate')).toBeLessThan(h.order.indexOf('stage'));
  });

  it('releases its scratch space on the happy path instead of deleting rows', async () => {
    const h = harness(null);

    await h.service['scoreAndLink']([], h.cfg, true);

    // deleteMany throws in this harness: a full recompute stages millions of
    // rows, and DELETE neither reclaims the space nor avoids the autovacuum
    // debt. The `finally` must TRUNCATE.
    expect(h.prisma.correlationPairStaging.deleteMany).not.toHaveBeenCalled();
    expect(h.executed.filter((q) => /TRUNCATE/i.test(q))).toHaveLength(1);
  });
});
