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
    extractionMethod: 'CLASSIFIER_GLINER',
    detectorVersion: 1,
    fieldCount: 2,
    populatedFields: ['dishes', 'cuisine'],
    extractedData: { dishes: ['pasta carbonara'], cuisine: 'Italian' },
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
    expect(result!.extractedData).toEqual({
      dishes: ['pasta carbonara'],
      cuisine: 'Italian',
    });
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

  it('search filters by populatedField', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.findMany.mockResolvedValue([
      mockExtraction,
    ]);
    prisma.customDetectorExtraction.count.mockResolvedValue(1);

    await service.search({ populatedField: 'cuisine' });

    expect(prisma.customDetectorExtraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          populatedFields: { has: 'cuisine' },
        }),
      }),
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
    prisma.customDetectorExtraction.findMany.mockResolvedValue([
      { populatedFields: ['dishes', 'cuisine'] },
      { populatedFields: ['dishes'] },
      { populatedFields: ['dishes', 'cuisine', 'ingredients'] },
    ]);

    const result = await service.getCoverage('det-1');

    expect(result.totalFindings).toBe(100);
    expect(result.findingsWithExtraction).toBe(3);
    expect(result.coverageRate).toBeCloseTo(0.03);
    const dishField = result.fieldCoverage.find((f) => f.field === 'dishes');
    expect(dishField?.populated).toBe(3);
    expect(dishField?.rate).toBe(1.0);
  });

  it('createFromIngestion computes populatedFields and upserts', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.upsert.mockResolvedValue({});

    await service.createFromIngestion({
      findingId: 'find-2',
      customDetectorId: 'det-1',
      customDetectorKey: 'food_discussion',
      sourceId: 'src-1',
      assetId: 'asset-1',
      runnerId: null,
      extractionMethod: 'CLASSIFIER_GLINER',
      detectorVersion: 2,
      extractedData: {
        dishes: ['pizza'],
        empty_list: [],
        nullable: null,
        cuisine: 'Italian',
      },
      extractedAt: new Date(),
    });

    const upsertCall = prisma.customDetectorExtraction.upsert.mock.calls[0][0];
    expect(upsertCall.create.populatedFields).toEqual(
      expect.arrayContaining(['dishes', 'cuisine']),
    );
    expect(upsertCall.create.populatedFields).not.toContain('empty_list');
    expect(upsertCall.create.populatedFields).not.toContain('nullable');
    expect(upsertCall.create.fieldCount).toBe(4);
  });
});
