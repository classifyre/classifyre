import { DetectionImpactService } from './detection-impact.service';
import type { PrismaService } from '../prisma.service';
import type { InquiryMatchingService } from '../matching/inquiry-matching.service';

/**
 * Pricing a detection change.
 *
 * The config agent's tool returned `{ok: true}` whether a patch touched nothing
 * or resolved 44,174 findings, so every reduction looked free and it made 22 of
 * them in three days on one source. These are the numbers it should have seen.
 */
describe('DetectionImpactService', () => {
  const prisma = {
    finding: { groupBy: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    customDetector: { findMany: jest.fn() },
    caseFinding: { findMany: jest.fn() },
    case: { findMany: jest.fn() },
    inquiry: { findMany: jest.fn() },
  };
  const matching = { watchersForFindings: jest.fn() };
  const service = new DetectionImpactService(
    prisma as unknown as PrismaService,
    matching as unknown as InquiryMatchingService,
  );

  const withPii = { detectors: [{ type: 'PII', enabled: true }] };
  const withoutPii = { detectors: [{ type: 'PII', enabled: false }] };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.customDetector.findMany.mockResolvedValue([]);
    prisma.finding.groupBy.mockResolvedValue([]);
    prisma.finding.count.mockResolvedValue(0);
    prisma.finding.findMany.mockResolvedValue([]);
    prisma.caseFinding.findMany.mockResolvedValue([]);
    prisma.case.findMany.mockResolvedValue([]);
    prisma.inquiry.findMany.mockResolvedValue([]);
    matching.watchersForFindings.mockResolvedValue(new Map());
  });

  it('reports what disabling a detector would resolve, grouped by detector', async () => {
    prisma.finding.groupBy.mockResolvedValue([
      { detectorType: 'PII', customDetectorKey: null, _count: 44174 },
    ]);
    prisma.finding.count.mockResolvedValue(120);

    const impact = await service.preview('s1', withPii, withoutPii);

    expect(impact.removedDetectors).toEqual(['built-in PII']);
    expect(impact.resolves.total).toBe(44174);
    expect(impact.resolves.byDetector).toEqual([
      { detector: 'built-in PII', count: 44174 },
    ]);
    expect(impact.resolves.highImportance).toBe(120);
  });

  it('reports zero for a patch that only adds detection', async () => {
    const impact = await service.preview('s1', withoutPii, withPii);

    expect(impact.addedDetectors).toEqual(['built-in PII']);
    expect(impact.removedDetectors).toEqual([]);
    expect(impact.resolves.total).toBe(0);
    // Nothing is orphaned, so there is nothing to count.
    expect(prisma.finding.groupBy).not.toHaveBeenCalled();
  });

  it('separates evidence a case cites from what would be resolved', async () => {
    prisma.finding.groupBy.mockResolvedValue([
      { detectorType: 'PII', customDetectorKey: null, _count: 3 },
    ]);
    prisma.finding.findMany.mockResolvedValue([
      {
        id: 'f1',
        sourceId: 's1',
        detectorType: 'PII',
        findingType: 'email',
        customDetectorKey: null,
        matchedContent: 'a@b.c',
      },
      {
        id: 'f2',
        sourceId: 's1',
        detectorType: 'PII',
        findingType: 'email',
        customDetectorKey: null,
        matchedContent: 'd@e.f',
      },
      {
        id: 'f3',
        sourceId: 's1',
        detectorType: 'PII',
        findingType: 'email',
        customDetectorKey: null,
        matchedContent: 'g@h.i',
      },
    ]);
    prisma.caseFinding.findMany.mockResolvedValue([
      { findingId: 'f1', caseId: 'c1' },
      // Belongs to another source's finding — must not be counted here.
      { findingId: 'other', caseId: 'c1' },
    ]);
    prisma.case.findMany.mockResolvedValue([{ id: 'c1', title: 'Cayman' }]);
    matching.watchersForFindings.mockResolvedValue(new Map([['f2', ['q1']]]));
    prisma.inquiry.findMany.mockResolvedValue([
      { id: 'q1', title: 'US phone numbers' },
    ]);

    const impact = await service.preview('s1', withPii, withoutPii);

    expect(impact.protectedEvidence.total).toBe(2);
    expect(impact.protectedEvidence.citedByCases).toEqual([
      { caseId: 'c1', title: 'Cayman', count: 1 },
    ]);
    expect(impact.protectedEvidence.watchedByInquiries).toEqual([
      { inquiryId: 'q1', title: 'US phone numbers', count: 1 },
    ]);
  });

  it('resolves legacy custom-detector ids to keys before diffing', async () => {
    prisma.customDetector.findMany.mockResolvedValue([{ key: 'foia_marker' }]);
    prisma.finding.groupBy.mockResolvedValue([
      {
        detectorType: 'CUSTOM',
        customDetectorKey: 'foia_marker',
        _count: 2483,
      },
    ]);

    const impact = await service.preview(
      's1',
      { detectors: [], custom_detectors: ['det-1'] },
      { detectors: [], custom_detectors: [] },
    );

    expect(impact.removedDetectors).toEqual(['custom detector "foia_marker"']);
    expect(impact.resolves.byDetector).toEqual([
      { detector: 'custom detector "foia_marker"', count: 2483 },
    ]);
  });

  // A config shape this code cannot read must never be reported as "nothing
  // would change" — that is the lie in the dangerous direction.
  it('reports no impact rather than guessing when the detector list is unreadable', async () => {
    const impact = await service.preview(
      's1',
      { detectors: 'nonsense' },
      withoutPii,
    );

    expect(impact.resolves.total).toBe(0);
    expect(impact.removedDetectors).toEqual([]);
    expect(prisma.finding.groupBy).not.toHaveBeenCalled();
  });

  describe('describe()', () => {
    it('leads with the destruction, not the mechanics', () => {
      const line = DetectionImpactService.describe({
        removedDetectors: ['built-in PII'],
        addedDetectors: [],
        resolves: { total: 44174, byDetector: [], highImportance: 120 },
        protectedEvidence: {
          total: 6,
          citedByCases: [],
          watchedByInquiries: [],
        },
        citationScanComplete: true,
      });

      expect(line).toContain('44174 open finding(s)');
      expect(line).toContain('120 of them high-importance');
      expect(line).toContain('6 kept because an investigation cites them');
    });
  });
});
