/**
 * Beetle Extractor Tests — Coverage calculation edge cases
 *
 * Covers scenario 09 edge cases from beetle-test-scenario-extractor-tests/scenarios/
 *
 * Copy to apps/api/src/ and rename to
 * custom-detector-extractions-coverage.spec.ts to run with:
 *   cd apps/api && bun test -- custom-detector-extractions-coverage
 */

import { NotFoundException } from '@nestjs/common';
import { CustomDetectorExtractionsService } from './custom-detector-extractions.service';

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

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 09 — coverage rates computed correctly
// ─────────────────────────────────────────────────────────────────────────────

describe('getCoverage — field rate computations (scenario 09)', () => {
  it('computes rates for 3 extractions with 3 fields', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue({
      id: 'det-1',
      key: 'food_discussion',
    });
    prisma.finding.count.mockResolvedValue(100);
    prisma.customDetectorExtraction.findMany.mockResolvedValue([
      { populatedFields: ['dish', 'cuisine'] },
      { populatedFields: ['dish'] },
      { populatedFields: ['dish', 'cuisine', 'rating'] },
    ]);

    const result = await service.getCoverage('det-1');

    expect(result.findingsWithExtraction).toBe(3);
    expect(result.totalFindings).toBe(100);
    expect(result.coverageRate).toBeCloseTo(0.03);

    const dish = result.fieldCoverage.find((f) => f.field === 'dish');
    expect(dish?.populated).toBe(3);
    expect(dish?.rate).toBe(1.0);

    const cuisine = result.fieldCoverage.find((f) => f.field === 'cuisine');
    expect(cuisine?.populated).toBe(2);
    expect(cuisine?.rate).toBeCloseTo(2 / 3);

    const rating = result.fieldCoverage.find((f) => f.field === 'rating');
    expect(rating?.populated).toBe(1);
    expect(rating?.rate).toBeCloseTo(1 / 3);
  });

  it('EC-1: returns empty fieldCoverage when no extractions (scenario 09 EC-1)', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue({
      id: 'det-1',
      key: 'food_discussion',
    });
    prisma.finding.count.mockResolvedValue(0);
    prisma.customDetectorExtraction.findMany.mockResolvedValue([]);

    const result = await service.getCoverage('det-1');

    expect(result.findingsWithExtraction).toBe(0);
    expect(result.coverageRate).toBe(0);
    expect(result.fieldCoverage).toHaveLength(0);
  });

  it('EC-2: all fields populated on every extraction → rate = 1.0 for all (scenario 09 EC-2)', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue({
      id: 'det-1',
      key: 'food_discussion',
    });
    prisma.finding.count.mockResolvedValue(5);
    prisma.customDetectorExtraction.findMany.mockResolvedValue([
      { populatedFields: ['dish', 'cuisine'] },
      { populatedFields: ['dish', 'cuisine'] },
      { populatedFields: ['dish', 'cuisine'] },
      { populatedFields: ['dish', 'cuisine'] },
      { populatedFields: ['dish', 'cuisine'] },
    ]);

    const result = await service.getCoverage('det-1');

    for (const field of result.fieldCoverage) {
      expect(field.rate).toBe(1.0);
    }
  });

  it('EC-3: one field always populated, others never (scenario 09 EC-3)', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue({
      id: 'det-1',
      key: 'food_discussion',
    });
    prisma.finding.count.mockResolvedValue(3);
    prisma.customDetectorExtraction.findMany.mockResolvedValue([
      { populatedFields: ['dish'] },
      { populatedFields: ['dish'] },
      { populatedFields: ['dish'] },
    ]);

    const result = await service.getCoverage('det-1');

    const dish = result.fieldCoverage.find((f) => f.field === 'dish');
    expect(dish?.rate).toBe(1.0);
    // No other fields should appear
    expect(result.fieldCoverage).toHaveLength(1);
  });

  it('EC-4: throws NotFoundException for unknown detector (scenario 09 EC-4)', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue(null);

    await expect(service.getCoverage('missing-det')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 08 — populatedField filter in search
// ─────────────────────────────────────────────────────────────────────────────

describe('search — populated_field filter (scenario 08)', () => {
  it('filters by populatedField using array contains check', async () => {
    const { service, prisma } = createService();
    const extractionA = {
      id: 'ext-a',
      findingId: 'find-a',
      customDetectorId: 'det-1',
      customDetectorKey: 'food_discussion',
      populatedFields: ['dish', 'cuisine'],
      extractedData: {},
      sourceId: 'src-1',
      assetId: 'asset-1',
      runnerId: null,
      extractionMethod: 'CLASSIFIER_GLINER',
      detectorVersion: 1,
      fieldCount: 2,
      extractedAt: new Date(),
      createdAt: new Date(),
    };
    prisma.customDetectorExtraction.findMany.mockResolvedValue([extractionA]);
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

  it('returns only extractions containing the specified populated field', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.findMany.mockResolvedValue([
      {
        id: 'ext-1',
        populatedFields: ['dish', 'cuisine'],
        customDetectorKey: 'food_discussion',
        extractedData: { dish: ['pasta'], cuisine: 'Italian' },
        extractedAt: new Date(),
        createdAt: new Date(),
        findingId: 'f-1',
        customDetectorId: 'det-1',
        sourceId: 's-1',
        assetId: 'a-1',
        runnerId: null,
        extractionMethod: 'CLASSIFIER_GLINER',
        detectorVersion: 1,
        fieldCount: 2,
      },
    ]);
    prisma.customDetectorExtraction.count.mockResolvedValue(1);

    const result = await service.search({ populatedField: 'cuisine' });

    expect(result.total).toBe(1);
    expect(result.items[0]?.populatedFields).toContain('cuisine');
  });

  it('returns empty result when no extractions have the specified field', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.findMany.mockResolvedValue([]);
    prisma.customDetectorExtraction.count.mockResolvedValue(0);

    const result = await service.search({ populatedField: 'price' });

    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createFromIngestion — populatedFields computation
// ─────────────────────────────────────────────────────────────────────────────

describe('createFromIngestion — populatedFields computation', () => {
  it('includes only non-null, non-empty fields in populatedFields', async () => {
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
  });

  it('sets fieldCount to total number of keys in extractedData regardless of population', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.upsert.mockResolvedValue({});

    await service.createFromIngestion({
      findingId: 'find-3',
      customDetectorId: 'det-1',
      customDetectorKey: 'food_discussion',
      sourceId: 'src-1',
      assetId: 'asset-1',
      runnerId: null,
      extractionMethod: 'REGEX',
      detectorVersion: 1,
      extractedData: { a: '1', b: null, c: [], d: 'value' },
      extractedAt: new Date(),
    });

    const upsertCall = prisma.customDetectorExtraction.upsert.mock.calls[0][0];
    expect(upsertCall.create.fieldCount).toBe(4);
  });
});
