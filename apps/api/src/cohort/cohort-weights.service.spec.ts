import { RunnerStatus } from '@prisma/client';

import type { PrismaService } from '../prisma.service';
import {
  CohortWeightsService,
  cohortSettings,
  normalizeStats,
} from './cohort-weights.service';

const yieldRun = (
  visited: number,
  hits: Record<string, number>,
  weightsUsed = { newest: 60, oldest: 30, random: 10 },
) => ({
  register: {
    bands: Object.fromEntries(
      Object.entries(hits).map(([band, count]) => [
        band,
        { visited, hits: count, exhausted: false },
      ]),
    ),
    weightsUsed,
    declared: { newest: 60, oldest: 30, random: 10 },
    minShare: null,
    universeSize: 326_479,
  },
});

describe('normalizeStats', () => {
  it('keeps what is sound and caps hits at visits', () => {
    expect(
      normalizeStats({
        register: {
          bands: {
            newest: { visited: '12', hits: 99, exhausted: true },
            sideways: { visited: 5 },
          },
          weightsUsed: { newest: 100, random: -3 },
          minShare: 2,
        },
        broken: 'x',
      }),
    ).toEqual({
      register: {
        bands: { newest: { visited: 12, hits: 12, exhausted: true } },
        weightsUsed: { newest: 100 },
        declared: {},
        minShare: null,
        universeSize: 0,
      },
    });
  });
});

describe('cohortSettings', () => {
  it('defaults to auto and reads fixed splits and the floor', () => {
    expect(cohortSettings({})).toEqual({
      mode: 'auto',
      fixed: {},
      floor: null,
    });
    expect(
      cohortSettings({
        optional: {
          cohort_weights: {
            mode: 'fixed',
            floor: 0.2,
            fixed: { register: { newest: 50, oldest: 50, bogus: 1 } },
          },
        },
      }),
    ).toEqual({
      mode: 'fixed',
      fixed: { register: { newest: 50, oldest: 50 } },
      floor: 0.2,
    });
  });
});

describe('CohortWeightsService', () => {
  let prisma: {
    runner: { findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    source: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let service: CohortWeightsService;

  beforeEach(() => {
    prisma = {
      runner: {
        findUnique: jest.fn().mockResolvedValue({
          startedAt: new Date('2026-09-14T10:00:00Z'),
          triggeredAt: new Date('2026-09-14T09:59:00Z'),
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      source: { findUnique: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new CohortWeightsService(prisma as unknown as PrismaService);
  });

  it('records visits from the connector and hits counted in SQL for this run', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { cohort: 'register', band: 'newest', hits: 30 },
      { cohort: 'register', band: 'oldest', hits: 4 },
    ]);

    await service.recordYield('run-1', 'src-1', {
      register: {
        bands: {
          newest: { visited: 120, exhausted: false },
          oldest: { visited: 60, exhausted: false },
        },
        weightsUsed: { newest: 60, oldest: 30, random: 10 },
        declared: { newest: 60, oldest: 30, random: 10 },
      },
    });

    const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [
      string[],
      ...unknown[],
    ];
    expect(strings.join('?')).toContain(
      'f.severity IN (\'HIGH\'::"Severity", \'CRITICAL\'::"Severity")',
    );
    expect(values).toContain('run-1');
    expect(values).toContainEqual(new Date('2026-09-14T10:00:00Z'));
    expect(prisma.runner.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        cohortYield: expect.objectContaining({
          register: expect.objectContaining({
            bands: {
              newest: { visited: 120, hits: 30, exhausted: false },
              oldest: { visited: 60, hits: 4, exhausted: false },
            },
          }),
        }),
      },
    });
  });

  it('writes nothing for a run without cohorts', async () => {
    await service.recordYield('run-1', 'src-1', {});
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.runner.update).not.toHaveBeenCalled();
  });

  it('puts measured weights into the recipe once there is enough evidence', async () => {
    prisma.runner.findMany.mockResolvedValue([
      {
        id: 'run-2',
        triggeredAt: new Date(),
        cohortYield: yieldRun(400, { newest: 120, oldest: 8, random: 20 }),
      },
    ]);

    const source = await service.withEffectiveWeights({
      id: 'src-1',
      config: { type: 'CUSTOM', optional: { variables: { a: 'b' } } },
    });

    expect(prisma.runner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceId: 'src-1',
          status: { in: [RunnerStatus.COMPLETED, RunnerStatus.WARNING] },
        }),
        take: 10,
      }),
    );
    const config = source.config as Record<string, any>;
    expect(config.optional.variables).toEqual({ a: 'b' });
    const effective = config.optional.cohort_weights.effective.register;
    expect(effective.newest).toBeGreaterThan(60);
    expect(effective.oldest).toBeGreaterThanOrEqual(10);
  });

  it('leaves the recipe alone during cold start', async () => {
    prisma.runner.findMany.mockResolvedValue([
      {
        id: 'run-2',
        triggeredAt: new Date(),
        cohortYield: yieldRun(50, { newest: 20, oldest: 1, random: 2 }),
      },
    ]);
    const input = { id: 'src-1', config: { type: 'CUSTOM' } };
    await expect(service.withEffectiveWeights(input)).resolves.toBe(input);
  });

  it('never fails a run over its cohort split', async () => {
    prisma.runner.findMany.mockRejectedValue(new Error('db down'));
    const input = { id: 'src-1', config: { type: 'CUSTOM' } };
    await expect(service.withEffectiveWeights(input)).resolves.toBe(input);
  });
});
