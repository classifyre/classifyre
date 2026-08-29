import { FingerprintsToolset } from './fingerprints.toolset';
import type { PrismaService } from '../../../prisma.service';
import type { CorrelationService } from '../../../correlation/correlation.service';
import type { DuplicatesFinderAgentService } from '../../../correlation/duplicates-finder-agent.service';
import type { DecisionApplierService } from '../../decision-applier.service';
import type { CorrelationReviewService } from '../../../correlation/review/correlation-review.service';
import { AiManagementMode } from '@prisma/client';
import { AI_ACTOR } from '../../autopilot.constants';

describe('FingerprintsToolset', () => {
  const review = {
    applyPattern: jest.fn(),
    exclusionCandidates: jest.fn(),
    decisionsToInquiry: jest.fn(),
  };
  const applier = {
    effectiveMode: jest.fn(() => AiManagementMode.MANAGED),
  };
  const toolset = new FingerprintsToolset(
    {} as PrismaService,
    {} as CorrelationService,
    {} as DuplicatesFinderAgentService,
    applier as unknown as DecisionApplierService,
    review as unknown as CorrelationReviewService,
  );

  const tool = (name: string) => {
    const found = toolset.list().find((t) => t.name === name);
    if (!found) throw new Error(`No tool ${name}`);
    return found;
  };

  beforeEach(() => jest.clearAllMocks());

  it('every mutating fingerprint tool declares a gate and domain', () => {
    for (const tool of toolset.list()) {
      if (tool.sideEffect === 'mutate') {
        expect('resolveGate' in tool).toBe(true);
        expect('domain' in tool).toBe(true);
      }
    }
  });

  it('config-bearing tools opt out of lenient input stripping', () => {
    const tune = toolset
      .list()
      .find((t) => t.name === 'fingerprints.tune_config');
    expect(tune?.lenientInput).toBe(false);
  });

  describe('excluding a boilerplate pattern', () => {
    it('stamps the write as agent work', async () => {
      review.applyPattern.mockResolvedValue({ applied: 12 });

      await tool('fingerprints.exclude_pattern_values').handler(
        { patternKey: 'boilerplate:4f2a91c0', valueHashes: ['a'.repeat(64)] },
        {} as never,
      );

      // Unattributed, this lands in the decisions ledger and the undo log as
      // something a person did, and "pairs remaining" stops being a count of
      // human work.
      expect(review.applyPattern).toHaveBeenCalledWith(
        'boilerplate:4f2a91c0',
        expect.anything(),
        AI_ACTOR,
      );
    });

    it('always rejects — an agent cannot bulk-confirm a pattern', async () => {
      review.applyPattern.mockResolvedValue({ applied: 0 });

      await tool('fingerprints.exclude_pattern_values').handler(
        {
          patternKey: 'boilerplate:4f2a91c0',
          valueHashes: [],
          // Not part of the schema, and must not reach the service even so.
          verdict: 'CONFIRMED',
        },
        {} as never,
      );

      expect(review.applyPattern.mock.calls[0][1]).toMatchObject({
        verdict: 'REJECTED',
      });
    });

    it('is gated on correlation tuning, like every other instance-wide change', async () => {
      const t = tool('fingerprints.exclude_pattern_values');
      expect(t.domain).toBe('system');
      expect(t.sideEffect).toBe('mutate');
      // Hash arrays must survive input normalisation intact.
      expect(t.lenientInput).toBe(false);

      await t.resolveGate!({}, {
        ctx: { settings: { autopilotConfigEnabled: true } },
      } as never);
      expect(applier.effectiveMode).toHaveBeenCalledWith(
        AiManagementMode.INHERIT,
        true,
      );
    });
  });

  it('reads exclusion candidates without mutating', () => {
    expect(tool('fingerprints.exclusion_candidates').sideEffect).toBe('read');
  });

  it('gates decisions_to_inquiry on inquiry autopilot, not correlation', async () => {
    const t = tool('fingerprints.decisions_to_inquiry');
    expect(t.domain).toBe('inquiry');
    await t.resolveGate!({}, {
      ctx: { settings: { autopilotInquiryEnabled: false } },
    } as never);
    expect(applier.effectiveMode).toHaveBeenCalledWith(
      AiManagementMode.INHERIT,
      false,
    );
  });

  /**
   * The queue must stay a human backlog. `clear_safe_band` is the single
   * narrow exception (near-perfect score AND a lineage path explaining it),
   * and it is the only tool here that may record a duplicate verdict.
   */
  it('exposes no tool that lets an agent confirm an arbitrary pair', () => {
    const names = toolset.list().map((t) => t.name);
    expect(names).not.toContain('fingerprints.record_verdict');
    expect(names).not.toContain('fingerprints.apply_pattern');
    expect(names).toContain('fingerprints.clear_safe_band');
  });
});
