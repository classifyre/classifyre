/**
 * Coverage calculation tests for CustomDetectorExtractionsService.
 *
 * Run with:
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

describe('getCoverage — rate computations', () => {
  it('computes coverageRate as findingsWithExtraction / totalFindings', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue({
      id: 'det-1',
      key: 'food_discussion',
    });
    prisma.finding.count.mockResolvedValue(100);
    prisma.customDetectorExtraction.count.mockResolvedValue(3);

    const result = await service.getCoverage('det-1');

    expect(result.findingsWithExtraction).toBe(3);
    expect(result.totalFindings).toBe(100);
    expect(result.coverageRate).toBeCloseTo(0.03);
    expect(result.customDetectorKey).toBe('food_discussion');
    expect(result.customDetectorId).toBe('det-1');
  });

  it('returns coverageRate = 0 when no findings exist', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue({
      id: 'det-1',
      key: 'food_discussion',
    });
    prisma.finding.count.mockResolvedValue(0);
    prisma.customDetectorExtraction.count.mockResolvedValue(0);

    const result = await service.getCoverage('det-1');

    expect(result.findingsWithExtraction).toBe(0);
    expect(result.coverageRate).toBe(0);
  });

  it('returns coverageRate = 1.0 when all findings have extractions', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue({
      id: 'det-1',
      key: 'food_discussion',
    });
    prisma.finding.count.mockResolvedValue(5);
    prisma.customDetectorExtraction.count.mockResolvedValue(5);

    const result = await service.getCoverage('det-1');

    expect(result.coverageRate).toBe(1.0);
  });

  it('throws NotFoundException for unknown detector', async () => {
    const { service, prisma } = createService();
    prisma.customDetector.findUnique.mockResolvedValue(null);

    await expect(service.getCoverage('missing-det')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('search — filter combinations', () => {
  const baseRow = {
    id: 'ext-a',
    findingId: 'find-a',
    customDetectorId: 'det-1',
    customDetectorKey: 'food_discussion',
    sourceId: 'src-1',
    assetId: 'asset-1',
    runnerId: null,
    detectorVersion: 1,
    pipelineResult: {
      entities: [],
      classification: {},
      metadata: { runner: 'REGEX' },
    },
    extractedAt: new Date(),
    createdAt: new Date(),
  };

  it('filters by customDetectorKey', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.findMany.mockResolvedValue([baseRow]);
    prisma.customDetectorExtraction.count.mockResolvedValue(1);

    await service.search({ customDetectorKey: 'food_discussion' });

    expect(prisma.customDetectorExtraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customDetectorKey: 'food_discussion',
        }),
      }),
    );
  });

  it('filters by assetId', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.findMany.mockResolvedValue([baseRow]);
    prisma.customDetectorExtraction.count.mockResolvedValue(1);

    await service.search({ assetId: 'asset-1' });

    expect(prisma.customDetectorExtraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assetId: 'asset-1' }),
      }),
    );
  });

  it('returns empty result when nothing matches', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.findMany.mockResolvedValue([]);
    prisma.customDetectorExtraction.count.mockResolvedValue(0);

    const result = await service.search({ customDetectorKey: 'unknown' });

    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('maps pipelineResult onto returned items', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.findMany.mockResolvedValue([baseRow]);
    prisma.customDetectorExtraction.count.mockResolvedValue(1);

    const result = await service.search({});

    expect(result.items[0]?.pipelineResult).toEqual(baseRow.pipelineResult);
  });
});

describe('createFromIngestion — pipelineResult storage', () => {
  it('upserts with provided pipelineResult', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.upsert.mockResolvedValue({});
    const pipelineResult = {
      entities: [{ label: 'amount', text: '€1,200', score: 1.0 }],
      classification: {},
      metadata: { runner: 'REGEX' },
    };

    await service.createFromIngestion({
      findingId: 'find-2',
      customDetectorId: 'det-1',
      customDetectorKey: 'invoice_pii',
      sourceId: 'src-1',
      assetId: 'asset-1',
      runnerId: null,
      detectorVersion: 2,
      pipelineResult,
      extractedAt: new Date(),
    });

    const call = prisma.customDetectorExtraction.upsert.mock.calls[0][0];
    expect(call.create.pipelineResult).toEqual(pipelineResult);
    expect(call.create.findingId).toBe('find-2');
    expect(call.where.findingId).toBe('find-2');
  });

  it('updates pipelineResult and detectorVersion on conflict', async () => {
    const { service, prisma } = createService();
    prisma.customDetectorExtraction.upsert.mockResolvedValue({});
    const pipelineResult = {
      entities: [],
      classification: {},
      metadata: { runner: 'GLINER2' },
    };

    await service.createFromIngestion({
      findingId: 'find-existing',
      customDetectorId: 'det-1',
      customDetectorKey: 'food_discussion',
      sourceId: 'src-1',
      assetId: 'asset-1',
      runnerId: null,
      detectorVersion: 3,
      pipelineResult,
      extractedAt: new Date(),
    });

    const call = prisma.customDetectorExtraction.upsert.mock.calls[0][0];
    expect(call.update.pipelineResult).toEqual(pipelineResult);
    expect(call.update.detectorVersion).toBe(3);
  });
});
