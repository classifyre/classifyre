import { BadRequestException, NotFoundException } from '@nestjs/common';
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
