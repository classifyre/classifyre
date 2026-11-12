import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma.service';
import {
  DeploymentSettingsService,
  MAX_RUNNER_LIMIT,
  effectiveConcurrentRunners,
} from './deployment-settings.service';

describe('effectiveConcurrentRunners', () => {
  it('lets a workspace hold itself below the ceiling', () => {
    expect(effectiveConcurrentRunners(1, 4)).toBe(1);
  });

  it('never lets a workspace exceed the ceiling', () => {
    expect(effectiveConcurrentRunners(10, 2)).toBe(2);
  });

  it('follows the ceiling with no workspace value, or 0', () => {
    expect(effectiveConcurrentRunners(null, 2)).toBe(2);
    expect(effectiveConcurrentRunners(0, 2)).toBe(2);
  });

  it('uses the workspace value when the ceiling is unlimited', () => {
    expect(effectiveConcurrentRunners(3, 0)).toBe(3);
    expect(effectiveConcurrentRunners(null, 0)).toBe(0);
  });
});

describe('DeploymentSettingsService', () => {
  const KEYS = [
    'MAX_CONCURRENT_RUNNERS',
    'AUTO_SCHEDULE_MAX_CONCURRENT',
    'MAX_RUNNERS_PER_SOURCE',
  ] as const;
  const saved: Record<string, string | undefined> = {};
  let findUnique: jest.Mock;
  let upsert: jest.Mock;
  let service: DeploymentSettingsService;

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    findUnique = jest.fn().mockResolvedValue(null);
    upsert = jest.fn().mockResolvedValue({});
    service = new DeploymentSettingsService({
      instanceSettings: { findUnique, upsert },
    } as unknown as PrismaService);
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('reads the deployment value from the environment, else the built-in default', () => {
    expect(service.deploymentDefault('maxConcurrentRunners')).toBe(2);
    process.env.MAX_CONCURRENT_RUNNERS = '6';
    expect(service.deploymentDefault('maxConcurrentRunners')).toBe(6);
    process.env.MAX_CONCURRENT_RUNNERS = 'nope';
    expect(service.deploymentDefault('maxConcurrentRunners')).toBe(2);
  });

  it('reports a workspace override above the ceiling as capped by it', async () => {
    process.env.MAX_CONCURRENT_RUNNERS = '2';
    findUnique.mockResolvedValue({
      maxConcurrentRunners: 10,
      autoScheduleMaxConcurrent: 10,
      maxRunnersPerSource: null,
    });
    const limits = await service.limits();
    expect(limits.maxConcurrentRunners).toEqual({
      override: 10,
      deploymentDefault: 2,
      effective: 2,
    });
    // The other two replace the chart value outright.
    expect(limits.autoScheduleMaxConcurrent.effective).toBe(10);
    expect(limits.maxRunnersPerSource.effective).toBe(5);
  });

  it('reads the override from the current workspace row', async () => {
    findUnique.mockResolvedValue({ maxConcurrentRunners: 3 });
    await expect(service.override('maxConcurrentRunners')).resolves.toBe(3);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { maxConcurrentRunners: true },
    });
  });

  it('falls back to the deployment value when the row cannot be read', async () => {
    findUnique.mockRejectedValue(new Error('no namespace context'));
    await expect(service.override('maxConcurrentRunners')).resolves.toBeNull();
    await expect(service.effective('maxConcurrentRunners')).resolves.toBe(2);
  });

  it('stores, clears and leaves untouched the keys it is given', async () => {
    await service.update({
      maxConcurrentRunners: 3,
      maxRunnersPerSource: null,
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      create: { id: 1, maxConcurrentRunners: 3, maxRunnersPerSource: null },
      update: { maxConcurrentRunners: 3, maxRunnersPerSource: null },
    });
  });

  it('clamps to the maximum and truncates fractions', async () => {
    await service.update({
      maxConcurrentRunners: MAX_RUNNER_LIMIT + 5,
      autoScheduleMaxConcurrent: 2.9,
    });
    expect(upsert.mock.calls[0][0].update).toEqual({
      maxConcurrentRunners: MAX_RUNNER_LIMIT,
      autoScheduleMaxConcurrent: 2,
    });
  });

  it('rejects a negative limit', async () => {
    await expect(
      service.update({ maxConcurrentRunners: -1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });
});
