import { AgentSemanticService } from './agent-semantic.service';

describe('AgentSemanticService', () => {
  const prisma = {
    finding: { count: jest.fn(), findMany: jest.fn() },
  };
  const service = new AgentSemanticService(
    prisma as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('keeps paging until duplicate groups no longer underfill the result', async () => {
    const duplicate = (index: number) => ({
      id: `duplicate-${index}`,
      assetId: `asset-${index}`,
      findingType: 'email',
      severity: 'HIGH',
      status: 'OPEN',
      matchedContent: `value-${index}`,
      evidenceAnalysis: {
        duplicateGroupHash: 'shared-group',
        importanceScore: 0.9,
        qualityScore: 1,
        similarCount: 24,
        reasons: [],
      },
    });
    prisma.finding.count.mockResolvedValue(30);
    prisma.finding.findMany
      .mockResolvedValueOnce(Array.from({ length: 25 }, (_, i) => duplicate(i)))
      .mockResolvedValueOnce([
        {
          ...duplicate(25),
          id: 'unique-result',
          evidenceAnalysis: {
            ...duplicate(25).evidenceAnalysis,
            duplicateGroupHash: null,
            importanceScore: 0.8,
          },
        },
      ]);

    const result = await service.rankedFindings(null, 2);

    expect(prisma.finding.findMany).toHaveBeenCalledTimes(2);
    expect(result.findings.map((finding) => finding.findingId)).toEqual([
      'duplicate-0',
      'unique-result',
    ]);
  });

  /**
   * findings.ranked is the entry point every mission's triage doctrine names.
   * Returning an empty list when nothing has been scored — the state of any
   * instance with the semantic stack off, or still warming up — reads to the
   * agent as "there is nothing important here", and the harness goes silent
   * with no error anywhere.
   */
  describe('when nothing in scope has been scored', () => {
    const unscored = (index: number) => ({
      id: `f-${index}`,
      assetId: `a-${index}`,
      findingType: 'email',
      severity: 'CRITICAL',
      status: 'OPEN',
      matchedContent: `value-${index}`,
      createdAt: new Date(),
    });

    beforeEach(() => {
      // 40 open findings, 0 analyzed.
      prisma.finding.count.mockResolvedValueOnce(40).mockResolvedValueOnce(0);
    });

    it('returns findings instead of an empty list', async () => {
      prisma.finding.findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => unscored(i)),
      );

      const out = await service.rankedFindings(null, 5);

      expect(out.findings).toHaveLength(5);
    });

    it('says plainly that the order is not a ranking', async () => {
      prisma.finding.findMany.mockResolvedValue([unscored(0)]);

      const out = await service.rankedFindings(null, 5);

      expect(out.coverage).toMatch(/RANKING UNAVAILABLE/);
      expect(out.coverage).toMatch(/0 of 40/);
      expect(out.coverage).toMatch(/severity as a substitute/i);
    });

    it('never presents an importance score it does not have', async () => {
      prisma.finding.findMany.mockResolvedValue([unscored(0)]);

      const out = await service.rankedFindings(null, 5);

      expect(out.findings[0].importance).toBeNull();
      expect(out.findings[0].quality).toBeNull();
      expect(out.findings[0].reasons).toEqual([]);
    });

    it('orders by recency, not severity, so the list cannot read as a ranking', async () => {
      prisma.finding.findMany.mockResolvedValue([unscored(0)]);

      await service.rankedFindings(null, 5);

      const args = prisma.finding.findMany.mock.calls.at(-1)![0];
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    });
  });

  it('reports no open findings without claiming ranking is broken', async () => {
    prisma.finding.count.mockResolvedValue(0);
    prisma.finding.findMany.mockResolvedValue([]);

    const out = await service.rankedFindings(null, 5);

    expect(out.coverage).toBe('no open findings in scope');
    expect(out.findings).toEqual([]);
  });
});
