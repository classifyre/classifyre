import { ConflictException } from '@nestjs/common';
import { AutoScheduleService } from './auto-schedule.service';
import {
  BACKOFF_BASE_SECONDS,
  CATCH_UP_COOLDOWN_SECONDS,
  CIRCUIT_BREAK_FAILURES,
  MAX_CONSECUTIVE_CATCH_UP_RUNS,
  MIN_AGENT_INTERVAL_SECONDS,
  STEADY_MAX_SECONDS,
  STEADY_MIN_SECONDS,
} from './auto-schedule.constants';
import type { PrismaService } from '../prisma.service';
import type { PgBossService } from './pg-boss.service';
import type { CliRunnerService } from '../cli-runner/cli-runner.service';
import type { NotificationsService } from '../notifications.service';

/** Seconds between `now` and the written `scheduleNextAt`, rounded. */
function delayOf(data: Record<string, unknown>, from: number): number {
  const next = data.scheduleNextAt as Date;
  return Math.round((next.getTime() - from) / 1000);
}

describe('AutoScheduleService', () => {
  const prisma = {
    source: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    runner: { findUnique: jest.fn(), findFirst: jest.fn() },
    instanceSettings: { findUnique: jest.fn() },
  };
  const pgBoss = { getBossAsync: jest.fn() };
  const cliRunner = { startRun: jest.fn() };
  const notifications = { create: jest.fn() };

  const service = new AutoScheduleService(
    prisma as unknown as PrismaService,
    pgBoss as unknown as PgBossService,
    cliRunner as unknown as CliRunnerService,
    notifications as unknown as NotificationsService,
  );

  const autoSource = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    name: 'Guzman mailbox',
    scheduleMode: 'AUTO',
    autoPhase: 'CATCH_UP',
    autoIntervalSeconds: STEADY_MIN_SECONDS,
    autoNoProgressStreak: 0,
    autoCatchUpRuns: 0,
    autoLastRunnerId: null,
    consecutiveFailures: 0,
    ...over,
  });

  const runner = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    sourceId: 's1',
    status: 'COMPLETED',
    assetsCreated: 0,
    assetsUpdated: 0,
    assetsDeleted: 0,
    findingsCreated: 0,
    samplingCursor: null,
    completedAt: new Date('2026-08-07T08:33:42Z'),
    ...over,
  });

  /** The data passed to the single write in this call. */
  const written = (): Record<string, unknown> =>
    prisma.source.updateMany.mock.calls.at(-1)![0].data;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.source.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('recordRunOutcome', () => {
    /**
     * The sweep advancing IS progress, whatever it happened to find.
     *
     * The live failure: a source with all 9600 assets ingested up front and an
     * AUTOMATIC strategy walking 100 objects per run. No run ever created an
     * asset, so nine passes were filed as no progress and the source converged
     * to a once-a-day cadence with its cursor at 900 of 9600 — 9% swept, called
     * finished. Scanning stopped, so nothing was marked dirty, so no autopilot
     * cycle ran at all.
     */
    it('treats a moved sampling cursor as progress, with no assets or findings', async () => {
      const now = Date.now();
      prisma.source.findUnique.mockResolvedValue(autoSource());
      prisma.runner.findUnique.mockResolvedValue(
        runner({
          assetsCreated: 0,
          assetsUpdated: 0,
          assetsDeleted: 0,
          findingsCreated: 0,
          samplingCursor: { objects: 1000 },
        }),
      );
      // The run before it stopped 100 objects earlier.
      prisma.runner.findFirst.mockResolvedValue({
        samplingCursor: { objects: 900 },
      });

      await service.recordRunOutcome('s1', 'r1');

      const data = written();
      expect(data.autoPhase).toBe('CATCH_UP');
      expect(data.autoNoProgressStreak).toBe(0);
      expect(delayOf(data, now)).toBe(CATCH_UP_COOLDOWN_SECONDS);
    });

    it('converges once the cursor stops moving', async () => {
      prisma.source.findUnique.mockResolvedValue(autoSource());
      prisma.runner.findUnique.mockResolvedValue(
        runner({ samplingCursor: { objects: 9600 } }),
      );
      prisma.runner.findFirst.mockResolvedValue({
        samplingCursor: { objects: 9600 },
      });

      await service.recordRunOutcome('s1', 'r1');

      expect(written().autoNoProgressStreak).toBe(1);
    });

    // A first run, or any non-AUTOMATIC strategy, records no cursor. Reading
    // that as movement would keep such a source in catch-up forever.
    it('abstains when there is no cursor to compare', async () => {
      prisma.source.findUnique.mockResolvedValue(autoSource());
      prisma.runner.findUnique.mockResolvedValue(
        runner({ samplingCursor: null }),
      );
      prisma.runner.findFirst.mockResolvedValue({ samplingCursor: null });

      await service.recordRunOutcome('s1', 'r1');

      expect(written().autoNoProgressStreak).toBe(1);
    });

    /**
     * Detection progress counts, not just ingestion.
     *
     * Measured on a live instance: nine consecutive scans reported
     * `assetsCreated 0, assetsUpdated 0, assetsUnchanged 100` while creating
     * 26, 17, 6, 31, 25 and 22 findings. Progress was assets-only, so all nine
     * were filed NO_PROGRESS and the source converged to a once-a-day cadence
     * while still yielding findings on every pass. Scanning stopped, nothing
     * was marked dirty, no autopilot cycle ran, and the harness looked idle on
     * a corpus it had not finished reading. This is the common case rather than
     * an edge one: the config and detector agents tune detectors and then
     * trigger a re-scan over assets that are all already known.
     */
    it('counts new findings as progress even when no asset changed', async () => {
      const now = Date.now();
      prisma.source.findUnique.mockResolvedValue(autoSource());
      prisma.runner.findUnique.mockResolvedValue(
        runner({
          assetsCreated: 0,
          assetsUpdated: 0,
          assetsDeleted: 0,
          findingsCreated: 26,
        }),
      );

      await service.recordRunOutcome('s1', 'r1');

      const data = written();
      expect(data.autoPhase).toBe('CATCH_UP');
      expect(data.autoNoProgressStreak).toBe(0);
      expect(delayOf(data, now)).toBe(CATCH_UP_COOLDOWN_SECONDS);
    });

    it('still converges when a run produces neither assets nor findings', async () => {
      prisma.source.findUnique.mockResolvedValue(autoSource());
      prisma.runner.findUnique.mockResolvedValue(
        runner({ assetsCreated: 0, findingsCreated: 0 }),
      );

      await service.recordRunOutcome('s1', 'r1');

      expect(written().autoNoProgressStreak).toBe(1);
    });

    it('keeps sweeping while a run is still ingesting', async () => {
      const now = Date.now();
      prisma.source.findUnique.mockResolvedValue(autoSource());
      prisma.runner.findUnique.mockResolvedValue(
        runner({ assetsCreated: 120 }),
      );

      await service.recordRunOutcome('s1', 'r1');

      const data = written();
      expect(data.autoPhase).toBe('CATCH_UP');
      expect(data.autoCatchUpRuns).toBe(1);
      expect(delayOf(data, now)).toBe(CATCH_UP_COOLDOWN_SECONDS);
    });

    it('counts an updated asset as progress, so a paging sweep inside one file continues', async () => {
      // A Parquet object read a slice at a time advances by rewriting the same
      // asset — created stays 0 for the entire sweep.
      prisma.source.findUnique.mockResolvedValue(autoSource());
      prisma.runner.findUnique.mockResolvedValue(runner({ assetsUpdated: 1 }));

      await service.recordRunOutcome('s1', 'r1');

      expect(written().autoPhase).toBe('CATCH_UP');
    });

    it('does not converge on a single empty run', async () => {
      prisma.source.findUnique.mockResolvedValue(autoSource());
      prisma.runner.findUnique.mockResolvedValue(runner());

      await service.recordRunOutcome('s1', 'r1');

      const data = written();
      expect(data.autoPhase).toBe('CATCH_UP');
      expect(data.autoNoProgressStreak).toBe(1);
    });

    it('converges to the steady floor after enough empty runs', async () => {
      const now = Date.now();
      prisma.source.findUnique.mockResolvedValue(
        autoSource({ autoNoProgressStreak: 1 }),
      );
      prisma.runner.findUnique.mockResolvedValue(runner());

      await service.recordRunOutcome('s1', 'r1');

      const data = written();
      expect(data.autoPhase).toBe('STEADY');
      expect(data.autoIntervalSeconds).toBe(STEADY_MIN_SECONDS);
      expect(delayOf(data, now)).toBe(STEADY_MIN_SECONDS);
    });

    it('widens the steady interval on each further quiet run, up to the ceiling', async () => {
      prisma.source.findUnique.mockResolvedValue(
        autoSource({
          autoPhase: 'STEADY',
          autoNoProgressStreak: 3,
          autoIntervalSeconds: STEADY_MIN_SECONDS,
        }),
      );
      prisma.runner.findUnique.mockResolvedValue(runner());

      await service.recordRunOutcome('s1', 'r1');
      expect(written().autoIntervalSeconds).toBe(STEADY_MIN_SECONDS * 2);

      prisma.source.findUnique.mockResolvedValue(
        autoSource({
          autoPhase: 'STEADY',
          autoNoProgressStreak: 9,
          autoIntervalSeconds: STEADY_MAX_SECONDS,
        }),
      );
      await service.recordRunOutcome('s1', 'r1');
      expect(written().autoIntervalSeconds).toBe(STEADY_MAX_SECONDS);
    });

    it('drops straight back to catch-up when a converged source finds new data', async () => {
      prisma.source.findUnique.mockResolvedValue(
        autoSource({
          autoPhase: 'STEADY',
          autoNoProgressStreak: 9,
          autoIntervalSeconds: STEADY_MAX_SECONDS,
        }),
      );
      prisma.runner.findUnique.mockResolvedValue(runner({ assetsCreated: 40 }));

      await service.recordRunOutcome('s1', 'r1');

      const data = written();
      expect(data.autoPhase).toBe('CATCH_UP');
      expect(data.autoIntervalSeconds).toBe(STEADY_MIN_SECONDS);
      expect(data.autoNoProgressStreak).toBe(0);
    });

    it('settles a source that never stops changing, instead of chasing it forever', async () => {
      prisma.source.findUnique.mockResolvedValue(
        autoSource({ autoCatchUpRuns: MAX_CONSECUTIVE_CATCH_UP_RUNS - 1 }),
      );
      prisma.runner.findUnique.mockResolvedValue(runner({ assetsUpdated: 3 }));

      await service.recordRunOutcome('s1', 'r1');

      const data = written();
      expect(data.autoPhase).toBe('STEADY');
      expect(data.autoCatchUpRuns).toBe(0);
    });

    it('backs off exponentially on failure', async () => {
      const now = Date.now();
      prisma.source.findUnique.mockResolvedValue(
        autoSource({ consecutiveFailures: 3 }),
      );
      prisma.runner.findUnique.mockResolvedValue(runner({ status: 'ERROR' }));

      await service.recordRunOutcome('s1', 'r1');

      const data = written();
      expect(data.autoPhase).toBe('BACKOFF');
      expect(delayOf(data, now)).toBe(BACKOFF_BASE_SECONDS * 4);
    });

    it('pauses and notifies once the failures stop looking transient', async () => {
      prisma.source.findUnique.mockResolvedValue(
        autoSource({ consecutiveFailures: CIRCUIT_BREAK_FAILURES }),
      );
      prisma.runner.findUnique.mockResolvedValue(runner({ status: 'ERROR' }));

      await service.recordRunOutcome('s1', 'r1');

      const data = written();
      expect(data.autoPhase).toBe('PAUSED');
      expect(data.scheduleNextAt).toBeNull();
      expect(notifications.create).toHaveBeenCalledTimes(1);
      expect(notifications.create.mock.calls[0]![0].event).toBe(
        'source.schedule_paused',
      );
    });

    it('ignores runs for sources another scheduler owns', async () => {
      prisma.source.findUnique.mockResolvedValue(
        autoSource({ scheduleMode: 'CRON' }),
      );

      await service.recordRunOutcome('s1', 'r1');

      expect(prisma.source.updateMany).not.toHaveBeenCalled();
    });

    it('folds each finished run in exactly once, however many times it is delivered', async () => {
      // pg-boss is at-least-once and the cron tick reconciles on top of the
      // post-run kick, so the same run does arrive twice.
      prisma.source.findUnique.mockResolvedValue(
        autoSource({ autoLastRunnerId: 'r1' }),
      );
      prisma.runner.findUnique.mockResolvedValue(
        runner({ id: 'r1', assetsCreated: 90 }),
      );

      await service.recordRunOutcome('s1', 'r1');

      expect(prisma.source.updateMany).not.toHaveBeenCalled();
    });

    it('stamps the run it processed so the next delivery is a no-op', async () => {
      prisma.source.findUnique.mockResolvedValue(autoSource());
      prisma.runner.findUnique.mockResolvedValue(
        runner({ id: 'r7', assetsCreated: 1 }),
      );

      await service.recordRunOutcome('s1', 'r7');

      expect(written().autoLastRunnerId).toBe('r7');
    });

    it('ignores a runner belonging to a different source', async () => {
      prisma.source.findUnique.mockResolvedValue(autoSource());
      prisma.runner.findUnique.mockResolvedValue(
        runner({ sourceId: 'other', assetsCreated: 500 }),
      );

      await service.recordRunOutcome('s1', 'r1');

      // Treated as no signal, never as progress on this source.
      expect(written().autoPhase).toBe('CATCH_UP');
      expect(written().autoNoProgressStreak).toBe(1);
    });
  });

  describe('tick', () => {
    beforeEach(() => {
      prisma.instanceSettings.findUnique.mockResolvedValue({
        autoScheduleEnabled: true,
      });
      prisma.source.count.mockResolvedValue(0);
    });

    it('starts due sources', async () => {
      const due = new Date(Date.now() - 5000);
      prisma.source.findMany.mockResolvedValue([
        { id: 's1', name: 'A', scheduleNextAt: due },
      ]);
      cliRunner.startRun.mockResolvedValue({ id: 'run-1' });

      await service.tick();

      // Claimed with a compare-and-set on the exact due time it read.
      expect(prisma.source.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 's1', scheduleNextAt: due }),
        }),
      );
      expect(cliRunner.startRun).toHaveBeenCalledWith(
        's1',
        'SCHEDULED',
        expect.any(String),
      );
    });

    it('does nothing while the master switch is off', async () => {
      prisma.instanceSettings.findUnique.mockResolvedValue({
        autoScheduleEnabled: false,
      });

      await service.tick();

      expect(prisma.source.findMany).not.toHaveBeenCalled();
      expect(cliRunner.startRun).not.toHaveBeenCalled();
    });

    it('respects the concurrency cap', async () => {
      // The cap is 2 by default and two scans are already running.
      prisma.source.count.mockResolvedValue(2);

      await service.tick();

      expect(prisma.source.findMany).not.toHaveBeenCalled();
    });

    // The capacity being rationed is the instance's, and a cron schedule an
    // operator set consumes it just as much as a catch-up sweep does. Counting
    // only AUTO sources made the cap read "two adaptive scans ON TOP OF
    // everything else".
    it('counts every scan in flight, not just its own', async () => {
      prisma.source.count.mockResolvedValue(0);
      prisma.source.findMany.mockResolvedValue([
        { id: 's1', name: 'A', scheduleNextAt: new Date() },
      ]);
      cliRunner.startRun.mockResolvedValue({ id: 'run-1' });

      await service.tick();

      const where = prisma.source.count.mock.calls[0]![0].where;
      expect(where.runnerStatus).toEqual({ in: ['PENDING', 'RUNNING'] });
      // No scheduleMode filter: a cron or manual run counts too.
      expect(where.scheduleMode).toBeUndefined();
    });

    it('yields entirely when cron and manual runs have filled the capacity', async () => {
      // Two scans in flight, none of them adaptive.
      prisma.source.count.mockResolvedValue(2);

      await service.tick();

      expect(cliRunner.startRun).not.toHaveBeenCalled();
    });

    // Fair rotation among adaptive sources: longest-overdue first, so a source
    // whose slow steady interval came due ten minutes ago is picked ahead of a
    // catch-up source that re-armed thirty seconds ago.
    it('takes the longest-overdue source first', async () => {
      prisma.source.count.mockResolvedValue(0);
      prisma.source.findMany.mockResolvedValue([]);

      await service.tick();

      const args = prisma.source.findMany.mock.calls[0]![0];
      expect(args.orderBy).toEqual({ scheduleNextAt: 'asc' });
    });

    it('starts nothing when another replica won the claim', async () => {
      prisma.source.findMany.mockResolvedValue([
        { id: 's1', name: 'A', scheduleNextAt: new Date() },
      ]);
      prisma.source.updateMany.mockResolvedValue({ count: 0 });

      await service.tick();

      expect(cliRunner.startRun).not.toHaveBeenCalled();
    });

    it('leaves a source alone when a scan is already running for it', async () => {
      prisma.source.findMany.mockResolvedValue([
        { id: 's1', name: 'A', scheduleNextAt: new Date() },
      ]);
      cliRunner.startRun.mockRejectedValue(new ConflictException('running'));

      await service.tick();

      // One write: the claim. No backoff — nothing is wrong.
      expect(prisma.source.updateMany).toHaveBeenCalledTimes(1);
    });

    it('backs off when a run cannot be started at all', async () => {
      prisma.source.findMany.mockResolvedValue([
        { id: 's1', name: 'A', scheduleNextAt: new Date() },
      ]);
      cliRunner.startRun.mockRejectedValue(new Error('k8s rejected the job'));

      await service.tick();

      const data = written();
      expect(data.autoPhase).toBe('BACKOFF');
      expect(String(data.autoReason)).toMatch(/k8s rejected/);
    });
  });

  describe('agent surface', () => {
    it('clamps an interval an agent asks for to the allowed range', async () => {
      const applied = await service.setSteadyInterval('s1', 30, 'too eager');
      expect(applied).toBe(MIN_AGENT_INTERVAL_SECONDS);
      expect(written().autoIntervalSeconds).toBe(MIN_AGENT_INTERVAL_SECONDS);
    });

    it('restarts the sweep for an AUTO source', async () => {
      prisma.source.findUnique.mockResolvedValue({
        scheduleMode: 'AUTO',
        autoPhase: 'STEADY',
      });

      await service.resetToCatchUp('s1', 'detector changed');

      const data = written();
      expect(data.autoPhase).toBe('CATCH_UP');
      expect(data.autoNoProgressStreak).toBe(0);
    });

    it('does not restart a sweep for a source on cron, or a paused one', async () => {
      prisma.source.findUnique.mockResolvedValue({
        scheduleMode: 'CRON',
        autoPhase: 'CATCH_UP',
      });
      await service.resetToCatchUp('s1', 'detector changed');
      expect(prisma.source.updateMany).not.toHaveBeenCalled();

      prisma.source.findUnique.mockResolvedValue({
        scheduleMode: 'AUTO',
        autoPhase: 'PAUSED',
      });
      await service.resetToCatchUp('s1', 'detector changed');
      expect(prisma.source.updateMany).not.toHaveBeenCalled();
    });
  });
});
