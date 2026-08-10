import { AgentSearchService } from './agent-search.service';

describe('AgentSearchService — priority worklists', () => {
  const prisma = {
    case: { findMany: jest.fn(), count: jest.fn() },
    inquiry: { findMany: jest.fn(), count: jest.fn() },
  };
  const service = new AgentSearchService(prisma as never, {} as never);

  const thread = (supported = false, title = 'Hypothesis') => ({
    id: `t-${title}`,
    title,
    status: 'PROPOSED',
    confidence: null,
    testablePredicate: null,
    _count: { support: supported ? 1 : 0 },
  });
  const investigation = (over: Record<string, unknown> = {}) => ({
    id: 'case-default',
    title: 'Case',
    description: null,
    status: 'OPEN',
    severity: 'MEDIUM',
    aiMode: 'INHERIT',
    createdBy: 'ai-autopilot',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    assignee: null,
    conclusion: null,
    inquiryLinks: [],
    threads: [],
    _count: { evidence: 0, findings: 0 },
    ...over,
  });
  const inquiry = (over: Record<string, unknown> = {}) => ({
    id: 'inquiry-default',
    title: 'Inquiry',
    description: null,
    status: 'ACTIVE',
    createdBy: 'ai-autopilot',
    aiMode: 'INHERIT',
    matchAllSources: false,
    sourceIds: [],
    detectorTypes: [],
    customDetectorKeys: [],
    findingTypes: [],
    findingTypeRegex: [],
    findingValueRegex: [],
    matchCount: 0,
    newMatchCount: 0,
    matchesSeenAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    caseLinks: [],
    ...over,
  });

  beforeEach(() => jest.clearAllMocks());

  it('applies every case comparator tier and exposes the reasons', async () => {
    const rows = [
      investigation({
        id: 'ai-high-evidenced',
        severity: 'HIGH',
        threads: [thread(true, 'evidenced')],
        updatedAt: new Date('2026-06-01T00:00:00Z'),
      }),
      investigation({
        id: 'ai-high-unevaluated-new',
        severity: 'HIGH',
        threads: [thread(false, 'new')],
        updatedAt: new Date('2026-07-02T00:00:00Z'),
      }),
      investigation({
        id: 'ai-high-unevaluated-old',
        severity: 'HIGH',
        threads: [thread(false, 'old')],
        updatedAt: new Date('2026-07-01T00:00:00Z'),
      }),
      investigation({
        id: 'ai-critical',
        severity: 'CRITICAL',
        threads: [thread(true, 'critical')],
      }),
      investigation({
        id: 'operator-medium',
        createdBy: null,
        severity: 'MEDIUM',
        threads: [thread(false, 'operator')],
      }),
    ];
    prisma.case.findMany.mockResolvedValue(rows);
    prisma.case.count.mockResolvedValue(rows.length);

    const result = await service.listOpenCases();

    expect(result.items.map((item) => item.id)).toEqual([
      'operator-medium',
      'ai-critical',
      'ai-high-unevaluated-old',
      'ai-high-unevaluated-new',
      'ai-high-evidenced',
    ]);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        rank: 1,
        createdBy: null,
        origin: 'operator',
        unevaluatedHypothesisCount: 1,
      }),
    );
    expect(result.items[0].priority).toMatch(
      /operator · MEDIUM · 1 unevaluated/,
    );
  });

  it('keeps a stale operator case above the database-capped recent stratum', async () => {
    const stale = investigation({ id: 'stale-operator', createdBy: null });
    const recent = Array.from({ length: 40 }, (_, index) =>
      investigation({
        id: `recent-${index.toString().padStart(2, '0')}`,
        updatedAt: new Date(
          `2026-08-${String((index % 9) + 1).padStart(2, '0')}T00:00:00Z`,
        ),
      }),
    );
    prisma.case.findMany
      .mockResolvedValueOnce([stale])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(recent)
      .mockResolvedValueOnce([]);
    prisma.case.count.mockResolvedValue(41);

    const result = await service.listOpenCases();

    expect(result.items[0].id).toBe('stale-operator');
    expect(result.shown).toBe(40);
    expect(result.omitted).toBe(1);
  });

  it('bounds descriptions and hypothesis title payloads', async () => {
    const row = investigation({
      id: 'bounded',
      createdBy: null,
      description: 'x'.repeat(500),
      threads: Array.from({ length: 8 }, (_, index) =>
        thread(false, `hypothesis-${index}`),
      ),
    });
    prisma.case.findMany.mockResolvedValue([row]);
    prisma.case.count.mockResolvedValue(1);

    const result = await service.listOpenCases();

    expect(result.items[0].description).toHaveLength(240);
    expect(result.items[0].hypothesisTitles).toHaveLength(6);
    expect(result.items[0].hypothesisCount).toBe(8);
  });

  it('orders inquiries operator → new matches → oldest and reports omission', async () => {
    const rows = [
      inquiry({ id: 'ai-new', newMatchCount: 2 }),
      inquiry({
        id: 'operator-newer',
        createdBy: null,
        updatedAt: new Date('2026-07-02T00:00:00Z'),
      }),
      inquiry({
        id: 'operator-old',
        createdBy: 'alice',
        updatedAt: new Date('2026-07-01T00:00:00Z'),
      }),
      inquiry({ id: 'operator-match', createdBy: null, newMatchCount: 1 }),
    ];
    prisma.inquiry.findMany.mockResolvedValue(rows);
    prisma.inquiry.count.mockResolvedValue(65);

    const result = await service.listActiveInquiries();

    expect(result.items.map((item) => item.id)).toEqual([
      'operator-match',
      'operator-old',
      'operator-newer',
      'ai-new',
    ]);
    expect(result.items[0].origin).toBe('operator');
    expect(result.omitted).toBe(61);
  });
});
