import { EmbeddingService } from './embedding.service';
import type { PrismaService } from '../prisma.service';
import type { EmbeddingAnalysisService } from './embedding-analysis.service';

/**
 * Evidence scoring under continuous ingestion.
 *
 * `recalibrateSpace` walked every embedded finding in `id asc` order. Because
 * `id` is a random UUID that is not insertion order, each pass re-scored an
 * arbitrary prefix and never reached the findings nobody had scored yet. A live
 * instance mid-ingestion sat at 27% coverage — 35,667 analyses against 131,905
 * open findings, the gap widening — and every investigation agent stood down
 * citing unscored evidence, in those words:
 *
 *   "findings are substantive yet unscored, and no case/inquiry can be created"
 *
 * Unscored findings are now scored first, so coverage climbs monotonically and
 * a pass cut short still leaves the system better off than it found it.
 */
describe('evidence recalibration prioritises unscored findings', () => {
  const space = { id: 'space-1', dim: 384 };

  let findMany: jest.Mock;
  let analyzeHashes: jest.Mock;
  let service: EmbeddingService;

  const finding = (id: string) => ({ id, embedContentHash: `h-${id}` });

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    analyzeHashes = jest.fn().mockResolvedValue(undefined);
    service = new EmbeddingService(
      {
        embeddingSpace: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(space),
          update: jest.fn().mockResolvedValue(space),
        },
        finding: { findMany },
      } as unknown as PrismaService,
      {} as never,
      {
        analyzeHashes,
        valueRecurrenceSnapshot: jest.fn().mockResolvedValue({}),
      } as unknown as EmbeddingAnalysisService,
    );
    // Neighbourhood calibration issues raw vector SQL; not what this is about.
    jest
      .spyOn(service as never, 'calibrateNeighborhood')
      .mockResolvedValue(undefined as never);
  });

  /** The `where` of every finding query the pass issued, in order. */
  const queries = () => findMany.mock.calls.map((call) => call[0]);

  it('asks for never-analyzed findings before anything else', async () => {
    await service.recalibrateSpace('space-1');

    expect(queries()[0].where).toMatchObject({
      embedContentHash: { not: null },
      evidenceAnalysis: { is: null },
    });
  });

  it('refreshes existing scores only after the unscored are done', async () => {
    findMany
      .mockResolvedValueOnce([finding('a')]) // unscored batch, short → phase ends
      .mockResolvedValue([]);

    await service.recalibrateSpace('space-1');

    const refresh = queries().find(
      (q) => q.where.evidenceAnalysis?.isNot === null,
    );
    expect(refresh).toBeDefined();
    // Stalest first, so successive passes rotate through the corpus instead of
    // re-refreshing the same prefix forever.
    expect(refresh.orderBy).toEqual({
      evidenceAnalysis: { analyzedAt: 'asc' },
    });
  });

  // The bug in one assertion: paging forward with a cursor skips rows that
  // enter the set behind it, which under continuous ingestion is the entire
  // corpus tail. Processing a row removes it from the set instead.
  it('never pages with a cursor', async () => {
    findMany
      .mockResolvedValueOnce(
        Array.from({ length: 500 }, (_, i) => finding(`a${i}`)),
      )
      .mockResolvedValue([]);

    await service.recalibrateSpace('space-1');

    for (const query of queries()) {
      expect(query.cursor).toBeUndefined();
    }
  });

  it('keeps scoring unscored findings until none are left', async () => {
    const full = Array.from({ length: 500 }, (_, i) => finding(`a${i}`));
    findMany
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([finding('tail')])
      .mockResolvedValue([]);

    const { analyzed } = await service.recalibrateSpace('space-1');

    expect(analyzed).toBe(1001);
  });

  // An unbounded refresh over a corpus that grows every two minutes never
  // returns, and the next pass's unscored phase never starts.
  it('bounds the refresh phase so a pass always terminates', async () => {
    const full = Array.from({ length: 500 }, (_, i) => finding(`a${i}`));
    // No unscored work; the refresh phase would otherwise loop forever.
    findMany.mockImplementation(
      (args: { where: { evidenceAnalysis?: unknown } }) =>
        Promise.resolve(
          (args.where.evidenceAnalysis as { is?: null })?.is === null
            ? []
            : full,
        ),
    );

    const { analyzed } = await service.recalibrateSpace('space-1');

    expect(analyzed).toBe(500 * 20);
  });
});
