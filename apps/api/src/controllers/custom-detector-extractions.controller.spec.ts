/**
 * CustomDetectorExtractionsController tests.
 *
 * Run with:
 *   cd apps/api && bun test -- custom-detector-extractions.controller
 */

import { NotFoundException } from '@nestjs/common';
import { CustomDetectorExtractionsController } from './custom-detector-extractions.controller';

function createController() {
  const service = {
    search: jest.fn(),
    getCoverage: jest.fn(),
    getByFinding: jest.fn(),
  };
  const controller = new CustomDetectorExtractionsController(service as any);
  return { controller, service };
}

const mockExtraction = {
  id: 'ext-1',
  findingId: 'find-1',
  customDetectorId: 'det-1',
  customDetectorKey: 'food_discussion',
  sourceId: 'src-1',
  assetId: 'asset-1',
  runnerId: null,
  detectorVersion: 1,
  pipelineResult: {
    entities: [{ label: 'dish', text: 'pasta carbonara', score: 0.9 }],
    classification: {},
    metadata: { runner: 'GLINER2' },
  },
  extractedAt: new Date('2026-03-08T12:00:00Z'),
  createdAt: new Date('2026-03-08T12:00:00Z'),
};

// ─── GET /findings/:findingId/extraction ─────────────────────────────────────

describe('getByFinding', () => {
  it('returns extraction when found', async () => {
    const { controller, service } = createController();
    service.getByFinding.mockResolvedValue(mockExtraction);

    const result = await controller.getByFinding('find-1');

    expect(result).toEqual(mockExtraction);
    expect(service.getByFinding).toHaveBeenCalledWith('find-1');
  });

  it('throws NotFoundException when no extraction record exists', async () => {
    const { controller, service } = createController();
    service.getByFinding.mockResolvedValue(null);

    await expect(
      controller.getByFinding('find-missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('NotFoundException message includes the finding id', async () => {
    const { controller, service } = createController();
    service.getByFinding.mockResolvedValue(null);

    await expect(controller.getByFinding('find-abc')).rejects.toThrow(
      'find-abc',
    );
  });
});

// ─── GET /custom-detectors/:id/extractions ───────────────────────────────────

describe('search', () => {
  it('delegates to service.search with detectorId injected', async () => {
    const { controller, service } = createController();
    service.search.mockResolvedValue({ items: [mockExtraction], total: 1 });

    const result = await controller.search('det-1', {});

    expect(service.search).toHaveBeenCalledWith(
      expect.objectContaining({ customDetectorId: 'det-1' }),
    );
    expect(result.total).toBe(1);
  });

  it('passes query params through to service', async () => {
    const { controller, service } = createController();
    service.search.mockResolvedValue({ items: [], total: 0 });

    await controller.search('det-1', { sourceId: 'src-1' } as any);

    expect(service.search).toHaveBeenCalledWith(
      expect.objectContaining({ customDetectorId: 'det-1', sourceId: 'src-1' }),
    );
  });

  it('returns empty result when no extractions match', async () => {
    const { controller, service } = createController();
    service.search.mockResolvedValue({ items: [], total: 0 });

    const result = await controller.search('det-1', {});

    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });
});

// ─── GET /custom-detectors/:id/extractions/coverage ──────────────────────────

describe('coverage', () => {
  it('delegates to service.getCoverage with detector id', async () => {
    const { controller, service } = createController();
    const mockCoverage = {
      customDetectorId: 'det-1',
      customDetectorKey: 'food_discussion',
      totalFindings: 50,
      findingsWithExtraction: 10,
      coverageRate: 0.2,
    };
    service.getCoverage.mockResolvedValue(mockCoverage);

    const result = await controller.coverage('det-1');

    expect(service.getCoverage).toHaveBeenCalledWith('det-1');
    expect(result.findingsWithExtraction).toBe(10);
    expect(result.coverageRate).toBe(0.2);
  });

  it('propagates NotFoundException from service for unknown detector', async () => {
    const { controller, service } = createController();
    service.getCoverage.mockRejectedValue(
      new NotFoundException('Detector not found'),
    );

    await expect(controller.coverage('unknown-det')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns zero-coverage for detector with no extractions', async () => {
    const { controller, service } = createController();
    service.getCoverage.mockResolvedValue({
      customDetectorId: 'det-empty',
      customDetectorKey: 'empty_detector',
      totalFindings: 0,
      findingsWithExtraction: 0,
      coverageRate: 0,
    });

    const result = await controller.coverage('det-empty');

    expect(result.coverageRate).toBe(0);
    expect(result.findingsWithExtraction).toBe(0);
  });
});
