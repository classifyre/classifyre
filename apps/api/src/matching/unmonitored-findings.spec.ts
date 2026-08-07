import { InquiryMatchingService } from './inquiry-matching.service';

/**
 * Evidence found but unwatched.
 *
 * The harness reported coverage of SOURCES scanned and nothing about findings
 * MONITORED, and the gap showed on a live instance: 1048 open findings, 250 of
 * them above the high-importance bar, and two inquiries — one matching 95
 * findings, one matching zero. Across three hours the inquiry agent created
 * nothing and spent every cycle re-reading those two, which was the rational
 * move given the only signals it had ("avoid duplicates", "prefer enriching",
 * "wind down noise"). This is the counterweight.
 */
describe('InquiryMatchingService.unmonitoredFindings', () => {
  const finding = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'f1',
    sourceId: 's1',
    detectorType: 'PII',
    findingType: 'PERSON',
    customDetectorKey: null,
    matchedContent: 'Aung San Suu Kyi',
    importanceScore: 0.9,
    ...over,
  });

  /** An inquiry matching everything from one detector type. */
  const inquiry = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'q1',
    matchAllSources: true,
    sourceIds: [],
    detectorTypes: ['PII'],
    customDetectorKeys: [],
    findingTypes: [],
    findingTypeRegex: [],
    findingValueRegex: [],
    ...over,
  });

  const build = (findings: unknown[], inquiries: unknown[]) => {
    const prisma = {
      finding: { findMany: jest.fn().mockResolvedValue(findings) },
      inquiry: { findMany: jest.fn().mockResolvedValue(inquiries) },
    };
    const service = new InquiryMatchingService(prisma as never, {} as never);
    return { service, prisma };
  };

  it('reports findings no active inquiry matches', async () => {
    const { service } = build(
      [finding({ id: 'f1' }), finding({ id: 'f2' })],
      [],
    );

    const result = await service.unmonitoredFindings(0.75, 500);

    expect(result.total).toBe(2);
    expect(result.groups[0].sampleFindingIds).toEqual(['f1', 'f2']);
  });

  it('excludes findings an inquiry already covers', async () => {
    const { service } = build(
      [finding({ id: 'f1' }), finding({ id: 'f2', detectorType: 'SECRETS' })],
      [inquiry()], // watches PII only
    );

    const result = await service.unmonitoredFindings(0.75, 500);

    expect(result.total).toBe(1);
    expect(result.groups[0].sampleFindingIds).toEqual(['f2']);
  });

  // The live shape: an inquiry whose matcher selects nothing must not be
  // credited with covering anything. It was "watching" Myanmar and matching 0.
  it('gives a broken inquiry no credit for coverage', async () => {
    const { service } = build(
      [finding({ id: 'f1', matchedContent: 'Suu Kyi' })],
      [inquiry({ findingValueRegex: ['^this matches nothing$'] })],
    );

    const result = await service.unmonitoredFindings(0.75, 500);

    expect(result.total).toBe(1);
  });

  it('only considers findings above the importance bar', async () => {
    const { service, prisma } = build([], []);

    await service.unmonitoredFindings(0.75, 500);

    const where = prisma.finding.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('OPEN');
    expect(where.importanceScore).toEqual({ gte: 0.75 });
  });

  it('only counts ACTIVE inquiries as coverage', async () => {
    const { service, prisma } = build([], []);

    await service.unmonitoredFindings(0.75, 500);

    expect(prisma.inquiry.findMany.mock.calls[0][0].where).toEqual({
      status: 'ACTIVE',
    });
  });

  it('groups by detector and finding type, strongest first', async () => {
    const { service } = build(
      [
        finding({ id: 'a', findingType: 'PERSON', importanceScore: 0.8 }),
        finding({ id: 'b', findingType: 'PERSON', importanceScore: 0.85 }),
        finding({ id: 'c', findingType: 'LOCATION', importanceScore: 0.95 }),
      ],
      [],
    );

    const result = await service.unmonitoredFindings(0.75, 500);

    expect(result.groups).toHaveLength(2);
    // Highest-importance group leads, so the agent sees the best lead first.
    expect(result.groups[0].findingType).toBe('LOCATION');
    expect(result.groups[1].findingType).toBe('PERSON');
    expect(result.groups[1].count).toBe(2);
    expect(result.groups[1].topImportance).toBe(0.85);
  });

  it('reports nothing when every finding is watched', async () => {
    const { service } = build([finding()], [inquiry()]);

    const result = await service.unmonitoredFindings(0.75, 500);

    expect(result.total).toBe(0);
    expect(result.groups).toEqual([]);
  });
});
