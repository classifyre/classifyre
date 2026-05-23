import { NotFoundException } from '@nestjs/common';
import { CustomDetectorExtractionsService } from './custom-detector-extractions.service';

describe('CustomDetectorExtractionsService', () => {
  function createService() {
    const prisma = {
      customDetectorExtraction: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        upsert: jest.fn(),
      },
      customDetector: {
        findUnique: jest.fn(),
      },
      finding: {
        count: jest.fn(),
      },
    };
    const service = new CustomDetectorExtractionsService(prisma as any);
    return { service, prisma };
  }

  const mockExtraction = {
    id: 'ext-1',
    findingId: 'find-1',
    customDetectorId: 'det-1',
    customDetectorKey: 'food_discussion',
    sourceId: 'src-1',
    assetId: 'asset-1',
    runnerId: 'run-1',
    detectorVersion: 1,
    pipelineResult: {
      entities: [{ label: 'dish', text: 'pasta carbonara', score: 0.9 }],
      classification: {},
      metadata: { runner: 'GLINER2' },
    },
    extractedAt: new Date('2026-03-08T12:00:00Z'),
    createdAt: new Date('2026-03-08T12:00:00Z'),
  };

  it('getByFinding returns extraction when found', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.findUnique.mockResolvedValue(
      mockExtraction,
    );

    const result = await service.getByFinding('find-1');

    expect(result).not.toBeNull();
    expect(result!.findingId).toBe('find-1');
    expect(result!.pipelineResult).toEqual(mockExtraction.pipelineResult);
  });

  it('getByFinding returns null when not found', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.findUnique.mockResolvedValue(null);

    const result = await service.getByFinding('missing');
    expect(result).toBeNull();
  });

  it('search filters by customDetectorKey', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.findMany.mockResolvedValue([
      mockExtraction,
    ]);
    prisma.customDetectorExtraction.count.mockResolvedValue(1);

    const result = await service.search({
      customDetectorKey: 'food_discussion',
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.customDetectorKey).toBe('food_discussion');
    expect(prisma.customDetectorExtraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customDetectorKey: 'food_discussion',
        }),
      }),
    );
  });

  it('search filters by sourceId', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.findMany.mockResolvedValue([
      mockExtraction,
    ]);
    prisma.customDetectorExtraction.count.mockResolvedValue(1);

    await service.search({ sourceId: 'src-1' });

    expect(prisma.customDetectorExtraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sourceId: 'src-1' }),
      }),
    );
  });

  it('search respects take/skip pagination', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.findMany.mockResolvedValue([]);
    prisma.customDetectorExtraction.count.mockResolvedValue(0);

    await service.search({ take: 10, skip: 20 });

    expect(prisma.customDetectorExtraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 20 }),
    );
  });

  it('getCoverage throws for unknown detector', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue(null);

    await expect(service.getCoverage('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('getCoverage computes rates correctly', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue({
      id: 'det-1',
      key: 'food_discussion',
    });
    prisma.finding.count.mockResolvedValue(100);
    prisma.customDetectorExtraction.count.mockResolvedValue(3);

    const result = await service.getCoverage('det-1');

    expect(result.totalFindings).toBe(100);
    expect(result.findingsWithExtraction).toBe(3);
    expect(result.coverageRate).toBeCloseTo(0.03);
    expect(result.customDetectorKey).toBe('food_discussion');
  });

  it('getCoverage returns zero coverageRate when no findings', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue({
      id: 'det-1',
      key: 'empty_detector',
    });
    prisma.finding.count.mockResolvedValue(0);
    prisma.customDetectorExtraction.count.mockResolvedValue(0);

    const result = await service.getCoverage('det-1');

    expect(result.coverageRate).toBe(0);
  });

  it('createFromIngestion upserts with pipelineResult', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.upsert.mockResolvedValue({});
    const pipelineResult = {
      entities: [{ label: 'dish', text: 'pizza', score: 0.95 }],
      classification: {},
      metadata: { runner: 'GLINER2' },
    };

    await service.createFromIngestion({
      findingId: 'find-2',
      customDetectorId: 'det-1',
      customDetectorKey: 'food_discussion',
      sourceId: 'src-1',
      assetId: 'asset-1',
      runnerId: null,
      detectorVersion: 2,
      pipelineResult,
      extractedAt: new Date(),
    });

    const upsertCall = prisma.customDetectorExtraction.upsert.mock.calls[0][0];
    expect(upsertCall.create.pipelineResult).toEqual(pipelineResult);
    expect(upsertCall.create.findingId).toBe('find-2');
  });
});
