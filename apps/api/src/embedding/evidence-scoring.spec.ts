import { EmbeddingAnalysisService } from './embedding-analysis.service';
import type { PrismaService } from '../prisma.service';

/**
 * Two properties of evidence scoring that were each wrong for a different
 * reason, and that a change to one can easily break in the other.
 *
 * 1. A value carried by a handful of assets is a cross-document lead even when
 *    the findings are byte-identical. The old gate required `similarCount === 0`
 *    on the reasoning that identical context means a copied template — true for
 *    prose, false for structured extraction, where a shared field has identical
 *    context by construction. On the Firmenbuch corpus that denied the reason to
 *    147,823 analyses, 90,570 of them company numbers averaging 4.8 assets.
 *
 * 2. The *bonus* follows the *reason*. Awarding the +0.12 to the wider set
 *    puts ~68k findings over the old 0.75 bar (nearly all company numbers),
 *    so the express lane and the unmonitored-evidence signal were re-tuned to
 *    0.85 in the same change — see the calibration doc. The scores below are
 *    pinned to the numbers the bonus-inclusive formula produces: touching the
 *    bonus without updating them fails here first.
 */
describe('evidence scoring', () => {
  const SPACE = 'space-1';
  const HASH = 'hash-a';
  /** `normalizeValue` lowercases; 10 characters either way. */
  const VALUE = 'FN 123456a';

  let prisma: {
    finding: { groupBy: jest.Mock; findMany: jest.Mock };
    findingEvidenceAnalysis: { upsert: jest.Mock; update: jest.Mock };
  };
  let service: EmbeddingAnalysisService;

  /** Corpus-wide spread of the value: four assets, two sources. */
  const recurrence = new Map([['fn 123456a', { assets: 4, sources: 2 }]]);

  const findingRow = (evidenceAnalysis: unknown = null) => ({
    id: 'finding-1',
    embedContentHash: HASH,
    severity: 'INFO',
    confidence: 1,
    matchedContent: VALUE,
    contextBefore: null,
    contextAfter: null,
    evidenceAnalysis,
  });

  /**
   * Set up a cohort of `occurrences` findings sharing the hash, of which the
   * page returns one.
   */
  const givenCohort = (occurrences: number, analysis: unknown = null) => {
    prisma.finding.groupBy.mockResolvedValue([
      { embedContentHash: HASH, _count: { _all: occurrences } },
    ]);
    prisma.finding.findMany.mockResolvedValue([findingRow(analysis)]);
  };

  const written = () => prisma.findingEvidenceAnalysis.upsert.mock.calls[0][0];

  beforeEach(() => {
    prisma = {
      finding: { groupBy: jest.fn(), findMany: jest.fn() },
      findingEvidenceAnalysis: {
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    service = new EmbeddingAnalysisService(prisma as unknown as PrismaService);
  });

  describe('cross-document recurrence', () => {
    it('credits a value spanning several assets even inside a duplicate group', async () => {
      givenCohort(4);

      await service.analyzeHashes(SPACE, [HASH], recurrence);

      const reasons = written().create.reasons as { c: string; n?: number }[];
      expect(reasons.map((r) => r.c)).toEqual([
        'readable_context',
        'duplicate_group',
        'cross_document_recurrence',
        'severity_separate',
      ]);
      expect(reasons.find((r) => r.c === 'cross_document_recurrence')).toEqual({
        c: 'cross_document_recurrence',
        n: 4,
        n2: 2,
      });
    });

    it('pays the bonus for it — the reason and the score move together', async () => {
      givenCohort(4);

      await service.analyzeHashes(SPACE, [HASH], recurrence);

      // quality 1 * 0.3 + confidence 1 * 0.2 + novelty (1/sqrt 4) 0.5 * 0.25
      //   + context (10/320) 0.03125 * 0.15 + severity INFO 0.15 * 0.1
      // = 0.6446875, plus RECURRENCE_BONUS 0.12 = 0.7646875.
      expect(written().create.importanceScore).toBe(0.765);
    });

    it('still pays the bonus when the finding is the only one of its kind', async () => {
      givenCohort(1);

      await service.analyzeHashes(SPACE, [HASH], recurrence);

      // Same terms with novelty 1, plus the 0.12 the lead earns.
      expect(written().create.importanceScore).toBe(0.89);
      const reasons = written().create.reasons as { c: string }[];
      expect(reasons.map((r) => r.c)).toContain('unique_evidence');
    });

    it('withholds it from a value that spans the corpus', async () => {
      givenCohort(4);

      await service.analyzeHashes(
        SPACE,
        [HASH],
        new Map([['fn 123456a', { assets: 8403, sources: 2 }]]),
      );

      const reasons = written().create.reasons as { c: string }[];
      expect(reasons.map((r) => r.c)).not.toContain(
        'cross_document_recurrence',
      );
      expect(reasons.map((r) => r.c)).toContain('common_value');
    });
  });

  describe('unchanged analyses are left alone', () => {
    /** Exactly what the first pass writes for `givenCohort(4)`. */
    const settled = {
      spaceId: SPACE,
      importanceScore: 0.765,
      qualityScore: 1,
      similarCount: 3,
      duplicateGroupHash: HASH,
      reasons: [
        { c: 'readable_context' },
        { c: 'duplicate_group', n: 3 },
        { c: 'cross_document_recurrence', n: 4, n2: 2 },
        { c: 'severity_separate', s: 'info' },
      ],
      signals: {
        contextScore: 0.031,
        noveltyScore: 0.5,
        detectorConfidence: 1,
        crossAssetCount: 4,
        crossSourceCount: 2,
        valueLength: 10,
        duplicateSimilarity: 1,
      },
    };

    it('stamps analyzedAt instead of rewriting the row', async () => {
      givenCohort(4, settled);

      await service.analyzeHashes(SPACE, [HASH], recurrence);

      expect(prisma.findingEvidenceAnalysis.upsert).not.toHaveBeenCalled();
      const [args] = prisma.findingEvidenceAnalysis.update.mock.calls[0];
      // Only analyzedAt: leaving importanceScore out of the SET list is what
      // keeps trg_sync_finding_importance_score from firing, and with it the
      // cascading single-row UPDATE on findings.
      expect(Object.keys(args.data)).toEqual(['analyzedAt']);
      expect(args.where).toEqual({ findingId: 'finding-1' });
    });

    it('is not fooled by JSONB key order', async () => {
      // Postgres normalises JSONB key order, so a row read back does not come
      // out in the order it went in. Comparing raw JSON here reported every row
      // as changed and skipped nothing.
      const shuffled = {
        ...settled,
        signals: Object.fromEntries(
          Object.entries(settled.signals).reverse(),
        ) as typeof settled.signals,
      };
      givenCohort(4, shuffled);

      await service.analyzeHashes(SPACE, [HASH], recurrence);

      expect(prisma.findingEvidenceAnalysis.upsert).not.toHaveBeenCalled();
    });

    it('rewrites when the score actually moved', async () => {
      givenCohort(4, { ...settled, importanceScore: 0.51 });

      await service.analyzeHashes(SPACE, [HASH], recurrence);

      expect(prisma.findingEvidenceAnalysis.upsert).toHaveBeenCalledTimes(1);
    });

    /**
     * Analysis and calibration mean different things by `duplicateGroupHash`:
     * analysis writes the finding's own content hash, calibration writes the
     * near-duplicate component's root. Both used to write unconditionally, so
     * each pass saw the other's value as a change and rewrote the row — 130,489
     * analyses on one namespace, 21.6% of the table, never converged.
     */
    it('leaves a calibration component root alone instead of fighting it', async () => {
      const componentRoot = 'component-root-hash';
      givenCohort(4, { ...settled, duplicateGroupHash: componentRoot });

      await service.analyzeHashes(SPACE, [HASH], recurrence);

      // Reproduces what is stored, so the comparison reads equal and the row
      // is not rewritten. Without this the two phases take turns forever.
      expect(prisma.findingEvidenceAnalysis.upsert).not.toHaveBeenCalled();
    });

    it('still seeds the group when nothing has claimed the row', async () => {
      givenCohort(4, { ...settled, duplicateGroupHash: null });

      await service.analyzeHashes(SPACE, [HASH], recurrence);

      expect(written().update.duplicateGroupHash).toBe(HASH);
    });

    it('clears a group it owns once the duplicates are gone', async () => {
      // Its own hash, so analysis owns it — and there is nothing left to group.
      givenCohort(1, { ...settled, duplicateGroupHash: HASH });

      await service.analyzeHashes(SPACE, [HASH], recurrence);

      expect(written().update.duplicateGroupHash).toBeNull();
    });

    it('does not clear a component root it never owned', async () => {
      // Same "no exact duplicates" case, but the group came from calibration:
      // the finding can be alone on its content hash and still belong to a
      // near-duplicate component.
      givenCohort(1, { ...settled, duplicateGroupHash: 'component-root-hash' });

      await service.analyzeHashes(SPACE, [HASH], recurrence);

      expect(written().update.duplicateGroupHash).toBe('component-root-hash');
    });

    it('rewrites a legacy row, which is how its reasons get compacted', async () => {
      givenCohort(4, {
        ...settled,
        reasons: [
          {
            code: 'readable_context',
            label: 'Readable supporting context',
            impact: 'up',
          },
        ],
      });

      await service.analyzeHashes(SPACE, [HASH], recurrence);

      expect(prisma.findingEvidenceAnalysis.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('the rows budget', () => {
    it('stops at the cap and reports what it reached', async () => {
      prisma.finding.groupBy.mockResolvedValue([
        { embedContentHash: HASH, _count: { _all: 56405 } },
      ]);
      // One page standing in for a register-wide cohort: 500 seed findings
      // expand to every member, which is the runaway the budget exists for.
      prisma.finding.findMany.mockResolvedValue(
        Array.from({ length: 100 }, (_, i) => ({
          ...findingRow(),
          id: `finding-${i}`,
        })),
      );

      const visited = await service.analyzeHashes(
        SPACE,
        [HASH],
        recurrence,
        40,
      );

      expect(visited).toBe(40);
      expect(prisma.findingEvidenceAnalysis.upsert).toHaveBeenCalledTimes(40);
    });

    it('reports every row it visited when the budget is not binding', async () => {
      givenCohort(4);

      expect(await service.analyzeHashes(SPACE, [HASH], recurrence)).toBe(1);
    });
  });
});
