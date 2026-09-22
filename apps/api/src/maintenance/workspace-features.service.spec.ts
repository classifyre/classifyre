import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { WorkspaceFeaturesService } from './workspace-features.service';

/**
 * Turning a feature off is the switch, a hold on its queues, and optionally a
 * wipe — in that order, so nothing produces work between them. Turning it on
 * releases the hold and catches up. These pin the order and the catch-up,
 * because each piece alone looks like it works.
 */
describe('WorkspaceFeaturesService', () => {
  const NS = '00000000-0000-0000-0000-000000000001';

  const build = (
    over: {
      duplicatesOn?: boolean;
      embeddingsOn?: boolean;
      embeddingsMode?: 'kept' | 'deleted' | null;
      running?: string | null;
      holds?: Map<string, string | null>;
    } = {},
  ) => {
    const calls: string[] = [];
    let duplicatesOn = over.duplicatesOn ?? true;
    let embeddingsOn = over.embeddingsOn ?? true;
    const maintenance = {
      overview: jest.fn().mockResolvedValue({
        datasets: [
          {
            key: 'duplicates',
            cleanupKey: 'duplicates',
            tables: ['correlation_pair_signatures', 'edges'],
            rowsEstimate: 23_500_000,
            sizeBytes: 28_000_000_000,
            cleanable: true,
          },
          {
            key: 'embeddings',
            cleanupKey: 'embeddings',
            tables: ['content_embeddings'],
            rowsEstimate: 2_600_000,
            sizeBytes: 5_700_000_000,
            cleanable: true,
          },
        ],
      }),
      runningCleanup: jest.fn((key: string) =>
        over.running === key ? { runId: 'run-live' } : null,
      ),
      startCleanup: jest.fn((key: string) => {
        calls.push(`cleanup:${key}`);
        return { runId: `run-${key}`, key, status: 'running' };
      }),
    };
    const queues = {
      listPauseHolds: jest.fn().mockResolvedValue(over.holds ?? new Map()),
      holdForFeature: jest.fn(
        (_ns: string, feature: string, names: string[]) => {
          calls.push(`hold:${feature}:${names.join(',')}`);
          return Promise.resolve();
        },
      ),
      releaseFeature: jest.fn((_ns: string, feature: string) => {
        calls.push(`release:${feature}`);
        return Promise.resolve(['q']);
      }),
    };
    const correlationSwitch = {
      state: jest.fn(() =>
        Promise.resolve({
          enabled: duplicatesOn,
          disabledMode: duplicatesOn ? null : 'kept',
          changedAt: null,
        }),
      ),
      set: jest.fn((enabled: boolean, mode: string | null) => {
        calls.push(`switch:duplicates:${enabled}:${mode}`);
        duplicatesOn = enabled;
        return Promise.resolve();
      }),
    };
    const correlationJobs = {
      scheduleFull: jest.fn(() => {
        calls.push('recompute');
        return Promise.resolve(true);
      }),
    };
    const correlationWorker = {
      drainToHandoff: jest.fn(() => {
        calls.push('drain');
        return Promise.resolve({ handedOff: 2, dropped: 1 });
      }),
    };
    const embeddingSettings = {
      switchState: jest.fn(() =>
        Promise.resolve({
          enabled: embeddingsOn,
          disabledMode: embeddingsOn ? null : (over.embeddingsMode ?? 'kept'),
          changedAt: null,
          deploymentDefault: true,
        }),
      ),
      setEnabled: jest.fn((enabled: boolean, mode: string | null) => {
        calls.push(`switch:embeddings:${enabled}:${mode}`);
        embeddingsOn = enabled;
        return Promise.resolve();
      }),
    };
    const embeddingQueue = {
      queueNamesForHold: jest
        .fn()
        .mockResolvedValue([
          'semantic-embeddings-s1',
          'semantic-recalibrate-s1',
        ]),
      reconcileWorker: jest.fn((options: unknown) => {
        calls.push(`reconcile:${JSON.stringify(options)}`);
        return Promise.resolve();
      }),
    };
    const cls = { get: jest.fn(() => NS) };
    const service = new WorkspaceFeaturesService(
      cls as never,
      maintenance as never,
      queues as never,
      correlationSwitch as never,
      correlationJobs as never,
      correlationWorker as never,
      embeddingSettings as never,
      embeddingQueue as never,
    );
    return { service, calls, maintenance, correlationJobs };
  };

  describe('duplicate detection', () => {
    it('turns off as a pause: switch, hold, re-route the backlog — no wipe', async () => {
      const { service, calls } = build();

      const out = await service.set('duplicates', { enabled: false });

      expect(calls).toEqual([
        'switch:duplicates:false:kept',
        'hold:duplicates:correlation.scan',
        'drain',
      ]);
      expect(out.cleanupRunId).toBeNull();
    });

    it('turns off and deletes: the wipe starts after the hold', async () => {
      const { service, calls } = build();

      const out = await service.set('duplicates', {
        enabled: false,
        deleteData: true,
      });

      expect(calls).toEqual([
        'switch:duplicates:false:deleted',
        'hold:duplicates:correlation.scan',
        'drain',
        'cleanup:duplicates',
      ]);
      expect(out.cleanupRunId).toBe('run-duplicates');
    });

    it('turns on: release, then ONE full recompute to catch up', async () => {
      const { service, calls } = build({ duplicatesOn: false });

      const out = await service.set('duplicates', { enabled: true });

      expect(calls).toEqual([
        'switch:duplicates:true:null',
        'release:duplicates',
        'recompute',
      ]);
      expect(out.recomputeScheduled).toBe(true);
    });

    it('does not recompute when it was already on', async () => {
      const { service, correlationJobs } = build({ duplicatesOn: true });

      await service.set('duplicates', { enabled: true });

      expect(correlationJobs.scheduleFull).not.toHaveBeenCalled();
    });

    it('can delete the data of a feature that is already off', async () => {
      const { service, calls } = build({ duplicatesOn: false });

      await service.set('duplicates', { enabled: false, deleteData: true });

      expect(calls).toContain('cleanup:duplicates');
    });

    it('is a no-op to turn off what is already off, keeping its mode', async () => {
      const { service, calls } = build({ duplicatesOn: false });

      await service.set('duplicates', { enabled: false });

      expect(calls).toEqual([]);
    });
  });

  describe('embeddings', () => {
    it('turns off as a pause and holds every embedding queue', async () => {
      const { service, calls } = build();

      await service.set('embeddings', { enabled: false });

      expect(calls).toEqual([
        'switch:embeddings:false:kept',
        'hold:embeddings:semantic-embeddings-s1,semantic-recalibrate-s1',
      ]);
    });

    it('turns off and deletes the corpus', async () => {
      const { service, calls } = build();

      const out = await service.set('embeddings', {
        enabled: false,
        deleteData: 'true',
      });

      expect(calls).toContain('switch:embeddings:false:deleted');
      expect(calls.at(-1)).toBe('cleanup:embeddings');
      expect(out.cleanupRunId).toBe('run-embeddings');
    });

    it('turns on: release, then bind the worker and catch up', async () => {
      const { service, calls } = build({ embeddingsOn: false });

      await service.set('embeddings', { enabled: true });

      expect(calls).toEqual([
        'switch:embeddings:true:null',
        'release:embeddings',
        'reconcile:{"catchUp":true}',
      ]);
    });
  });

  it('lists both features with the data they own and the queues they hold', async () => {
    const { service } = build({
      duplicatesOn: false,
      holds: new Map([
        ['correlation.scan', 'duplicates'],
        ['auto-schedule.tick', null],
      ]),
    });

    const { features } = await service.list();
    const duplicates = features.find((f) => f.key === 'duplicates');
    const embeddings = features.find((f) => f.key === 'embeddings');

    expect(duplicates).toEqual(
      expect.objectContaining({
        enabled: false,
        disabledMode: 'kept',
        dataBytes: 28_000_000_000,
        heldQueues: ['correlation.scan'],
      }),
    );
    // A manual pause is nobody's hold.
    expect(embeddings?.heldQueues).toEqual([]);
    expect(embeddings?.deploymentDefault).toBe(true);
  });

  it('refuses to toggle while that feature’s data is being deleted', async () => {
    const { service } = build({ running: 'duplicates' });

    await expect(
      service.set('duplicates', { enabled: true }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects unknown features and malformed bodies', async () => {
    const { service } = build();

    await expect(
      service.set('findings', { enabled: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.set('duplicates', { enabled: 'yes' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.set('duplicates', { enabled: true, deleteData: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
