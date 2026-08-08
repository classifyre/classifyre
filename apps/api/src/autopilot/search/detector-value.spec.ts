import { AgentSearchService } from './agent-search.service';
import type { PrismaService } from '../../prisma.service';
import type { InquiryMatchingService } from '../../matching/inquiry-matching.service';

/**
 * What a detector's output is worth, rather than how much of it there is.
 *
 * `detectors.precision` scored custom detectors only, so the built-in holding
 * 44,174 of a source's 49,671 findings had no value signal at all — and a
 * detector with a large volume and no value signal reads, to anything
 * optimising a number, as noise. It was disabled as "5000+ noise findings" on a
 * source where an active inquiry was matching over a thousand of them.
 */
describe('AgentSearchService.detectorValue', () => {
  const prisma = {
    finding: { groupBy: jest.fn(), findMany: jest.fn() },
    caseFinding: { findMany: jest.fn() },
    customDetectorFeedback: { groupBy: jest.fn() },
  };
  const matching = { watchersForFindings: jest.fn() };
  const service = new AgentSearchService(
    prisma as unknown as PrismaService,
    matching as unknown as InquiryMatchingService,
  );

  const finding = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    sourceId: 's1',
    detectorType: 'PII',
    findingType: 'email',
    customDetectorKey: null,
    matchedContent: 'a@b.c',
    importanceScore: 0.1,
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.finding.groupBy.mockResolvedValue([]);
    prisma.finding.findMany.mockResolvedValue([]);
    prisma.caseFinding.findMany.mockResolvedValue([]);
    prisma.customDetectorFeedback.groupBy.mockResolvedValue([]);
    matching.watchersForFindings.mockResolvedValue(new Map());
  });

  it('scores built-in detectors alongside custom ones', async () => {
    prisma.finding.groupBy.mockResolvedValue([
      { detectorType: 'PII', customDetectorKey: null, _count: 44174 },
      {
        detectorType: 'CUSTOM',
        customDetectorKey: 'phone_number_detector',
        _count: 1141,
      },
    ]);

    const rows = await service.detectorValue('s1');

    expect(rows.map((r) => r.detector)).toEqual(
      expect.arrayContaining(['PII', 'CUSTOM::phone_number_detector']),
    );
    const pii = rows.find((r) => r.detector === 'PII')!;
    expect(pii.label).toBe('built-in PII');
    expect(pii.isCustom).toBe(false);
    expect(pii.openFindings).toBe(44174);
  });

  it('counts what inquiries watch, cases cite and ranking rates highly', async () => {
    prisma.finding.groupBy.mockResolvedValue([
      { detectorType: 'PII', customDetectorKey: null, _count: 3 },
    ]);
    prisma.finding.findMany.mockResolvedValue([
      finding('f1', { importanceScore: 0.9 }),
      finding('f2'),
      finding('f3'),
    ]);
    matching.watchersForFindings.mockResolvedValue(new Map([['f1', ['q1']]]));
    prisma.caseFinding.findMany.mockResolvedValue([{ findingId: 'f2' }]);

    const [pii] = await service.detectorValue('s1');

    expect(pii.watchedByInquiries).toBe(1);
    expect(pii.citedByCases).toBe(1);
    expect(pii.highImportance).toBe(1);
  });

  // The ordering IS the argument: a loud detector nothing uses belongs below a
  // quiet one that feeds an investigation.
  it('ranks used detectors above merely voluminous ones', async () => {
    prisma.finding.groupBy.mockResolvedValue([
      { detectorType: 'PII', customDetectorKey: null, _count: 44174 },
      { detectorType: 'SECRETS', customDetectorKey: null, _count: 12 },
    ]);
    prisma.finding.findMany.mockResolvedValue([
      finding('f1', { detectorType: 'SECRETS' }),
    ]);
    matching.watchersForFindings.mockResolvedValue(new Map([['f1', ['q1']]]));

    const rows = await service.detectorValue(null);

    expect(rows[0].detector).toBe('SECRETS');
    expect(rows[1].detector).toBe('PII');
  });

  it('attributes operator dismissals to the custom detector that earned them', async () => {
    prisma.finding.groupBy.mockResolvedValue([
      {
        detectorType: 'CUSTOM',
        customDetectorKey: 'foia_marker',
        _count: 2483,
      },
    ]);
    prisma.customDetectorFeedback.groupBy.mockResolvedValue([
      {
        customDetectorKey: 'foia_marker',
        status: 'FALSE_POSITIVE',
        _count: 40,
      },
      { customDetectorKey: 'foia_marker', status: 'IGNORED', _count: 2 },
      { customDetectorKey: 'foia_marker', status: 'RESOLVED', _count: 5 },
    ]);

    const [row] = await service.detectorValue('s1');

    expect(row.dismissedByOperator).toBe(42);
  });
});
