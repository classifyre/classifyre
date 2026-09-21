import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { WorkerQueuesService } from './worker-queues.service';

describe('WorkerQueuesService.purgeQueued', () => {
  const namespaceId = '00000000-0000-0000-0000-000000000001';

  const build = (queues: string[], queuedCount: number) => {
    const deleteQueuedJobs = jest.fn(() => Promise.resolve());
    const boss = {
      getQueues: jest.fn(() =>
        Promise.resolve(queues.map((name) => ({ name }))),
      ),
      deleteQueuedJobs,
    };
    const pgBoss = {
      getBossAsync: jest.fn(() => Promise.resolve(boss)),
      queueDepths: jest.fn(() =>
        Promise.resolve(
          queues.map((queue) => ({
            queue,
            queuedCount,
            activeCount: 0,
            deferredCount: 0,
            totalCount: queuedCount,
          })),
        ),
      ),
    };
    const cls = { get: jest.fn(() => namespaceId) };
    const service = new WorkerQueuesService(
      cls as never,
      {} as never,
      pgBoss as never,
      {} as never,
    );
    return { service, boss, deleteQueuedJobs };
  };

  it('drops the waiting backlog and reports the sampled depth', async () => {
    const { service, deleteQueuedJobs } = build(['auto-schedule.tick'], 3);

    const out = await service.purgeQueued('auto-schedule.tick');

    expect(out).toEqual({ queue: 'auto-schedule.tick', droppedQueued: 3 });
    expect(deleteQueuedJobs).toHaveBeenCalledWith('auto-schedule.tick');
  });

  it('rejects unknown queues with 404', async () => {
    const { service, deleteQueuedJobs } = build(['auto-schedule.tick'], 0);

    await expect(service.purgeQueued('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(deleteQueuedJobs).not.toHaveBeenCalled();
  });

  it('refuses pg-boss housekeeping queues with 400', async () => {
    const { service, deleteQueuedJobs } = build(['__pgboss__send-it'], 5);

    await expect(
      service.purgeQueued('__pgboss__send-it'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deleteQueuedJobs).not.toHaveBeenCalled();
  });

  it('rejects blank queue names with 400', async () => {
    const { service, deleteQueuedJobs } = build(['auto-schedule.tick'], 0);

    await expect(service.purgeQueued('  ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deleteQueuedJobs).not.toHaveBeenCalled();
  });
});

describe('WorkerQueuesService — feature holds', () => {
  const namespaceId = '00000000-0000-0000-0000-000000000001';

  const build = (holds: Map<string, string | null>, heldBy: string | null) => {
    const registry = {
      listRows: jest.fn().mockResolvedValue([]),
      listPauseHolds: jest.fn().mockResolvedValue(holds),
      setPaused: jest.fn().mockResolvedValue({ heldBy }),
    };
    const pgBoss = {
      queueDepths: jest.fn().mockResolvedValue([
        {
          queue: 'correlation.scan',
          queuedCount: 4,
          activeCount: 0,
          deferredCount: 0,
          totalCount: 4,
        },
      ]),
    };
    const concurrency = {
      getLimit: () => 4,
      getWaitTimeoutMs: () => 900_000,
    };
    const cls = { get: jest.fn(() => namespaceId) };
    return new WorkerQueuesService(
      cls as never,
      registry as never,
      pgBoss as never,
      concurrency as never,
    );
  };

  it('reports which feature holds a queue, even one no worker registered', async () => {
    const service = build(
      new Map([
        ['correlation.scan', 'duplicates'],
        ['semantic-embeddings-s1', 'embeddings'],
      ]),
      null,
    );

    const { queues } = await service.overview();
    const byName = new Map(queues.map((q) => [q.queue, q]));

    expect(byName.get('correlation.scan')).toEqual(
      expect.objectContaining({ paused: true, heldBy: 'duplicates' }),
    );
    // No depth row and no worker row: listed because of the hold alone.
    expect(byName.get('semantic-embeddings-s1')).toEqual(
      expect.objectContaining({ paused: true, heldBy: 'embeddings' }),
    );
  });

  it('answers 409 when a held queue is resumed by hand', async () => {
    const service = build(new Map(), 'duplicates');

    await expect(service.setPaused('correlation.scan', false)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.setPaused('correlation.scan', false)).rejects.toThrow(
      /Duplicate detection is turned off/,
    );
  });
});
