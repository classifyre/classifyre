import { Test, TestingModule } from '@nestjs/testing';
import {
  EvidenceFloorService,
  matcherSimilarity,
} from './evidence-floor.service';
import { PrismaService } from '../prisma.service';
import { InquiryMatchingService } from '../matching/inquiry-matching.service';

/**
 * The regression corpus for this suite is the first real harness run: 151
 * sources, 12 scanned, and twelve inquiries created — four of which matched
 * nothing at all and five of which were the same monitor pointed at five
 * different mailboxes. Each `it` below names the artifact it would have
 * refused.
 */
describe('EvidenceFloorService', () => {
  let service: EvidenceFloorService;

  const mockPrisma = {
    inquiry: { findMany: jest.fn(), findFirst: jest.fn() },
    finding: { findMany: jest.fn() },
  };
  const mockMatching = { probeMatches: jest.fn() };

  /** A finding row whose analysis says it is genuine evidence. */
  const strong = (id: string) => ({
    id,
    evidenceAnalysis: {
      reasons: [
        { code: 'readable_context', impact: 'up' },
        { code: 'cross_document_recurrence', impact: 'up' },
      ],
    },
  });

  /** A finding row whose analysis says it is noise. */
  const weak = (id: string) => ({
    id,
    evidenceAnalysis: {
      reasons: [
        { code: 'ocr_fragment', impact: 'down' },
        { code: 'duplicate_group', impact: 'down' },
        { code: 'severity_separate', impact: 'neutral' },
      ],
    },
  });

  /** Scored later; importance is not yet knowable. */
  const unscored = (id: string) => ({ id, evidenceAnalysis: null });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvidenceFloorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InquiryMatchingService, useValue: mockMatching },
      ],
    }).compile();
    service = module.get(EvidenceFloorService);
    jest.clearAllMocks();
    mockPrisma.inquiry.findMany.mockResolvedValue([]);
    mockPrisma.finding.findMany.mockResolvedValue([]);
  });

  describe('inquiries must monitor evidence that exists', () => {
    // "Grand Cayman offshore references", "Louise Kitchen correspondence",
    // "Rangel person references" — all created with match_count 0, all
    // rationalised from knowledge of the Enron scandal rather than a finding.
    it('refuses a matcher that selects nothing', async () => {
      mockMatching.probeMatches.mockResolvedValue({
        findingIds: [],
        scanned: 1,
        exhausted: true,
      });

      await expect(
        service.assertInquiryIsWarranted({
          title: 'Grand Cayman offshore references',
          findingValueRegex: ['Grand Cayman'],
        }),
      ).rejects.toThrow(/selects 0 open findings/);
    });

    it('tells the model what to do instead of creating it', async () => {
      mockMatching.probeMatches.mockResolvedValue({
        findingIds: [],
        scanned: 1,
        exhausted: true,
      });

      await expect(
        service.assertInquiryIsWarranted({ title: 'Speculative' }),
      ).rejects.toThrow(/memory\.write/);
    });

    it('allows a matcher backed by real findings', async () => {
      mockMatching.probeMatches.mockResolvedValue({
        findingIds: ['f1', 'f2'],
        scanned: 2,
        exhausted: true,
      });
      mockPrisma.finding.findMany.mockResolvedValue([strong('f1'), weak('f2')]);

      await expect(
        service.assertInquiryIsWarranted({ title: 'Real' }),
      ).resolves.toBeUndefined();
    });

    it('refuses an inquiry over a pure boilerplate cluster', async () => {
      mockMatching.probeMatches.mockResolvedValue({
        findingIds: ['f1', 'f2'],
        scanned: 2,
        exhausted: true,
      });
      mockPrisma.finding.findMany.mockResolvedValue([weak('f1'), weak('f2')]);

      await expect(
        service.assertInquiryIsWarranted({ title: 'HTML artifact noise' }),
      ).rejects.toThrow(/is noise/);
    });

    // An unanalyzed finding scores 0 exactly like an unimportant one. Treating
    // unscored as weak would let a lagging embedding queue silently block every
    // legitimate inquiry — the floor must fail open on ignorance.
    it('does not judge findings the analyzer has not scored yet', async () => {
      mockMatching.probeMatches.mockResolvedValue({
        findingIds: ['f1', 'f2'],
        scanned: 2,
        exhausted: true,
      });
      mockPrisma.finding.findMany.mockResolvedValue([
        weak('f1'),
        unscored('f2'),
      ]);

      await expect(
        service.assertInquiryIsWarranted({ title: 'Pending analysis' }),
      ).resolves.toBeUndefined();
    });
  });

  /**
   * The floor runs inside an LLM tool call, so it uses a bounded probe rather
   * than the operator-facing `preview`, which loads every candidate row before
   * regex-filtering in app code. Unbounded, that was up to six full-table loads
   * of a ~100k-finding corpus per `inquiries.create`, on a service with a heap
   * ceiling.
   */
  describe('bounded probing', () => {
    it('does not report a scan-cap miss as a definitive zero', async () => {
      mockMatching.probeMatches.mockResolvedValue({
        findingIds: [],
        scanned: 2000,
        exhausted: false,
      });

      await expect(
        service.assertInquiryIsWarranted({ title: 'Very sparse' }),
      ).rejects.toThrow(/first 2000 findings scanned/);
    });

    it('still says "selects 0" when the set really was exhausted', async () => {
      mockMatching.probeMatches.mockResolvedValue({
        findingIds: [],
        scanned: 12,
        exhausted: true,
      });

      await expect(
        service.assertInquiryIsWarranted({ title: 'Empty' }),
      ).rejects.toThrow(/selects 0 open findings/);
    });

    // Containment of a bounded sample in another bounded sample proves nothing:
    // two large sets can overlap entirely and still share no sampled id. A
    // false duplicate refusal is worse than a missed one, so the set-overlap
    // fallback is skipped and structural similarity carries the check alone.
    it('skips the set-overlap fallback when the proposal was truncated', async () => {
      mockMatching.probeMatches.mockResolvedValue({
        findingIds: ['f1'],
        scanned: 2000,
        exhausted: false,
      });
      mockPrisma.finding.findMany.mockResolvedValue([strong('f1')]);
      mockPrisma.inquiry.findMany.mockResolvedValue([
        {
          id: 'q1',
          title: 'Unrelated',
          matchAllSources: true,
          sourceIds: [],
          detectorTypes: [],
          customDetectorKeys: [],
          findingTypes: [],
          findingTypeRegex: [],
          findingValueRegex: [],
        },
      ]);

      await expect(
        service.assertInquiryIsWarranted({ title: 'Broad' }),
      ).resolves.toBeUndefined();
      // One probe for the proposal; no second probe for the candidate.
      expect(mockMatching.probeMatches).toHaveBeenCalledTimes(1);
    });
  });

  describe('one phenomenon, one inquiry', () => {
    // The first run created five "HTML email artifact noise" inquiries, one per
    // mailbox, its own fifth rationale reading "same pattern as 5 other
    // sources". The titles all differed, so only the selected finding sets
    // reveal them as one monitor.
    it('refuses a per-source copy of an existing inquiry and names it', async () => {
      mockMatching.probeMatches
        .mockResolvedValueOnce({
          findingIds: ['f1', 'f2', 'f3'],
          scanned: 3,
          exhausted: true,
        })
        .mockResolvedValueOnce({
          findingIds: ['f1', 'f2', 'f9'],
          scanned: 40,
          exhausted: true,
        });
      mockPrisma.finding.findMany.mockResolvedValue([strong('f1')]);
      mockPrisma.inquiry.findMany.mockResolvedValue([
        {
          id: 'q-symes',
          title: 'symes-k HTML email artifact noise',
          matchAllSources: true,
          sourceIds: [],
          detectorTypes: [],
          customDetectorKeys: [],
          findingTypes: [],
          findingTypeRegex: [],
          findingValueRegex: [],
        },
      ]);

      await expect(
        service.assertInquiryIsWarranted({
          title: 'king-j HTML email artifact noise',
        }),
      ).rejects.toThrow(/q-symes/);
    });

    it('points at inquiries.enrich rather than just saying no', async () => {
      mockMatching.probeMatches
        .mockResolvedValueOnce({
          findingIds: ['f1'],
          scanned: 2,
          exhausted: true,
        })
        .mockResolvedValueOnce({
          findingIds: ['f1'],
          scanned: 9,
          exhausted: true,
        });
      mockPrisma.finding.findMany.mockResolvedValue([strong('f1')]);
      mockPrisma.inquiry.findMany.mockResolvedValue([
        {
          id: 'q1',
          title: 'Existing',
          matchAllSources: true,
          sourceIds: [],
          detectorTypes: [],
          customDetectorKeys: [],
          findingTypes: [],
          findingTypeRegex: [],
          findingValueRegex: [],
        },
      ]);

      await expect(
        service.assertInquiryIsWarranted({ title: 'Duplicate' }),
      ).rejects.toThrow(/inquiries\.enrich/);
    });

    it('allows a genuinely distinct inquiry through', async () => {
      mockMatching.probeMatches
        .mockResolvedValueOnce({
          findingIds: ['f1', 'f2'],
          scanned: 2,
          exhausted: true,
        })
        .mockResolvedValueOnce({
          findingIds: ['f8', 'f9'],
          scanned: 2,
          exhausted: true,
        });
      mockPrisma.finding.findMany.mockResolvedValue([strong('f1')]);
      mockPrisma.inquiry.findMany.mockResolvedValue([
        {
          id: 'q1',
          title: 'Unrelated topic',
          matchAllSources: true,
          sourceIds: [],
          detectorTypes: [],
          customDetectorKeys: [],
          findingTypes: [],
          findingTypeRegex: [],
          findingValueRegex: [],
        },
      ]);

      await expect(
        service.assertInquiryIsWarranted({ title: 'Something else' }),
      ).resolves.toBeUndefined();
    });

    // A per-source proposal fully contained in a corpus-wide inquiry is a
    // duplicate even though the corpus-wide one is far larger — which is why
    // this compares containment rather than Jaccard similarity.
    it('catches a small proposal swallowed by a much larger inquiry', async () => {
      mockMatching.probeMatches
        .mockResolvedValueOnce({
          findingIds: ['f1', 'f2'],
          scanned: 2,
          exhausted: true,
        })
        .mockResolvedValueOnce({
          findingIds: Array.from({ length: 50 }, (_, i) => `f${i + 1}`),
          scanned: 50,
          exhausted: true,
        });
      mockPrisma.finding.findMany.mockResolvedValue([strong('f1')]);
      mockPrisma.inquiry.findMany.mockResolvedValue([
        {
          id: 'q-corpus',
          title: 'Corpus-wide HTML noise',
          matchAllSources: true,
          sourceIds: [],
          detectorTypes: [],
          customDetectorKeys: [],
          findingTypes: [],
          findingTypeRegex: [],
          findingValueRegex: [],
        },
      ]);

      await expect(
        service.assertInquiryIsWarranted({ title: 'one-mailbox copy' }),
      ).rejects.toThrow(/q-corpus/);
    });
  });

  /**
   * The real regression. These are the actual matcher rows the first run wrote
   * for its six "HTML email artifact noise" inquiries, read off the live
   * instance. Every one is `matchAllSources: false` scoped to a single mailbox,
   * so their SELECTED FINDING SETS ARE DISJOINT — comparing what they match
   * scores zero overlap and lets all six through. What makes them one monitor
   * is that the matchers are identical once source scoping is ignored.
   */
  describe('the real six-inquiry duplicate family', () => {
    const htmlNoise = (sourceId: string, findingValueRegex: string[]): any => ({
      matchAllSources: false,
      sourceIds: [sourceId],
      detectorTypes: ['PII'],
      customDetectorKeys: [],
      findingTypes: ['PERSON', 'LOCATION', 'NRP', 'EMAIL_ADDRESS', 'URL'],
      findingTypeRegex: [],
      findingValueRegex,
    });

    const symesK = htmlNoise('symes-k', [
      '<BR>\\r\\n',
      '&nbsp;<BR>',
      'Enable Macros and Read Only',
    ]);
    const kingJ = htmlNoise('king-j', [
      '<BR>\\r\\n',
      '&nbsp;<BR>',
      '&nbsp;&nbsp;',
      '\\t[A-Z][a-z]+\\.[A-Z][a-z]+@',
      '^Email [A-Z]',
      '  [A-Z][a-z]+  [A-Z][a-z]+',
    ]);
    const smithM = htmlNoise('smith-m', kingJ.findingValueRegex);

    it('scores the per-source clones as duplicates despite different sources', () => {
      expect(matcherSimilarity(symesK, kingJ)).toBeGreaterThanOrEqual(0.6);
      expect(matcherSimilarity(kingJ, smithM)).toBe(1);
    });

    it('is unaffected by which mailbox each points at', () => {
      const relocated = { ...kingJ, sourceIds: ['stokley-c'] };

      expect(matcherSimilarity(kingJ, relocated)).toBe(1);
    });

    it('refuses the sixth clone and names the first', async () => {
      mockMatching.probeMatches.mockResolvedValue({
        findingIds: ['f1'],
        scanned: 1,
        exhausted: true,
      });
      mockPrisma.finding.findMany.mockResolvedValue([strong('f1')]);
      mockPrisma.inquiry.findMany.mockResolvedValue([
        {
          id: 'q-symes',
          title: 'symes-k HTML email artifact noise',
          ...symesK,
        },
      ]);

      await expect(
        service.assertInquiryIsWarranted({
          title: 'stokley-c HTML email artifact noise',
          ...kingJ,
        }),
      ).rejects.toThrow(/q-symes/);
    });

    it('does not confuse a different phenomenon in the same mailbox', () => {
      // "king-j credit card test data" — same source, different detector and
      // finding types. Created alongside the noise inquiry and legitimately
      // distinct.
      const creditCard = {
        matchAllSources: false,
        sourceIds: ['king-j'],
        detectorTypes: ['CREDIT_CARD'],
        customDetectorKeys: [],
        findingTypes: ['CREDIT_CARD'],
        findingTypeRegex: [],
        findingValueRegex: [],
      } as any;

      expect(matcherSimilarity(kingJ, creditCard)).toBeLessThan(0.6);
    });

    // Replaying every live matcher through matcherSimilarity caught this: two
    // inquiries about DIFFERENT PEOPLE scored 0.67 and would have been refused.
    // Both are PII/{EMAIL_ADDRESS,PERSON}, so the two coarse dimensions agreed
    // and outvoted the one that actually says who is being watched. Tracking
    // distinct people is a core investigative pattern — blocking the second one
    // would have been worse than the duplication this check exists to stop.
    it('does not call two different people the same inquiry', () => {
      const person = (regexes: string[]) =>
        ({
          matchAllSources: false,
          sourceIds: [],
          detectorTypes: ['PII'],
          customDetectorKeys: [],
          findingTypes: ['EMAIL_ADDRESS', 'PERSON'],
          findingTypeRegex: [],
          findingValueRegex: regexes,
        }) as any;

      const arnold = person([
        'john\\.arnold@enron\\.com',
        '\\barnold\\b',
        '\\barora\\b',
      ]);
      const kitchen = person([
        'louis[ae]\\.kitchen@enron\\.com',
        '\\blouise kitchen\\b',
        '\\bkitchen\\b',
      ]);

      expect(matcherSimilarity(arnold, kitchen)).toBe(0);
    });

    // The veto only applies when BOTH sides name specifics. A broad inquiry
    // that constrains nothing may still subsume a narrow one.
    it('still compares a narrow matcher against a broad one', () => {
      const broad = {
        matchAllSources: true,
        sourceIds: [],
        detectorTypes: ['PII'],
        customDetectorKeys: [],
        findingTypes: ['PERSON'],
        findingTypeRegex: [],
        findingValueRegex: [],
      } as any;
      const narrow = { ...broad, findingValueRegex: ['\\bkitchen\\b'] };

      expect(matcherSimilarity(broad, narrow)).toBeGreaterThan(0);
    });

    // Two inquiries constraining nothing but their sources share only their
    // emptiness. Scoring that as identical would block every broad inquiry
    // after the first.
    it('does not call two unconstrained matchers duplicates', () => {
      const empty = {
        matchAllSources: true,
        sourceIds: [],
        detectorTypes: [],
        customDetectorKeys: [],
        findingTypes: [],
        findingTypeRegex: [],
        findingValueRegex: [],
      } as any;

      expect(matcherSimilarity(empty, empty)).toBe(0);
    });
  });

  describe('cases must start from something observed', () => {
    // "Create a case for the badeer-r mailbox investigation" — a scope, not an
    // investigation.
    it('refuses a case citing neither an inquiry nor a finding', async () => {
      await expect(service.assertCaseIsWarranted({})).rejects.toThrow(
        /needs evidence to be a case/,
      );
    });

    it('accepts a case anchored on a matching inquiry', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([{ id: 'q1' }]);

      await expect(
        service.assertCaseIsWarranted({ inquiryIds: ['q1'] }),
      ).resolves.toBeUndefined();
    });

    it('refuses when the linked inquiries have no matches', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([]);

      await expect(
        service.assertCaseIsWarranted({ inquiryIds: ['q-empty'] }),
      ).rejects.toThrow(/no matches yet/);
    });

    it('refuses invented finding ids', async () => {
      mockPrisma.finding.findMany.mockResolvedValue([]);

      await expect(
        service.assertCaseIsWarranted({ findingIds: ['nope'] }),
      ).rejects.toThrow(/none of the findingIds you cited exist/);
    });

    it('refuses a case built entirely on boilerplate', async () => {
      mockPrisma.finding.findMany.mockResolvedValue([weak('f1'), weak('f2')]);

      await expect(
        service.assertCaseIsWarranted({ findingIds: ['f1', 'f2'] }),
      ).rejects.toThrow(/every scored finding you cited is noise/);
    });

    it('accepts a case with at least one substantiated finding', async () => {
      mockPrisma.finding.findMany.mockResolvedValue([strong('f1'), weak('f2')]);

      await expect(
        service.assertCaseIsWarranted({ findingIds: ['f1', 'f2'] }),
      ).resolves.toBeUndefined();
    });

    // An inquiry with matches is sufficient on its own; a weak finding list
    // alongside it must not veto the case.
    it('does not let weak findings override a matching inquiry', async () => {
      mockPrisma.inquiry.findMany.mockResolvedValue([{ id: 'q1' }]);
      mockPrisma.finding.findMany.mockResolvedValue([weak('f1')]);

      await expect(
        service.assertCaseIsWarranted({
          inquiryIds: ['q1'],
          findingIds: ['f1'],
        }),
      ).resolves.toBeUndefined();
    });
  });
});
