import { CorrelationReviewService } from './correlation-review.service';
import type { PrismaService } from '../../prisma.service';
import { valueHash } from '../value-normalizer';

/**
 * The bulk exclusion a "rule candidate" pattern promises.
 *
 * A near-duplicate text pattern is built from an embedding group, and its
 * signature rows carry an EMPTY label array — so the original `excludeLabel`
 * parameter had nothing on the pattern to feed it, and the header offered a
 * fix the screen could not perform. What is actually excludable are the values
 * inside the template, re-derived from the group's findings.
 */
describe('pattern exclusion', () => {
  const prisma = {
    correlationPattern: { findUnique: jest.fn() },
    correlationReviewBatch: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    correlationPairVerdict: { createMany: jest.fn(), deleteMany: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const correlation = {
    addExclusions: jest.fn(),
    removeExclusions: jest.fn(),
    scheduleFullRecompute: jest.fn(),
    recomputeForAssets: jest.fn(),
  };
  const service = new CorrelationReviewService(
    prisma as unknown as PrismaService,
    correlation as never,
    {} as never,
    {} as never,
  );

  const FOOTER_HASH = valueHash('email', 'support@acme.example');
  const NAME_HASH = valueHash('person', 'acme legal team');

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.$transaction.mockResolvedValue([]);
    correlation.scheduleFullRecompute.mockResolvedValue(undefined);
    correlation.removeExclusions.mockResolvedValue({});
  });

  describe('candidates', () => {
    const boilerplate = {
      patternKey: 'boilerplate:4f2a91c0',
      ruleKind: 'EXCLUSION',
      labels: [],
    };

    /** findings in the group, then owner counts, then the pairs-driven count. */
    const wireReads = (opts?: {
      owners?: Array<{ value_hash: string; assets: number }>;
    }) => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { finding_type: 'email', matched_content: ' Support@ACME.example ' },
          { finding_type: 'person', matched_content: 'ACME  Legal   Team' },
          // Same value again from another copy of the template: one candidate.
          { finding_type: 'email', matched_content: 'support@acme.example' },
        ])
        .mockResolvedValueOnce(
          opts?.owners ?? [
            { value_hash: FOOTER_HASH, assets: 412 },
            { value_hash: NAME_HASH, assets: 88 },
          ],
        )
        .mockResolvedValueOnce([{ count: BigInt(1290) }]);
    };

    it('re-derives the values inside the template, deduplicated and normalised', async () => {
      prisma.correlationPattern.findUnique.mockResolvedValue(boilerplate);
      wireReads();

      const res = await service.exclusionCandidates('boilerplate:4f2a91c0');

      expect(res.candidates).toHaveLength(2);
      // Normalised the way the indexer stored it — trimmed, lowercased,
      // internal whitespace collapsed — or the rule would match nothing.
      expect(res.candidates[0]).toMatchObject({
        label: 'email',
        value: 'support@acme.example',
        valueHash: FOOTER_HASH,
        assetCount: 412,
      });
      expect(res.candidates[1]).toMatchObject({
        label: 'person',
        value: 'acme legal team',
      });
    });

    it('reports the pairs the template drives ELSEWHERE, not the pattern size', async () => {
      prisma.correlationPattern.findUnique.mockResolvedValue(boilerplate);
      wireReads();

      const res = await service.exclusionCandidates('boilerplate:4f2a91c0');

      // The pattern's own pairs come from embedding similarity and survive the
      // exclusion. The number worth showing is the shared-value matches the
      // template causes in other patterns.
      expect(res.pairsDriven).toBe(1290);
    });

    it('drops values only one asset holds — those are not boilerplate', async () => {
      prisma.correlationPattern.findUnique.mockResolvedValue(boilerplate);
      wireReads({
        owners: [
          { value_hash: FOOTER_HASH, assets: 412 },
          { value_hash: NAME_HASH, assets: 1 },
        ],
      });

      const res = await service.exclusionCandidates('boilerplate:4f2a91c0');

      expect(res.candidates.map((c) => c.valueHash)).toEqual([FOOTER_HASH]);
      expect(res.totalCandidates).toBe(1);
    });

    it('returns nothing for a pattern with no template to read', async () => {
      prisma.correlationPattern.findUnique.mockResolvedValue({
        patternKey: 'email+person',
        ruleKind: 'JUDGEMENT',
        labels: ['email', 'person'],
      });

      const res = await service.exclusionCandidates('email+person');

      expect(res.candidates).toEqual([]);
      // No query is worth running: only EXCLUSION patterns have a group.
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    beforeEach(() => {
      prisma.correlationPattern.findUnique.mockResolvedValue({
        patternKey: 'boilerplate:4f2a91c0',
        ruleKind: 'EXCLUSION',
        labels: [],
      });
    });

    /** In call order: the pattern's target pairs, the hash lookup, workRemaining. */
    const wireApply = () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { a_id: 'a', b_id: 'b', weighted: '0.42', cluster_id: 'c1' },
        ])
        .mockResolvedValueOnce([
          { label: 'email', normalized_value: 'support@acme.example' },
          { label: 'person', normalized_value: 'acme legal team' },
        ])
        .mockResolvedValueOnce([{ count: BigInt(7) }]);
    };

    it('writes one value rule per chosen hash, in a single config write', async () => {
      wireApply();
      correlation.addExclusions.mockResolvedValue({
        added: [{ id: 'r1' }, { id: 'r2' }],
      });

      const res = await service.applyPattern('boilerplate:4f2a91c0', {
        verdict: 'REJECTED',
        excludeValueHashes: [FOOTER_HASH, NAME_HASH],
      } as never);

      expect(correlation.addExclusions).toHaveBeenCalledTimes(1);
      expect(correlation.addExclusions).toHaveBeenCalledWith([
        { mode: 'value', label: 'email', value: 'support@acme.example' },
        { mode: 'value', label: 'person', value: 'acme legal team' },
      ]);
      expect(res.exclusionRuleIds).toEqual(['r1', 'r2']);
    });

    it('records every rule id so undo can take all of them back', async () => {
      wireApply();
      correlation.addExclusions.mockResolvedValue({
        added: [{ id: 'r1' }, { id: 'r2' }],
      });

      await service.applyPattern('boilerplate:4f2a91c0', {
        verdict: 'REJECTED',
        excludeValueHashes: [FOOTER_HASH, NAME_HASH],
      } as never);

      const batch = prisma.correlationReviewBatch.create.mock.calls[0][0].data;
      expect(batch.action).toBe('exclude');
      expect(batch.undoPayload).toEqual({
        kind: 'exclusion',
        ruleIds: ['r1', 'r2'],
      });
    });

    it('rolls every rule back when the verdict transaction fails', async () => {
      wireApply();
      correlation.addExclusions.mockResolvedValue({
        added: [{ id: 'r1' }, { id: 'r2' }],
      });
      prisma.$transaction.mockRejectedValue(new Error('deadlock'));

      await expect(
        service.applyPattern('boilerplate:4f2a91c0', {
          verdict: 'REJECTED',
          excludeValueHashes: [FOOTER_HASH],
        } as never),
      ).rejects.toThrow('deadlock');

      // An instance-wide matching rule with no batch in the undo log is
      // unreachable from the UI; it must not survive a failed action.
      expect(correlation.removeExclusions).toHaveBeenCalledWith(['r1', 'r2']);
    });

    it('ignores a hash that is not in the index', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([]) // nothing resolved
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);

      const res = await service.applyPattern('boilerplate:4f2a91c0', {
        verdict: 'REJECTED',
        excludeValueHashes: ['f'.repeat(64)],
      } as never);

      expect(correlation.addExclusions).not.toHaveBeenCalled();
      expect(res.exclusionRuleIds).toEqual([]);
    });

    it('rejects anything that is not a value hash before it reaches SQL', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: BigInt(0) }]);

      await service.applyPattern('boilerplate:4f2a91c0', {
        verdict: 'REJECTED',
        // A pattern endpoint must not be a way to write arbitrary config.
        excludeValueHashes: ["'; DROP TABLE assets; --", 'not-a-hash', 42],
      } as never);

      expect(correlation.addExclusions).not.toHaveBeenCalled();
    });

    it('does not schedule a second recompute — the config write already did', async () => {
      wireApply();
      correlation.addExclusions.mockResolvedValue({ added: [{ id: 'r1' }] });

      await service.applyPattern('boilerplate:4f2a91c0', {
        verdict: 'REJECTED',
        excludeValueHashes: [FOOTER_HASH],
      } as never);

      expect(correlation.scheduleFullRecompute).not.toHaveBeenCalled();
    });
  });

  describe('undo', () => {
    beforeEach(() => {
      prisma.correlationPairVerdict.deleteMany.mockResolvedValue({ count: 3 });
      prisma.correlationReviewBatch.update.mockResolvedValue({});
      prisma.$queryRaw.mockResolvedValue([{ count: BigInt(0) }]);
    });

    it('removes every rule the batch created, in one write', async () => {
      prisma.correlationReviewBatch.findUnique.mockResolvedValue({
        id: 'b1',
        undoneAt: null,
        undoPayload: { kind: 'exclusion', ruleIds: ['r1', 'r2', 'r3'] },
      });

      await service.undo('b1');

      expect(correlation.removeExclusions).toHaveBeenCalledTimes(1);
      expect(correlation.removeExclusions).toHaveBeenCalledWith([
        'r1',
        'r2',
        'r3',
      ]);
    });

    it('still reverses a batch written in the old single-rule shape', async () => {
      prisma.correlationReviewBatch.findUnique.mockResolvedValue({
        id: 'b0',
        undoneAt: null,
        undoPayload: { kind: 'exclusion', ruleId: 'legacy' },
      });

      await service.undo('b0');

      expect(correlation.removeExclusions).toHaveBeenCalledWith(['legacy']);
    });
  });
});
