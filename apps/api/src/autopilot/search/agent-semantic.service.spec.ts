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
});
