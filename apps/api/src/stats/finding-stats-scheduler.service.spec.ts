import { FindingStatsScheduler } from './finding-stats-scheduler.service';
import {
  FINDING_STATS_FULL_KEY,
  FINDING_STATS_INCREMENTAL_KEY,
  FINDING_STATS_QUEUE,
} from './finding-stats.constants';

describe('FindingStatsScheduler', () => {
  const build = (send = jest.fn().mockResolvedValue('job-1')) => {
    const pgBoss = { getBossAsync: jest.fn().mockResolvedValue({ send }) };
    const stats = { markDaysDirty: jest.fn().mockResolvedValue(undefined) };
    return {
      scheduler: new FindingStatsScheduler(pgBoss as never, stats as never),
      send,
      stats,
    };
  };

  it('coalesces incremental refreshes onto one job per window', async () => {
    const { scheduler, send } = build();

    await scheduler.scheduleForDays([new Date()], 'findings ingested');

    const [queue, , options] = send.mock.calls[0]!;
    expect(queue).toBe(FINDING_STATS_QUEUE);
    expect(options).toMatchObject({
      singletonKey: FINDING_STATS_INCREMENTAL_KEY,
      // Without singletonNextSlot a request arriving while a job occupies the
      // current slot is dropped, so the last write before a workspace goes
      // quiet would never be reflected.
      singletonNextSlot: true,
    });
    expect(options.singletonSeconds).toBeGreaterThan(0);
  });

  it('marks the affected days dirty before enqueueing', async () => {
    const { scheduler, stats, send } = build();
    const day = new Date('2026-08-13T10:00:00Z');

    await scheduler.scheduleForDays([day], 'finding status changed');

    expect(stats.markDaysDirty).toHaveBeenCalledWith([day]);
    expect(stats.markDaysDirty.mock.invocationCallOrder[0]).toBeLessThan(
      send.mock.invocationCallOrder[0],
    );
  });

  it('keeps full rebuilds on their own singleton key', async () => {
    const { scheduler, send } = build();

    await scheduler.scheduleFull('manual refresh');

    const [, data, options] = send.mock.calls[0]!;
    expect(data).toMatchObject({ full: true });
    expect(options).toMatchObject({ singletonKey: FINDING_STATS_FULL_KEY });
  });

  it('does not enqueue when the day could not be marked dirty', async () => {
    const { scheduler, stats, send } = build();
    stats.markDaysDirty.mockRejectedValue(new Error('db down'));

    await scheduler.scheduleForDays([new Date()], 'findings ingested');

    // Enqueueing anyway would run a refresh that recomputes nothing and then
    // stamps refreshedAt, advertising the rollup as current when it is not.
    expect(send).not.toHaveBeenCalled();
  });

  it('never fails the caller when the queue is unreachable', async () => {
    const { scheduler } = build(
      jest.fn().mockRejectedValue(new Error('pg-boss down')),
    );

    // The mutation has already committed; a missed refresh must not turn a
    // successful ingest into an error.
    await expect(
      scheduler.scheduleForDays([new Date()], 'findings ingested'),
    ).resolves.toBeUndefined();
  });
});
