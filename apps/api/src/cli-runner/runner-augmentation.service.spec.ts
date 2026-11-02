import { BadRequestException, ConflictException } from '@nestjs/common';
import { RunnerStatus } from '@prisma/client';

import type { GraphService } from '../graph.service';
import type { PrismaService } from '../prisma.service';
import { RunnerAugmentationService } from './runner-augmentation.service';

const AUTHOR = 'src-author';
const OTHER = 'src-other';

describe('RunnerAugmentationService', () => {
  let prisma: {
    runner: { findUnique: jest.Mock };
    customDetector: { findMany: jest.Mock };
    asset: { findMany: jest.Mock };
    finding: { upsert: jest.Mock };
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
  };
  let graph: { upsertEdges: jest.Mock };
  let service: RunnerAugmentationService;

  beforeEach(() => {
    prisma = {
      runner: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'run-1',
          status: RunnerStatus.RUNNING,
          sourceId: AUTHOR,
        }),
      },
      customDetector: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'd1',
            key: 'qa-flag',
            name: 'QA flag',
            pipelineSchema: { type: 'TAG', label: 'QA', severity: 'medium' },
          },
        ]),
      },
      asset: {
        findMany: jest.fn().mockResolvedValue([{ id: 'a1', sourceId: OTHER }]),
      },
      finding: { upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
      $executeRaw: jest.fn().mockResolvedValue(2),
    };
    graph = {
      upsertEdges: jest
        .fn()
        .mockResolvedValue({ upserted: 1, external: 0, dropped: 0 }),
    };
    service = new RunnerAugmentationService(
      prisma as unknown as PrismaService,
      graph as unknown as GraphService,
    );
  });

  const tag = (over: Record<string, unknown> = {}) => ({
    tags: [{ assetId: 'a1', key: 'qa-flag', value: 'needs review', ...over }],
  });

  it('tags a foreign asset, stamped with the calling source and run', async () => {
    await expect(service.tags('run-1', tag())).resolves.toEqual({ written: 1 });
    const call = prisma.finding.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({
      assetId: 'a1',
      sourceId: OTHER,
      assertedBySourceId: AUTHOR,
      assertedByRunnerId: 'run-1',
      findingType: 'tag:QA',
      customDetectorKey: 'qa-flag',
      severity: 'MEDIUM',
    });
  });

  it('keeps authors apart: the identity depends on who asserted it', async () => {
    await service.tags('run-1', tag());
    prisma.runner.findUnique.mockResolvedValue({
      id: 'run-2',
      status: RunnerStatus.RUNNING,
      sourceId: 'src-third',
    });
    await service.tags('run-2', tag());
    const [first, second] = prisma.finding.upsert.mock.calls.map(
      (c) => c[0].where.detectionIdentity,
    );
    expect(first).not.toEqual(second);
  });

  it('lowers a severity above the Tag detector ceiling and records the request', async () => {
    await service.tags('run-1', tag({ severity: 'CRITICAL' }));
    const create = prisma.finding.upsert.mock.calls[0][0].create;
    expect(create.severity).toBe('MEDIUM');
    expect(create.metadata.tag_severity_requested).toBe('CRITICAL');
  });

  it('refuses unknown tag keys (listing valid ones), missing assets and its own assets', async () => {
    await expect(service.tags('run-1', tag({ key: 'nope' }))).rejects.toThrow(
      /Tag detectors/,
    );
    prisma.asset.findMany.mockResolvedValue([]);
    await expect(service.tags('run-1', tag())).rejects.toThrow(/No such asset/);
    prisma.asset.findMany.mockResolvedValue([{ id: 'a1', sourceId: AUTHOR }]);
    await expect(service.tags('run-1', tag())).rejects.toThrow(/Asset\(tags=/);
    expect(prisma.finding.upsert).not.toHaveBeenCalled();
  });

  it('refuses an oversized batch and a run that is not RUNNING', async () => {
    await expect(
      service.tags('run-1', { tags: new Array(5001).fill({}) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    prisma.runner.findUnique.mockResolvedValue({
      id: 'run-1',
      status: RunnerStatus.COMPLETED,
      sourceId: AUTHOR,
    });
    await expect(service.tags('run-1', tag())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('writes edges through the graph with the author, after checking the assets exist', async () => {
    prisma.asset.findMany.mockResolvedValue([{ id: 'a1' }]);
    const result = await service.edges('run-1', {
      edges: [
        { fromId: 'a1', toUrn: 'term://glossary/pii', relationType: 'means' },
      ],
    });
    expect(result).toEqual({ written: 1, skipped: 0 });
    const [dto, author] = graph.upsertEdges.mock.calls[0];
    expect(author).toEqual({ sourceId: AUTHOR, runnerId: 'run-1' });
    expect(dto.edges[0]).toMatchObject({
      fromType: 'asset',
      fromId: 'a1',
      relationType: 'MEANS',
    });
    prisma.asset.findMany.mockResolvedValue([]);
    await expect(
      service.edges('run-1', {
        edges: [{ fromId: 'a1', toId: 'a2', relationType: 'REFERENCES' }],
      }),
    ).rejects.toThrow(/No such asset/);
  });

  it('retires only what this source asserted in earlier runs', async () => {
    await expect(service.finish('run-1')).resolves.toEqual({
      retiredTags: 2,
      retiredEdges: 2,
    });
    for (const call of prisma.$executeRaw.mock.calls) {
      const text = (call[0] as TemplateStringsArray).join('?');
      expect(text).toContain('asserted_by_source_id =');
      expect(text).toContain('asserted_by_runner_id <>');
    }
  });
});
